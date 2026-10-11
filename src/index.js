import { refreshProvider } from './providers.js';
import { forecast, airQuality, selectWindow, buildReport } from './weather.js';
import { analyzeRadar } from './radar.js';

export const STATE_KEY = 'weather:v1';
const unavailable = reason => ({available: false, reason});
export async function refresh(env, now = new Date(), fetcher = fetch) {
  if (!env.WEATHER) throw new Error('WEATHER KV binding required');
  const old = await env.WEATHER.get(STATE_KEY, 'json') || {};
  // KV is eventually consistent; one cron is the only writer. No public refresh endpoint.
  const providers = {};
  await Promise.all(['met','radar','iqair'].map(async name => {providers[name] = await refreshProvider(name, old.providers?.[name], env, now, fetcher);}));
  const window = selectWindow(now);
  let met = unavailable(providers.met.reason || 'Forecast unavailable');
  if (providers.met.data) {
    try { met = forecast(providers.met.data, now, window.start_at, window.end_at); } catch { met = unavailable('Forecast data invalid'); }
  }
  let radar = unavailable('Historical radar unavailable');
  if (providers.radar.data) {
    const generation = providers.radar.data.generated;
    // Reuse decoded observations while their exact metadata generation is cached.
    if (old.radar_generation === generation && old.radar_result?.available) radar = old.radar_result;
    else { try { radar = await analyzeRadar(providers.radar.data, now, fetcher); } catch { radar = unavailable('Historical radar unavailable'); } }
  }
  const aqi = providers.iqair.data ? airQuality(providers.iqair.data, now) : unavailable(providers.iqair.reason || 'IQAir unavailable');
  const report = buildReport({forecast: met, radar, air_quality: aqi}, now);
  report.sources = Object.fromEntries(Object.entries(providers).map(([name,p]) => [name, {status:p.status, checked_at:p.checked_at || null, fetched_at:p.fetched_at || null, reason:p.reason || null}]));
  report.schema_version = 1;
  report.location = {name:'Royal Lake Club', latitude:3.1469, longitude:101.6834, timezone:'Asia/Kuala_Lumpur'};
  report.attribution = [
    {name:'MET Norway', url:'https://www.met.no/en', license:'CC BY 4.0', license_url:'https://creativecommons.org/licenses/by/4.0/'},
    {name:'RainViewer', url:'https://www.rainviewer.com', note:'Past radar observations only; no nowcast'}
  ];
  if (aqi.available) report.attribution.push({name:'IQAir',url:aqi.source_url,note:'City-level US AQI, not a club-local measurement'});
  await env.WEATHER.put(STATE_KEY, JSON.stringify({providers, report, radar_generation:providers.radar.data?.generated, radar_result:radar}));
  return report;
}

export function publicReport(saved, now = new Date()) {
  const currentWindow = selectWindow(now);
  const sameWindow = saved.window?.start_at === currentWindow.start_at && saved.window?.end_at === currentWindow.end_at;
  const states = {forecast: sameWindow ? saved.forecast : unavailable('Waiting for the next playing-window forecast'), radar:saved.radar, air_quality:saved.air_quality};
  const report = {...structuredClone(saved), ...buildReport(states, now), generated_at:saved.generated_at};
  const age = (+new Date(now) - Date.parse(saved.generated_at)) / 60_000;
  report.report_age_minutes = Number.isFinite(age) ? Math.max(0, Math.floor(age)) : null;
  report.report_stale = !Number.isFinite(age) || age < 0 || age > 20;
  if (report.report_stale) {
    report.risk = {score:null,label:'Unavailable',confidence:'Low',evidence:['Scheduled report is out of date; refresh is pending']};
    report.data_complete = false;
    report.advisory = 'Report is out of date. Check local conditions and official updates.';
    for (const source of ['forecast','radar','air_quality']) if (report[source]) report[source].stale = true;
  }
  return report;
}

export default {
  async scheduled(controller, env, ctx) {
    // Propagate failures so Cloudflare records an unsuccessful cron invocation.
    return refresh(env, new Date(controller.scheduledTime));
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) {
      const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
      if (!['GET','HEAD'].includes(request.method)) return new Response(JSON.stringify({error:'Method not allowed'}), {status:405,headers:{...headers,allow:'GET, HEAD'}});
      if (path !== '/api/report') return new Response(JSON.stringify({error:'Not found'}),{status:404,headers});
      try {
        const saved = await env.WEATHER?.get(STATE_KEY,'json');
        if (!saved?.report) return new Response(request.method === 'HEAD' ? null : JSON.stringify({error:'No report yet. Waiting for a scheduled refresh.'}),{status:503,headers});
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(publicReport(saved.report)),{headers});
      } catch {return new Response(JSON.stringify({error:'Report storage temporarily unavailable'}),{status:503,headers});}
    }
    return env.ASSETS.fetch(request);
  }
};
