import { writeFile } from 'node:fs/promises';
import { buildReport, forecast, selectWindow } from '../src/weather.js';
import {sampleForecast} from './fixtures.js';
export function sampleReport() {
 const now=new Date('2026-10-11T06:00:00Z'),w=selectWindow(now);
 const report=buildReport({forecast:forecast(sampleForecast(now),now,w.start_at,w.end_at),radar:{available:true,status:'nearby',nearest_km:8.2,direction:'W',observed_at:'2026-10-11T05:50:00Z',generated_at:'2026-10-11T05:55:00Z'},air_quality:{metric:'US AQI',aqi:42,observed_at:'2026-10-11T05:00:00Z',name:'Kuala Lumpur'}},now);
 return {...report,sample:true,report_stale:false,attribution:[{name:'MET Norway',url:'https://www.met.no/en',license:'CC BY 4.0'},{name:'RainViewer',url:'https://www.rainviewer.com'},{name:'IQAir',url:'https://www.iqair.com/air-quality/malaysia/kuala-lumpur/kuala-lumpur'}]};
}
if (process.argv[1]?.endsWith('/sample.js')) {await writeFile(new URL('../sample-report.json',import.meta.url),JSON.stringify(sampleReport(),null,2)+'\n');console.log('Wrote synthetic sample-report.json');}
