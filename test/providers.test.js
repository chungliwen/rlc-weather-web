import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshProvider, normalizeIqair, boundedJson } from '../src/providers.js';
const now = new Date('2026-10-11T06:00:00Z'), env={MET_USER_AGENT:'rlc-weather/0.1 https://example.org/contact'};
const met={properties:{meta:{updated_at:now.toISOString()},timeseries:[]}};
const ok=(data,headers={})=>new Response(JSON.stringify(data),{headers});
test('MET identifying headers, 4 decimal coordinates, Expires and conditional 304 retention',async()=>{
 let requests=[];
 const p=await refreshProvider('met',null,env,now,async(url,options)=>{requests.push({url,options});return ok(met,{expires:'Sun, 11 Oct 2026 07:00:00 GMT','last-modified':'Sun, 11 Oct 2026 05:00:00 GMT',etag:'fixture'});});
 assert.match(requests[0].url,/lat=3.1469&lon=101.6834/);assert.equal(requests[0].options.headers['User-Agent'],env.MET_USER_AGENT);
 await refreshProvider('met',p,env,new Date(+now+600000),()=>{throw Error('must not fetch');});
 const next=await refreshProvider('met',p,env,new Date(+now+3600000),async(url,options)=>{assert.equal(options.headers['If-Modified-Since'],p.last_modified);assert.equal(options.headers['If-None-Match'],'fixture');return new Response(null,{status:304});});
 assert.deepEqual(next.data,met);assert.equal(next.fetched_at,p.fetched_at);assert.equal(next.status,'ok');
});
test('provider failures retain data, enforce backoff and never expose response or secrets',async()=>{
 const previous={data:met};
 const result=await refreshProvider('met',previous,env,now,async()=>new Response('SECRET body',{status:429,headers:{'retry-after':'3600'}}));
 assert.equal(result.status,'degraded');assert.equal(result.next_check,+now+3600000);assert.deepEqual(result.data,met);assert.ok(!JSON.stringify(result).includes('SECRET'));
 const failed=await refreshProvider('met',null,env,now,async()=>{throw Error('SECRET-url');});assert.equal(failed.status,'unavailable');assert.ok(!JSON.stringify(failed).includes('SECRET'));
});
test('IQAir is gated by key and display rights; interval cannot be below 2h',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return ok({status:'success',data:{city:'Kuala Lumpur',state:'Kuala Lumpur',country:'Malaysia',current:{pollution:{aqius:40,ts:now.toISOString()}},secret:'DO NOT KEEP'}});};
 assert.equal((await refreshProvider('iqair',null,{},now,fetcher)).status,'disabled');assert.equal(calls,0);
 const enabled={IQAIR_API_KEY:'fixture-secret',IQAIR_ENABLED:'true',IQAIR_DISPLAY_RIGHTS_CONFIRMED:'true',IQAIR_REFRESH_MINUTES:'1'};
 const result=await refreshProvider('iqair',null,enabled,now,fetcher);assert.equal(result.next_check,+now+7200000);assert.equal(result.data.aqi,40);assert.ok(!JSON.stringify(result).includes('secret'));assert.ok(!JSON.stringify(result).includes('DO NOT KEEP'));
});
test('IQAir rejects wrong coverage, malformed AQI and ambiguous time',()=>{
 const p={status:'success',data:{city:'Kuala Lumpur',state:'Kuala Lumpur',country:'Malaysia',current:{pollution:{aqius:50,ts:now.toISOString()}}}};
 for(const value of [-1,50.5,'50',null]){p.data.current.pollution.aqius=value;assert.throws(()=>normalizeIqair(p));}
 p.data.current.pollution.aqius=50;p.data.current.pollution.ts='2026-10-11T06:00:00';assert.throws(()=>normalizeIqair(p));
 p.data.current.pollution.ts=now.toISOString();p.data.city='Other';assert.throws(()=>normalizeIqair(p));
});
test('bounded JSON rejects large, invalid and empty responses',async()=>{
 await assert.rejects(()=>boundedJson(ok({large:'x'.repeat(40)}),10));await assert.rejects(()=>boundedJson(new Response('not json')));await assert.rejects(()=>boundedJson(new Response(null)));
});
test('MET refuses unidentifiable user agent before sending requests',async()=>{assert.equal((await refreshProvider('met',null,{},now,()=>{throw Error('must not call');})).status,'unavailable');});
test('IQAir rejects impossible calendar dates',()=>{assert.throws(()=>normalizeIqair({status:'success',data:{city:'Kuala Lumpur',state:'Kuala Lumpur',country:'Malaysia',current:{pollution:{aqius:40,ts:'2026-02-30T00:00:00Z'}}}}));});
