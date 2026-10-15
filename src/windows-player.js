import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {normalizeUrl} from './core.js';
const cancelled=()=>Object.assign(new Error('Playback cancelled.'),{name:'AbortError'});

// A warm native player rewinds the current MediaSource instead of starting
// PowerShell and opening a fresh HTTP stream on every button press.
export class WindowsStreamPlayer {
 constructor({spawn,fetcher,scriptDirectory,ptt}) {
  Object.assign(this,{spawn,fetcher,scriptDirectory,ptt});this.generation=0;this.routes=new Map();this.key='';this.queue=Promise.resolve();
 }
 enqueue(operation){const task=this.queue.catch(()=>{}).then(operation);this.queue=task;return task;}
 async prepare() {
  if(this.starting)return this.starting;
  if(this.child)return;
  this.starting=this.start().finally(()=>{this.starting=undefined;});
  return this.starting;
 }
 async start() {
  const server=createServer(async(req,res)=>{
   const route=this.routes.get(req.url);
   if(!route || !['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
   const abort=new AbortController();res.on('close',()=>abort.abort());
   try {
    const response=await this.fetcher(route.url,{method:req.method,headers:{'X-StreamDeck-Account':route.token,'Accept-Encoding':'identity',...(req.headers.range?{Range:req.headers.range}:{})},redirect:'error',signal:abort.signal});
    const headers={};for(const name of ['content-type','content-length','content-range','accept-ranges'])if(response.headers.has(name))headers[name]=response.headers.get(name);
    res.writeHead(response.status,{...headers,'Cache-Control':'no-store'});
    if(req.method==='HEAD' || !response.body)res.end();else await pipeline(Readable.fromWeb(response.body),res);
   }catch{if(!res.headersSent){res.writeHead(502);res.end();}else res.destroy();}
  });
  this.server=server;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {await new Promise((resolve,reject)=>{
   const child=this.spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(this.scriptDirectory,'player-host.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GIRO_PARENT_PID:String(process.pid)}});
   this.child=child;let buffer='',ready=false,errors='';
   const timer=setTimeout(()=>{child.kill();reject(new Error('Audio host startup timed out.'));},40000);
   child.stdin.on('error',error=>this.onError?.(error));
   child.stdout.on('data',chunk=>{
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){
     const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
     if(line==='HOST_READY'){ready=true;clearTimeout(timer);resolve();}
     else if(line.startsWith('PROGRESS:')){
      const timing=/^PROGRESS:(\d+):(\d+):(\d+)$/.exec(line);
      if(timing && Number(timing[1])===this.generation)this.onProgress?.({positionMs:Number(timing[2]),durationMs:Number(timing[3])});
     }
     else if(line===`ENDED:${this.generation}`){const ended=this.generation;this.enqueue(async()=>{if(ended===this.generation){this.key='';await this.ptt.release();this.onFinished?.();}}).catch(error=>this.onError?.(error));}
     else if(line.startsWith('ERROR:')){const match=/^ERROR:(\d+):(.*)$/.exec(line);if(match && Number(match[1])===this.generation){const failed=this.generation;this.enqueue(async()=>{if(failed===this.generation){this.key='';await this.ptt.release();this.onError?.(new Error(match[2]));}}).catch(error=>this.onError?.(error));}}
    }
   });
   child.stderr.on('data',chunk=>errors=(errors+chunk).slice(-1000));
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',()=>{
    clearTimeout(timer);if(this.child===child)this.child=undefined;
    this.key='';this.ptt.release().catch(()=>{});
    if(!ready)reject(new Error(errors || 'Audio host exited before startup.'));else this.onError?.(new Error(errors || 'Audio host exited.'));
    if(this.server===server){this.server=undefined;server.closeAllConnections();server.close();this.routes.clear();}
   });
  });}catch(error){server.closeAllConnections();server.close();this.server=undefined;throw error;}
 }
 send(command){this.child.stdin.write(JSON.stringify(command)+'\n');}
 async play(settings,file,volume=100,output='auto',holdKey='') {
  const id=++this.generation;
  await this.prepare();
  return this.enqueue(async()=>{
  if(id!==this.generation)throw cancelled();
  if(holdKey!==this.key){
   if(this.key){await this.ptt.release();this.key='';}
   if(id!==this.generation)throw cancelled();
   if(holdKey)await this.ptt.hold(holdKey);
   this.key=holdKey;
  }
  if(id!==this.generation)throw cancelled();
  const upstream=normalizeUrl(settings.url)+'/api/streamdeck/account/audio?'+new URLSearchParams({file});
  let route=[...this.routes].find(([,r])=>r.url===upstream && r.token===settings.token)?.[0];
  if(!route){
   route='/'+randomBytes(24).toString('hex');
   this.routes.set(route,{url:upstream,token:settings.token});
   while(this.routes.size>32)this.routes.delete(this.routes.keys().next().value);
  }
  this.send({op:'play',id,url:'http://127.0.0.1:'+this.server.address().port+route,volume:Math.max(0,Math.min(100,Number(volume)))/100,output});
  });
 }
 async dispose(){
  await this.stop();
  const child=this.child;this.child=undefined;child?.kill();
  const server=this.server;this.server=undefined;
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
 async stop(){
  const id=++this.generation;
  return this.enqueue(async()=>{
   if(this.child)this.send({op:'stop',id});
   this.key='';await this.ptt.release();
   this.routes.clear();
  });
 }
}
