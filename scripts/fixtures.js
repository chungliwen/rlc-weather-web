export function sampleForecast(now = new Date('2026-10-11T06:00:00Z')) {
 return {properties:{meta:{updated_at:new Date(+now-1800000).toISOString()},timeseries:Array.from({length:36},(_,i)=>({time:new Date(Math.floor(+now/3600000)*3600000+i*3600000).toISOString(),data:{instant:{details:{air_temperature:30,relative_humidity:74,wind_speed:2}},next_1_hours:{details:{precipitation_amount:0.2},summary:{symbol_code:'lightrainshowers_day'}}}}))}};
}
