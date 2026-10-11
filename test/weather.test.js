import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { forecast, airQuality, category, guidance, heatIndexC, selectWindow, buildReport } from '../src/weather.js';

const now = '2026-09-15T06:00:00Z';
function payload(amount = 0, probability = 10, symbol = 'clearsky_day') {
  return { properties: { meta: { updated_at: '2026-09-15T05:00:00Z' }, timeseries: [6,7,8,9,10,11].map(hour => ({
    time: `2026-09-15T${String(hour).padStart(2,'0')}:00:00Z`, data: {
      instant: { details: { air_temperature: 30, relative_humidity: 79, wind_speed: 2.1 } },
      next_1_hours: { details: { precipitation_amount: amount, ...(probability == null ? {} : { probability_of_precipitation: probability }) }, summary: { symbol_code: symbol } }
    }
  })) } };
}
const freshSources = () => ({ forecast: { available: true, score: 60, generated_at: now, temperature_c: 30, humidity_percent: 79 },
  radar: { available: true, generated_at: now, observed_at: now, status: 'approaching', nearest_km: 8.2, direction: 'W' },
  air_quality: { metric: 'US AQI', aqi: 165, observed_at: now, name: 'Kuala Lumpur' } });

test('selects overlapping hours and preserves rain scoring', () => {
  const result = forecast(payload(1.5,65), now, '2026-09-15T06:30:00Z', '2026-09-15T08:30:00Z');
  assert.equal(result.score,65); assert.equal(result.precipitation_mm,4.5);
  assert.equal(forecast(payload(0,10,'thunderstorm'),now).score,70);
  for (const [mm, score] of [[0,10],[.05,25],[.1,45],[.5,65],[2.5,80]])
    assert.equal(forecast(payload(mm,null),now).score,score);
});
test('rejects incomplete, malformed, future data and expired windows', () => {
  const p = payload(); delete p.properties.timeseries[1].data.next_1_hours;
  assert.equal(forecast(p,now).available,false);
  const gap = payload(); gap.properties.timeseries.splice(1,1);
  assert.equal(forecast(gap,now).available,false);
  assert.equal(forecast({},now).available,false);
  assert.equal(forecast(payload(-1),now).available,false);
  assert.equal(forecast(payload(0,101),now).available,false);
  assert.equal(forecast(payload(), '2026-09-15T04:00:00Z').available,false);
  assert.equal(forecast(payload(),now,now,now).available,false);
});
test('forecast staleness uses exact twelve-hour threshold', () => {
  const p = payload(); p.properties.meta.updated_at = '2026-09-14T18:00:00Z';
  assert.equal(forecast(p,now).stale,false);
  p.properties.meta.updated_at = '2026-09-14T17:59:59Z';
  assert.equal(forecast(p,now).stale,true);
});
test('AQI categories, UTC age, exact freshness threshold and future validation', () => {
  for (const [aqi, expected] of [[0,'Good'],[50,'Good'],[51,'Moderate'],[100,'Moderate'],[101,'Unhealthy for sensitive groups'],[150,'Unhealthy for sensitive groups'],[151,'Unhealthy'],[200,'Unhealthy'],[201,'Very unhealthy'],[300,'Very unhealthy'],[301,'Hazardous'],[501,'Hazardous']]) assert.equal(category(aqi),expected);
  const reading = { metric: 'US AQI', aqi: 87, observed_at: '2026-09-15T12:00:00+08:00' };
  assert.equal(airQuality(reading,now).stale,false);
  assert.equal(airQuality(reading,'2026-09-15T06:00:01Z').stale,true);
  assert.equal(airQuality({...reading,observed_at:'2026-09-15T06:00:01Z'},now).available,false);
  for (const aqi of [-1, '87', NaN, Infinity, 50.5, null]) assert.equal(airQuality({...reading,aqi},now).available,false);
  assert.equal(airQuality({...reading,metric:'Malaysian API'},now).available,false);
});
test('current and next windows use MYT, including overnight and year rollovers', () => {
  const cases = [
    ['2026-09-15T06:29:59+08:00','0600','upcoming','2026-09-14T22:30:00.000Z'],
    ['2026-09-15T06:30:00+08:00','0600','current','2026-09-14T22:30:00.000Z'],
    ['2026-09-15T07:59:59+08:00','0600','current','2026-09-14T22:30:00.000Z'],
    ['2026-09-15T08:00:00+08:00','0800','current','2026-09-15T00:00:00.000Z'],
    ['2026-09-15T10:59:59+08:00','0800','current','2026-09-15T00:00:00.000Z'],
    ['2026-09-15T11:00:00+08:00','1400','upcoming','2026-09-15T08:30:00.000Z'],
    ['2026-09-15T16:00:00+08:00','1600','upcoming','2026-09-15T08:30:00.000Z'],
    ['2026-09-15T16:30:00+08:00','1600','current','2026-09-15T08:30:00.000Z'],
    ['2026-09-15T19:29:59+08:00','1600','current','2026-09-15T08:30:00.000Z'],
    ['2026-09-15T19:30:00+08:00','0600','upcoming','2026-09-15T22:30:00.000Z'],
    ['2026-12-31T23:59:59+08:00','0600','upcoming','2026-12-31T22:30:00.000Z']
  ];
  for (const [time,slot,status,start] of cases) {
    const w=selectWindow(time); assert.equal(w.slot,slot); assert.equal(w.status,status); assert.equal(w.start_at,start);
    assert.ok(Date.parse(w.end_at)>Date.parse(time));
  }
});
test('remaining current window excludes already elapsed rain', () => {
  const p=payload(0,10); p.properties.timeseries[0].data.next_1_hours.details.probability_of_precipitation=100;
  assert.equal(forecast(p,'2026-09-15T07:00:00Z',now,'2026-09-15T08:00:00Z').score,10);
});
test('report preserves blending, heat index and explicit uncertainty', () => {
  const report=buildReport(freshSources(),now);
  assert.equal(report.risk.score,65); assert.equal(report.risk.label,'High');
  assert.equal(Math.round(report.feels_like_c),37); assert.equal(report.data_complete,true);
  const sources=freshSources(); sources.radar.stale=true;
  const missing=buildReport(sources,now);
  assert.equal(missing.risk.score,60); assert.equal(missing.risk.confidence,'Low'); assert.equal(missing.data_complete,false);
  assert.match(missing.advisory,/Do not use/);
  sources.forecast.stale=true;
  assert.equal(buildReport(sources,now).risk.score,null);
});
test('stale or undated radar never makes low forecast into a reliable decision', () => {
  const sources=freshSources(); sources.radar.observed_at='2026-09-15T05:29:59Z';
  assert.equal(buildReport(sources,now).radar.available,false);
  sources.radar.observed_at=now; delete sources.radar.generated_at;
  assert.equal(buildReport(sources,now).radar.available,false);
  const noForecast=freshSources(); noForecast.forecast.available=false;
  assert.equal(buildReport(noForecast,now).risk.label,'Unavailable');
  assert.equal(buildReport({},now).data_complete,false);
});

// Runs the original Ruby classes, not a rewritten reference implementation. Set RUBY to opt in
// wherever Ruby is not on PATH. Fixtures are generated here and contain no operational settings.
const root = fileURLToPath(new URL('../../', import.meta.url));
const ruby = process.env.RUBY || 'ruby';
const rubyAvailable = existsSync(new URL('../../lib/rlc_weather/forecast.rb', import.meta.url)) && spawnSync(ruby,['--version']).status === 0;
test('matches actual Ruby forecast, AQI guidance, heat index and report scores', { skip: !rubyAvailable && 'Ruby unavailable; run with RUBY=/path/to/ruby for reference parity' }, () => {
  const inputs = [payload(0,10),payload(.05,null),payload(.1,null),payload(.5,null),payload(2.5,null),payload(0,10,'thunderstorm'),payload(1.5,65)];
  const aqiValues=[0,50,51,100,101,150,151,200,201,300,301,501];
  const source = `require 'json'; require 'time'; require_relative './lib/rlc_weather/forecast'; require_relative './lib/rlc_weather/air_quality'; require_relative './lib/rlc_weather/report'
input=JSON.parse(STDIN.read); now=Time.iso8601(input['now'])
forecasts=input['payloads'].map { |p| RlcWeather::Forecast.new(payload:p,now:now).result }
air=input['aqis'].map { |a| { category:RlcWeather::AirQuality.category(a),guidance:RlcWeather::AirQuality.guidance(a) } }
reports=%w[0600 0800 1400 1600].map { |slot| r=RlcWeather::Report.new(slot:slot,now:now,forecast:{available:true,score:60},radar:{available:true,status:'approaching',nearest_km:8.2,direction:'W'},air_quality:{available:false}); {risk:r.send(:combined_risk),heat:r.send(:heat_index_c,30,79)} }
puts JSON.generate({forecasts:forecasts,air:air,reports:reports})`;
  const run=spawnSync(ruby,['-e',source],{cwd:root,input:JSON.stringify({now,payloads:inputs,aqis:aqiValues}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const reference=JSON.parse(run.stdout);
  inputs.forEach((p,i)=>{
    const actual=forecast(p,now), expected=reference.forecasts[i];
    for (const key of ['score','max_probability','precipitation_mm','temperature_c','humidity_percent','wind_mps','symbol','stale','available']) assert.equal(actual[key],expected[key],`${i}: ${key}`);
  });
  aqiValues.forEach((aqi,i)=>assert.deepEqual({category:category(aqi),guidance:guidance(aqi)},reference.air[i]));
  ['2026-09-15T06:00:00+08:00','2026-09-15T08:00:00+08:00','2026-09-15T14:00:00+08:00','2026-09-15T16:00:00+08:00'].forEach((time,i)=>{
    const s=freshSources();s.forecast.generated_at=time;s.radar.generated_at=time;s.radar.observed_at=time;s.air_quality.observed_at=time;
    const r=buildReport(s,time); assert.equal(r.risk.score,reference.reports[i].risk.score); assert.equal(r.risk.label,reference.reports[i].risk.label);
    assert.ok(Math.abs(heatIndexC(30,79)-reference.reports[i].heat)<1e-9);
  });
});
