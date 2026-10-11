// Node/VPS adapter. Same scheduled refresh and report handler as Cloudflare.
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import worker,{refresh} from '../src/index.js';
export function nodeEnvironment(directory,variables=process.env){
 const root=resolve(directory);
 return {...variables, WEATHER:{
  async get(key){try{return JSON.parse(await readFile(join(root,'state.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},
  async put(key,value){await mkdir(root,{recursive:true,mode:0o700});const temporary=join(root,`state.${process.pid}.tmp`);await writeFile(temporary,value,{mode:0o600});await rename(temporary,join(root,'state.json'));}
 },ASSETS:{async fetch(request){
  const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
  const selected=files[new URL(request.url).pathname];if(!selected)return new Response('Not found',{status:404});
  return new Response(await readFile(new URL('../public/'+selected[0],import.meta.url)),{headers:{'content-type':selected[1]+'; charset=utf-8','x-content-type-options':'nosniff'}});
 }}};
}
export async function runOnce(directory,variables=process.env,now=new Date(),fetcher=fetch){
 await mkdir(directory,{recursive:true,mode:0o700});const lock=join(directory,'refresh.lock');
 let handle;try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw new Error('A refresh lock exists; inspect active jobs before removing a stale lock');throw error;}
 try{return await refresh(nodeEnvironment(directory,variables),now,fetcher);}finally{await handle.close();await unlink(lock);}
}
export function serve(directory,variables=process.env){
 const env=nodeEnvironment(directory,variables);
 return createServer(async(req,res)=>{
  try{const response=await worker.fetch(new Request(new URL(req.url,'http://localhost'),{method:req.method}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}
  catch{res.writeHead(503);res.end('Service temporarily unavailable');}
 }).listen(Number(variables.PORT||8788),variables.BIND_HOST==='0.0.0.0'?'0.0.0.0':'127.0.0.1');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const directory=resolve(process.env.WEATHER_DATA_DIR||'.weather-data');
 if(process.argv.includes('--once')){try{const r=await runOnce(directory);console.log(JSON.stringify({generated_at:r.generated_at,risk:r.risk.label,sources:r.sources}));}catch{console.error('Weather refresh failed; inspect configuration, storage and lock');process.exitCode=1;}}
 else if(process.argv.includes('--serve'))serve(directory);
 else{console.error('Usage: node scripts/node-adapter.js --once | --serve');process.exitCode=1;}
}
