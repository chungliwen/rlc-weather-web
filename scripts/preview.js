import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {sampleReport} from './sample.js';
const paths=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/style.css',['style.css','text/css']]]);
const server=createServer(async(req,res)=>{
 if(req.url==='/api/report'){res.setHeader('content-type','application/json');res.end(JSON.stringify(sampleReport()));return;}
 const path=paths.get(new URL(req.url,'http://localhost').pathname);if(!path){res.writeHead(404);res.end('Not found');return;}
 res.setHeader('content-type',path[1]);res.end(await readFile(new URL('../public/'+path[0],import.meta.url)));
});
server.listen(Number(process.env.PORT||8788),'127.0.0.1',()=>console.log('Synthetic preview only: http://127.0.0.1:'+(process.env.PORT||8788)));
