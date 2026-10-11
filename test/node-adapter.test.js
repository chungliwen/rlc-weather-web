import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {nodeEnvironment,runOnce} from '../scripts/node-adapter.js';
import {sampleForecast} from '../scripts/fixtures.js';
test('VPS adapter uses shared logic and atomic JSON persistence without a public state path',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rlc-weather-test-'));try{
 const now=new Date('2026-10-11T06:00:00Z'),env={MET_USER_AGENT:'rlc-weather/0.1 https://example.org/contact'};
 const report=await runOnce(dir,env,now,async url=>url.includes('met.no')?Response.json(sampleForecast(now)):Response.json({generated:+now/1000,radar:{past:[]}}));assert.equal(report.forecast.available,true);
 assert.equal(JSON.parse(await readFile(join(dir,'state.json'),'utf8')).report.generated_at,now.toISOString());
 assert.equal((await nodeEnvironment(dir).ASSETS.fetch(new Request('http://localhost/state.json'))).status,404);
 await writeFile(join(dir,'refresh.lock'),'');await assert.rejects(()=>runOnce(dir,env,now),/lock/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

import {radarFixture} from '../scripts/radar-fixture.js';
import {tilePosition} from '../src/radar.js';
test('VPS scheduled pipeline decodes six actual PNG fixtures and detects overhead rain',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rlc-radar-vps-'));try{
  const now=new Date('2026-10-11T06:00:00Z'),epoch=+now/1000,pos=tilePosition(3.1469,101.6834,7);
  const bytes=radarFixture({filter:4,pixels:[[Math.round(pos.pixel_x),Math.round(pos.pixel_y)]]});
  let tiles=0;
  const r=await runOnce(dir,{MET_USER_AGENT:'fixture/1 https://example.org/contact'},now,async url=>{
    if(url.includes('met.no'))return Response.json(sampleForecast(now));
    if(url.includes('weather-maps.json'))return Response.json({generated:epoch,host:'https://tilecache.rainviewer.com',radar:{past:Array.from({length:6},(_,i)=>({time:epoch-(5-i)*300,path:`/v2/radar/${epoch-(5-i)*300}`}))}});
    tiles++;return new Response(bytes,{headers:{'content-type':'image/png'}});
  });
  assert.equal(tiles,6);assert.equal(r.radar.available,true);assert.equal(r.radar.status,'overhead');assert.equal(r.radar.frames_analyzed,6);assert.ok(r.radar.nearest_km<=2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
