export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=3.1469&lon=101.6834';
export const RADAR_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const MINUTE = 60_000;

export async function boundedJson(response, maxBytes = 2_000_000) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Response too large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const all = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(all));
}

export function normalizeIqair(payload) {
  const d = payload?.data, p = d?.current?.pollution;
  if (payload?.status !== 'success' || d.city !== 'Kuala Lumpur' || d.state !== 'Kuala Lumpur' || d.country !== 'Malaysia' || !Number.isInteger(p?.aqius) || p.aqius < 0) throw new Error('Invalid IQAir data');
  const timestamp = p.ts;
  if (typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new Error('Invalid IQAir timestamp');
  const date = timestamp.slice(0,10), parsed = new Date(date + 'T00:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0,10) !== date) throw new Error('Invalid IQAir calendar date');
  return {aqi: p.aqius, metric: 'US AQI', provider: 'IQAir', coverage: 'city-level', name: d.city, state: d.state, country: d.country, observed_at: new Date(timestamp).toISOString(), source_url: 'https://www.iqair.com/air-quality/malaysia/kuala-lumpur/kuala-lumpur'};
}

// Only these fixed destinations receive requests. Errors never include URLs, bodies or keys.
export async function refreshProvider(name, previous, env, now, fetcher = fetch) {
  const ms = +new Date(now), old = previous || {};
  if (name === 'iqair' && (env.IQAIR_ENABLED !== 'true' || env.IQAIR_DISPLAY_RIGHTS_CONFIRMED !== 'true' || !env.IQAIR_API_KEY)) return {status: 'disabled', reason: 'IQAir requires a server-side key and confirmed display rights'};
  if (name === 'met' && !/^.{5,}(?:https?:\/\/|@).+/.test(env.MET_USER_AGENT || '')) return {status: 'unavailable', reason: 'MET requires a real identifying application/contact User-Agent'};
  if (old.next_check > ms) return old;
  const iqMinutes = Math.max(120, Number(env.IQAIR_REFRESH_MINUTES) || 120);
  const interval = (name === 'iqair' ? iqMinutes : 10) * MINUTE;
  let url = name === 'met' ? MET_URL : RADAR_URL;
  const headers = {Accept: 'application/json'};
  if (name === 'met') {
    headers['User-Agent'] = env.MET_USER_AGENT;
    if (old.last_modified) headers['If-Modified-Since'] = old.last_modified;
    if (old.etag) headers['If-None-Match'] = old.etag;
  }
  if (name === 'iqair') url = 'https://api.airvisual.com/v2/city?' + new URLSearchParams({city:'Kuala Lumpur',state:'Kuala Lumpur',country:'Malaysia',key:env.IQAIR_API_KEY});
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(url, {headers, signal: controller.signal, redirect: 'error'});
    let expiry = Date.parse(response.headers.get('expires'));
    // MET Expires is a lower bound on the next permitted refresh, including 304s.
    const next_check = Math.max(ms + interval, Number.isFinite(expiry) ? expiry : 0);
    if (response.status === 304 && old.data) return {...old, status:'ok', checked_at:new Date(ms).toISOString(), next_check, last_modified:response.headers.get('last-modified') || old.last_modified, etag:response.headers.get('etag') || old.etag, reason:undefined};
    if (!response.ok) {
      let retry = Number(response.headers.get('retry-after')) * 1000;
      if (!Number.isFinite(retry) || !retry) retry = Date.parse(response.headers.get('retry-after')) - ms;
      throw Object.assign(new Error('Provider unavailable'), {retry: Math.max(interval, Number.isFinite(retry) ? retry : 0)});
    }
    let data = await boundedJson(response);
    if (name === 'met' && (!Array.isArray(data?.properties?.timeseries) || !Number.isFinite(Date.parse(data?.properties?.meta?.updated_at)))) throw new Error('Invalid forecast');
    if (name === 'radar' && (!Array.isArray(data?.radar?.past) || !Number.isFinite(data?.generated))) throw new Error('Invalid radar metadata');
    if (name === 'iqair') data = normalizeIqair(data);
    return {data, status:'ok', fetched_at:new Date(ms).toISOString(), checked_at:new Date(ms).toISOString(), next_check, last_modified:response.headers.get('last-modified'), etag:response.headers.get('etag')};
  } catch (error) {
    return {...old, status: old.data ? 'degraded' : 'unavailable', reason: `${name} refresh failed; retained data may be stale`, checked_at:new Date(ms).toISOString(), next_check:ms + Math.max(interval, error.retry || 0)};
  } finally { clearTimeout(timer); }
}
