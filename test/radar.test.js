import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { analyzeRadar, analyzeImage, decodeRadarPng, tilePosition, kmPerPixel, distanceKm, compassDirection, summarizeRadar, RADAR_LOCATION } from '../src/radar.js';
const NOW = new Date('2026-10-11T12:00:00Z');
const epoch = NOW.getTime() / 1000;
const position = tilePosition(RADAR_LOCATION.latitude, RADAR_LOCATION.longitude, 7);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, crc]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function fixture({ filter = 0, channels = 4, pixels = [], width = 256, height = 256, rawOverride } = {}) {
  const rgba = new Uint8Array(256 * 256 * channels);
  for (const [x, y, color = [0, 150, 255, 255]] of pixels) rgba.set(color.slice(0, channels), (y * 256 + x) * channels);
  const stride = 256 * channels;
  const raw = Buffer.alloc(256 * (stride + 1));
  for (let y = 0; y < 256; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const index = y * stride + i;
      const a = i >= channels ? rgba[index - channels] : 0;
      const b = y ? rgba[index - stride] : 0;
      const c = y && i >= channels ? rgba[index - stride - channels] : 0;
      const p = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : paeth(a,b,c);
      raw[y * (stride + 1) + 1 + i] = (rgba[index] - p) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rawOverride || raw)), chunk('IEND', Buffer.alloc(0))]);
}
const metadata = (times = [epoch-600,epoch-300,epoch]) => ({ generated: epoch, host: 'https://tilecache.rainviewer.com', radar: { past: times.map(time => ({ time, path: `/v2/radar/${time}` })) } });
const response = bytes => new Response(bytes, { headers: { 'content-type': 'image/png' } });

test('geo matches Ruby Mercator and compass conventions', () => {
  assert.equal(position.tile_x, 100); assert.equal(position.tile_y, 62);
  assert.ok(Math.abs(kmPerPixel(0,7)-1.2229924525)<1e-8);
  assert.ok(Math.abs(distanceKm(0,0,0,1)-111.19492664)<1e-6);
  assert.equal(compassDirection(0,-1),'N'); assert.equal(compassDirection(1,1),'SE');
  assert.equal(compassDirection(-1,0),'W');
});
for (const channels of [3,4]) for (const filter of [0,1,2,3,4]) {
  test(`bounded PNG decoder supports ${channels} channels/filter ${filter}`, async () => {
    const image = await decodeRadarPng(fixture({ channels, filter, pixels:[[50,50],[51,50,[30,40,50,80]],[50,51,[90,60,30,120]]] }));
    assert.deepEqual([...image.rgba.slice((50*256+50)*4,(50*256+50)*4+4)],[0,150,255,255]);
    assert.deepEqual([...image.rgba.slice((50*256+51)*4,(50*256+51)*4+4)],[30,40,50,channels===4?80:255]);
  });
}
test('decoder rejects corrupt, oversized, truncated and decompression-bomb PNGs', async () => {
  const corrupt = fixture(); corrupt[40] ^= 1;
  for (const png of [new Uint8Array(1048577),corrupt,fixture().subarray(0,100),fixture({width:512}),fixture({rawOverride:Buffer.alloc(300000)})]) await assert.rejects(decodeRadarPng(png));
});
test('historical summary preserves Ruby approach heuristic and overhead priority', () => {
  const obs = distances => distances.map((nearest_km,i)=>({nearest_km,time:epoch-600+i*100,direction:'N'}));
  assert.equal(summarizeRadar(obs([10,null,8,6]),epoch).status,'approaching');
  assert.equal(summarizeRadar(obs([10,9,8]),epoch).status,'nearby');
  assert.equal(summarizeRadar(obs([10,6,2]),epoch).status,'overhead');
  assert.equal(summarizeRadar(obs([10,6,null]),epoch).status,'dry');
});
test('complete fresh dry historical frames produce bounded non-nowcast result', async () => {
  let calls=0;
  const result = await analyzeRadar(metadata(),NOW,async (url,options) => {
    calls++;
    assert.match(url,/^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/\d+\/256\/7\/100\/62\/2\/0_0\.png$/);
    assert.equal(options.redirect,'error'); assert.ok(options.signal);
    return response(fixture());
  });
  assert.equal(result.status,'dry'); assert.equal(calls,3); assert.equal(result.historical_only,true);
  assert.equal(result.observed_at,NOW.toISOString()); assert.equal(result.partial_history,false);
});
test('nearest colored pixel, transparency threshold, radius and compass match heuristic', async () => {
  const x = Math.round(position.pixel_x), y = Math.round(position.pixel_y);
  const image = await decodeRadarPng(fixture({pixels:[[x,y,[50,50,50,20]],[x+5,y],[x+30,y]]}));
  const obs = analyzeImage(image,position,epoch);
  assert.equal(obs.direction,'E'); assert.ok(obs.nearest_km>5 && obs.nearest_km<7);
  assert.throws(()=>analyzeImage(image,{pixel_x:2,pixel_y:128},epoch),/clips/);
  const overhead = await analyzeRadar(metadata([epoch]),NOW,async()=>response(fixture({pixels:[[x,y]]})));
  assert.equal(overhead.status,'overhead');
});
test('fresh metadata cannot conceal stale actual radar observations', async () => {
  let calls=0;
  const result = await analyzeRadar(metadata([epoch-1801]),NOW,async()=>{calls++; return response(fixture());});
  assert.equal(result.available,false); assert.match(result.reason,/frame is stale/); assert.equal(calls,0);
});
test('accepts live opaque RainViewer frame IDs without relaxing host or path safety', async () => {
 const meta=metadata();
 meta.radar.past=meta.radar.past.map(frame=>({...frame,path:'/v2/radar/1acbcb3c0394'}));
 const result=await analyzeRadar(meta,NOW,async()=>response(fixture()));
 assert.equal(result.available,true);
 for(const path of ['/v2/radar/1acbcb3c0394?x=1','/v2/radar/1acbcb3c0394/../private','https://evil.test/1acbcb3c0394']){
  const bad={...meta,radar:{past:[{time:epoch,path}]}};
  assert.equal((await analyzeRadar(bad,NOW,()=>{throw Error('Must not fetch');})).available,false);
 }
});
test('missing latest frame fails closed; missing older frame is explicit partial history', async () => {
  const failed = await analyzeRadar(metadata(),NOW,async url => url.includes(`/${epoch}/`) ? new Response('',{status:503}) : response(fixture()));
  assert.equal(failed.available,false);
  const partial = await analyzeRadar(metadata(),NOW,async url => url.includes(`/${epoch-600}/`) ? new Response('',{status:503}) : response(fixture()));
  assert.equal(partial.available,true); assert.equal(partial.partial_history,true); assert.equal(partial.frames_analyzed,2);
});
test('rejects unsafe hosts, paths, future frames and stale/future metadata without fetching', async () => {
  const cases = [
    {...metadata(),host:'http://tilecache.rainviewer.com'},
    {...metadata(),host:'https://tilecache.rainviewer.com.evil.test'},
    {...metadata(),host:'https://tilecache.rainviewer.com@127.0.0.1'},
    {...metadata(),generated:epoch-1801}, {...metadata(),generated:epoch+1}, metadata([epoch+1]),
    {...metadata(),radar:{past:[{time:epoch,path:'/v2/radar/../../private'}]}}
  ];
  for (const item of cases) {
    const result = await analyzeRadar(item,NOW,()=>{throw new Error('Should not fetch');});
    assert.equal(result.available,false);
  }
});
test('sorts and deduplicates historical frames, limits to six, ignores nowcast', async () => {
  const times = Array.from({length:10},(_,i)=>epoch-i*100).reverse();
  const meta=metadata([...times,times[0]]);
  meta.radar.nowcast=[{time:epoch+600,path:'https://evil.test'}];
  let calls=0;
  const result=await analyzeRadar(meta,NOW,async()=>{calls++;return response(fixture());});
  assert.equal(result.frames_analyzed,6); assert.equal(calls,6);
});
test('HTTP, body limits and malformed content fail closed', async () => {
  for (const fetcher of [async()=>new Response('',{status:500}),async()=>new Response('bad'),async()=>new Response('',{headers:{'content-length':'1048577'}}),async()=>response(new Uint8Array(1048577))]) {
    assert.equal((await analyzeRadar(metadata([epoch]),NOW,fetcher)).available,false);
  }
});

const rubyCommand = process.env.RUBY || 'ruby';
const rubyAvailable = existsSync(new URL('../../lib/rlc_weather/geo.rb', import.meta.url)) && spawnSync(rubyCommand, ['--version']).status === 0;
test('geo and summary agree with the original Ruby implementation', { skip: !rubyAvailable && 'Ruby unavailable; set RUBY to check original parity' }, () => {
  const ruby = spawnSync(rubyCommand, ['-rjson', '-rtime', '-e', `
    require_relative './lib/rlc_weather/geo'
    require_relative './lib/rlc_weather/radar_analyzer'
    now = Time.parse('2026-10-11T12:00:00Z')
    analyzer = RlcWeather::RadarAnalyzer.new(source: nil, latitude: 3.1469, longitude: 101.6834)
    observations = [10.124, nil, 8.55, 6.24].each_with_index.map { |distance, i| {time: now - 600 + i * 100, nearest_km: distance, direction: 'N'} }
    puts JSON.generate({position: RlcWeather::Geo.tile_position(3.1469, 101.6834, 7), summary: analyzer.send(:summarize, observations, now)})
  `], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });
  assert.equal(ruby.status, 0, ruby.stderr);
  const original = JSON.parse(ruby.stdout);
  for (const field of Object.keys(position)) assert.ok(Math.abs(position[field]-original.position[field]) < 1e-9);
  const ours = summarizeRadar([10.124,null,8.55,6.24].map((nearest_km,i)=>({time:epoch-600+i*100,nearest_km,direction:'N'})),epoch);
  for (const field of ['available','status','nearest_km','direction','frames_analyzed','distances_km']) assert.deepEqual(ours[field],original.summary[field]);
});
