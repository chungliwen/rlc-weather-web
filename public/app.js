const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(value));
async function render() {
 try {
  const response = await fetch('/api/report',{cache:'no-store'}); if (!response.ok) throw new Error('No current report');
  const r = await response.json(), w = r.window || r.playing_window || {};
  $('notice').textContent = r.sample ? 'SAMPLE PREVIEW · Synthetic weather data, not current conditions' : r.report_stale ? 'Report is out of date. Current rain guidance is unavailable.' : `Updated on a ten-minute schedule. ${r.advisory || 'Individual sources may update less often.'}`;
  $('session').textContent = (w.status === 'current' ? 'CURRENT SESSION · ' : 'UPCOMING · ') + (w.session || 'Tennis');
  $('risk').textContent = r.report_stale ? 'Weather unavailable' : `${r.risk?.label || 'Unavailable'} rain risk`;
  $('window').textContent = w.start_at && w.end_at ? `${time(w.start_at)} – ${time(w.end_at)} MYT` : 'Malaysia time';
  $('evidence').textContent = (r.risk?.evidence || []).join('. ');
  const f=r.forecast||{}, a=r.air_quality||{}, d=r.radar||{};
  $('temperature').textContent = f.available && !f.stale && f.temperature_c != null ? `${Math.round(f.temperature_c)}°C` : 'Unavailable';
  $('forecast').textContent = f.available && !f.stale ? `${f.precipitation_mm ?? '—'} mm forecast across the playing window · MET Norway` : f.reason || 'Forecast is stale or missing';
  $('aqi').textContent = a.available && !a.stale ? `${a.aqi} US AQI` : 'Unavailable';
  $('aqi-detail').textContent = a.available && !a.stale ? `${a.category} · ${a.name} city-level · ${time(a.observed_at)} MYT` : a.reason || 'City-level reading is stale or missing';
  $('radar').textContent = d.available && !d.stale ? (d.status === 'dry' ? 'No nearby echo' : d.status) : 'Unavailable';
  $('radar-detail').textContent = d.available && !d.stale ? `Past observation: ${time(d.observed_at)} MYT. No future nowcast.` : d.reason || 'Past observations unavailable';
  $('updated').textContent = `Report generated ${time(r.generated_at)} MYT${r.report_stale ? ' · OUT OF DATE' : ''}`;
  $('attribution').replaceChildren();
  for (const [i,source] of (r.attribution || []).entries()) {
   if(i) $('attribution').append(' · ');
   const link=document.createElement('a');link.textContent=source.name;
   if(/^https:\/\/(www\.met\.no|www\.rainviewer\.com|www\.iqair\.com)(\/|$)/.test(source.url))link.href=source.url;
   $('attribution').append(link); if(source.license)$('attribution').append(` (${source.license})`);
  }
 } catch { $('notice').textContent='Weather report unavailable. Please check again shortly.'; $('risk').textContent='Waiting for a report'; for(const id of ['evidence','window','forecast','aqi-detail','radar-detail','updated']) $(id).textContent=''; for(const id of ['temperature','aqi','radar']) $(id).textContent='Unavailable'; }
}
render(); setInterval(render,60_000);
