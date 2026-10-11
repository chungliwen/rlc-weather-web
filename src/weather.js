/** Pure calculations. All input timestamps represent instants; tennis sessions use MYT (UTC+8). */
const HOUR = 3600000;
const MINUTE = 60000;
const MYT = 8 * HOUR;
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const instant = (value) => value == null || value === '' ? NaN : new Date(value).getTime();
const unavailable = (reason) => ({ available: false, reason });
const age = (value, now) => (instant(now) - instant(value)) / MINUTE;
const iso = (value) => new Date(value).toISOString();

export function selectWindow(now = new Date()) {
  const timestamp = instant(now);
  if (!Number.isFinite(timestamp)) throw new TypeError('Invalid current time');
  const local = new Date(timestamp + MYT);
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - MYT;
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  let slot, session, start, end;
  // At 08:00 the later overlapping morning session becomes the relevant window.
  if (minute < 480) [slot, session, start, end] = ['0600', 'Morning tennis', 390, 540];
  else if (minute < 660) [slot, session, start, end] = ['0800', 'Late morning tennis', 480, 660];
  else if (minute < 1170) [slot, session, start, end] = [minute < 960 ? '1400' : '1600', 'Evening tennis', 990, 1170];
  else {
    day += 24 * HOUR;
    [slot, session, start, end] = ['0600', 'Morning tennis', 390, 540];
  }
  const startAt = day + start * MINUTE, endAt = day + end * MINUTE;
  return { slot, session, timezone: 'Asia/Kuala_Lumpur', start_at: iso(startAt), end_at: iso(endAt),
    status: timestamp >= startAt ? 'current' : 'upcoming' };
}

export function forecast(payload, now = new Date(), startAt = now, endAt = new Date(instant(now) + 2 * HOUR)) {
  const current = instant(now), start = Math.max(instant(startAt), current), end = instant(endAt);
  const generated = instant(payload?.properties?.meta?.updated_at);
  if (![current, start, end, generated].every(Number.isFinite) || end <= start)
    return unavailable('Invalid forecast timestamps or playing window');
  if (generated > current) return unavailable('MET Norway forecast timestamp is in the future');
  const entries = payload?.properties?.timeseries;
  if (!Array.isArray(entries)) return unavailable('MET Norway forecast unavailable');
  const upcoming = entries.map((entry) => ({ time: instant(entry?.time), data: entry?.data }))
    .filter((entry) => entry.time < end && entry.time + HOUR > start).sort((a, b) => a.time - b.time);
  if (!upcoming.length) return unavailable('No MET Norway forecast for the playing window');
  let coveredUntil = start;
  const probabilities = [], amounts = [], symbols = [];
  for (const entry of upcoming) {
    const details = entry.data?.next_1_hours?.details;
    const p = details?.probability_of_precipitation, mm = details?.precipitation_amount;
    if (entry.time > coveredUntil || !details || (!numeric(p) && !numeric(mm)) ||
        (p != null && (!numeric(p) || p < 0 || p > 100)) || (mm != null && (!numeric(mm) || mm < 0)))
      return unavailable('Incomplete hourly rain forecast for the playing window');
    coveredUntil = Math.max(coveredUntil, entry.time + HOUR);
    if (numeric(p)) probabilities.push(p);
    if (numeric(mm)) amounts.push(mm);
    symbols.push(entry.data?.next_1_hours?.summary?.symbol_code);
  }
  if (coveredUntil < end) return unavailable('Incomplete hourly rain forecast for the playing window');
  const total = amounts.reduce((a, b) => a + b, 0);
  const probability = probabilities.length ? Math.max(...probabilities) : null;
  let score = probability ?? (total === 0 ? 10 : total < .2 ? 25 : total < 1 ? 45 : total < 5 ? 65 : 80);
  if (symbols.some((symbol) => typeof symbol === 'string' && symbol.includes('thunder'))) score = Math.max(score, 70);
  const first = upcoming[0].data?.instant?.details ?? {};
  return { available: true, generated_at: iso(generated), stale: current - generated > 12 * HOUR,
    temperature_c: numeric(first.air_temperature) ? first.air_temperature : null,
    humidity_percent: numeric(first.relative_humidity) ? first.relative_humidity : null,
    wind_mps: numeric(first.wind_speed) ? first.wind_speed : null, symbol: symbols[0] ?? null,
    max_probability: probability, precipitation_mm: amounts.length ? Math.round(total * 10) / 10 : null,
    score: Math.round(score), window_start_at: iso(start), window_end_at: iso(end) };
}

export function category(aqi) {
  return aqi <= 50 ? 'Good' : aqi <= 100 ? 'Moderate' : aqi <= 150 ? 'Unhealthy for sensitive groups' :
    aqi <= 200 ? 'Unhealthy' : aqi <= 300 ? 'Very unhealthy' : 'Hazardous';
}
export function guidance(aqi) {
  return aqi <= 50 ? 'No outdoor-activity restriction indicated.' : aqi <= 100 ?
    'Unusually sensitive members should consider reducing prolonged or strenuous outdoor play.' : aqi <= 150 ?
    'Sensitive members should reduce prolonged or strenuous outdoor play.' : aqi <= 200 ?
    'Everyone should reduce prolonged or strenuous outdoor play; sensitive members should avoid it.' : aqi <= 300 ?
    'Everyone should avoid strenuous outdoor play; sensitive members should avoid outdoor activity.' :
    'Avoid outdoor activity and follow official health advice.';
}
export function airQuality(reading, now = new Date()) {
  if (reading?.available === false || reading?.metric !== 'US AQI' || !numeric(reading.aqi) ||
      !Number.isInteger(reading.aqi) || reading.aqi < 0 || !Number.isFinite(instant(reading.observed_at)))
    return unavailable(reading?.reason || 'US AQI reading unavailable');
  const minutes = age(reading.observed_at, now);
  if (!Number.isFinite(minutes)) return unavailable('Invalid current time');
  if (minutes < 0) return unavailable('IQAir observation timestamp is in the future');
  return { ...reading, observed_at: iso(reading.observed_at), available: true, stale: reading.stale === true || minutes > 120,
    age_minutes: Math.round(minutes), category: category(reading.aqi), guidance: guidance(reading.aqi) };
}
export function heatIndexC(temperature, humidity) {
  if (!numeric(temperature) || !numeric(humidity)) return null;
  if (temperature < 26.7 || humidity < 40) return temperature;
  const f = temperature * 9 / 5 + 32;
  const index = -42.379 + 2.04901523*f + 10.14333127*humidity - .22475541*f*humidity -
    .00683783*f*f - .05481717*humidity*humidity + .00122874*f*f*humidity +
    .00085282*f*humidity*humidity - .00000199*f*f*humidity*humidity;
  return (index - 32) * 5 / 9;
}
function fresh(source, timestamp, maximumMinutes, now) {
  const minutes = age(source?.[timestamp], now);
  return source?.available === true && source.stale !== true && Number.isFinite(minutes) && minutes >= 0 && minutes <= maximumMinutes;
}
export function buildReport(sourceStates = {}, now = new Date()) {
  const window = selectWindow(now);
  let f = sourceStates.forecast ?? unavailable('MET Norway forecast unavailable');
  let r = sourceStates.radar ?? unavailable('Radar unavailable');
  const a = airQuality(sourceStates.air_quality, now);
  const forecastUsable = fresh(f, 'generated_at', 720, now) && numeric(f.score) && f.score >= 0 && f.score <= 100;
  const radarUsable = fresh(r, 'observed_at', 30, now) && fresh(r, 'generated_at', 30, now) &&
    ['dry', 'nearby', 'approaching', 'overhead'].includes(r.status);
  if (!forecastUsable) f = { ...f, available: false, reason: f.reason || 'Forecast is stale or invalid' };
  if (!radarUsable) r = { ...r, available: false, reason: r.reason || 'Radar is stale or invalid' };
  let risk = { score: null, label: 'Unavailable', confidence: 'Low', evidence: ['Fresh forecast unavailable for the playing window'] };
  if (forecastUsable) {
    let score = f.score;
    const evidence = [];
    if (radarUsable) {
      const radarScore = { dry: 15, nearby: 55, approaching: 80, overhead: 95 }[r.status];
      score = window.slot === '1400' ? score * .75 + radarScore * .25 : window.slot === '1600' ? score * .35 + radarScore * .65 : Math.max(score, radarScore);
      evidence.push(r.status === 'dry' ? 'No rain detected within 20 km' : r.status === 'overhead' ?
        'Rain detected over or very close to RLC' : `Rain about ${r.nearest_km} km ${r.direction} of RLC${r.status === 'approaching' ? ' and approaching' : ''}`);
    } else evidence.push('Radar unavailable; rain risk is forecast-only');
    score = Math.round(score);
    risk = { score, label: score < 30 ? 'Low' : score < 55 ? 'Moderate' : score < 80 ? 'High' : 'Very high',
      confidence: radarUsable ? (['approaching', 'overhead'].includes(r.status) ? 'Medium–high' : 'Medium') : 'Low', evidence };
  }
  const complete = forecastUsable && radarUsable && a.available && !a.stale;
  const advisory = complete ? 'Guidance only. Check the court and changing conditions before playing.' :
    'Incomplete or stale data. Do not use this report as a reliable go/no-go decision; check local conditions and official updates.';
  return { generated_at: iso(now), slot: window.slot, window, risk, forecast: f, radar: r, air_quality: a,
    feels_like_c: forecastUsable ? heatIndexC(f.temperature_c, f.humidity_percent) : null,
    data_complete: Boolean(complete), advisory };
}
