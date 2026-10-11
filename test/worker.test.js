import test from 'node:test';import assert from 'node:assert/strict';
import worker,{refresh,publicReport,STATE_KEY} from '../src/index.js';
import {sampleForecast} from '../scripts/fixtures.js';
const now=new Date('2026-10-11T06:00:00Z');
function environment(){const data=new Map();return {MET_USER_AGENT:'rlc-weather/0.1 https://example.org/contact',WEATHER:{get:async key=>data.get(key)||null,put:async(key,value)=>data.set(key,JSON.parse(value))},ASSETS:{fetch:async()=>new Response('static asset')},data};}
const fetcher=async url=>url.includes('met.no')?Response.json(sampleForecast(now)):Response.json({generated:+now/1000,host:'https://tilecache.rainviewer.com',radar:{past:[]}});
test('refresh persists one bounded snapshot, partial providers and attribution without secrets',async()=>{
 const env=environment();const report=await refresh(env,now,fetcher);assert.equal(report.forecast.available,true);assert.equal(report.air_quality.available,false);assert.equal(report.radar.available,false);assert.equal(env.data.size,1);assert.ok(env.data.has(STATE_KEY));assert.equal(report.attribution[0].license,'CC BY 4.0');assert.equal(report.sources.met.status,'ok');assert.equal(report.data_complete,false);
});
test('cached snapshot prevents upstream fetching inside interval',async()=>{const env=environment();await refresh(env,now,fetcher);const result=await refresh(env,new Date(+now+60000),async()=>{throw Error('unexpected network');});assert.equal(result.sources.met.status,'ok');});
test('fetch only reads persisted report; no unauthenticated refresh route',async()=>{
 const env=environment();let r=await worker.fetch(new Request('https://local/api/report'),env);assert.equal(r.status,503);
 await refresh(env,now,fetcher);r=await worker.fetch(new Request('https://local/api/report'),env);assert.equal(r.status,200);const body=await r.json();assert.ok(!('providers' in body));assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await worker.fetch(new Request('https://local/api/report',{method:'POST'}),env)).status,405);
 assert.equal((await worker.fetch(new Request('https://local/api/refresh'),env)).status,404);
 assert.equal(await(await worker.fetch(new Request('https://local/api/report',{method:'HEAD'}),env)).text(),'');
 assert.equal(await(await worker.fetch(new Request('https://local/'),env)).text(),'static asset');
});
test('scheduled handler persists and storage failures propagate',async()=>{
 const env=environment(), previous=globalThis.fetch;globalThis.fetch=fetcher;
 try{await worker.scheduled({scheduledTime:+now},env,{});assert.ok(env.data.has(STATE_KEY));env.WEATHER.put=async()=>{throw Error('storage down');};await assert.rejects(()=>worker.scheduled({scheduledTime:+now},env,{}));}finally{globalThis.fetch=previous;}
});
test('stale report fails closed after cron stops, including future timestamps',()=>{
 const saved={generated_at:now.toISOString(),risk:{score:10,label:'Low'},forecast:{available:true},air_quality:{available:true}};
 assert.equal(publicReport(saved,new Date(+now+1200000)).report_stale,false);
 const stale=publicReport(saved,new Date(+now+1200001));assert.equal(stale.risk.score,null);assert.equal(stale.forecast.stale,true);assert.equal(saved.forecast.stale,undefined);
 assert.equal(publicReport(saved,new Date(+now-1)).report_stale,true);
});
test('missing KV and failed reads give safe failures',async()=>{await assert.rejects(()=>refresh({},now,fetcher));const env=environment();env.WEATHER.get=async()=>{throw Error('secret stack');};const r=await worker.fetch(new Request('https://local/api/report'),env);assert.equal(r.status,503);assert.ok(!(await r.text()).includes('secret'));});
test('public reads recheck provider age without disguising report age',async()=>{
 const env=environment(),report=await refresh(env,now,fetcher);
 report.radar={available:true,status:'overhead',generated_at:new Date(+now-29*60000).toISOString(),observed_at:new Date(+now-29*60000).toISOString()};
 report.air_quality={available:true,metric:'US AQI',aqi:40,name:'Kuala Lumpur',observed_at:new Date(+now-119*60000).toISOString()};
 const current=publicReport(report,new Date(+now+2*60000));assert.equal(current.radar.available,false);assert.equal(current.air_quality.stale,true);assert.equal(current.data_complete,false);assert.equal(current.generated_at,report.generated_at);
});
test('new session cannot inherit a previous session forecast before next cron',async()=>{
 const env=environment(),report=await refresh(env,now,fetcher);report.window.start_at='2026-10-11T00:00:00Z';
 assert.equal(publicReport(report,now).risk.score,null);
});
