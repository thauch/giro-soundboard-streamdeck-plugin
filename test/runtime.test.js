import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {once} from 'node:events';

test('built SDK plugin registers, auto-fills keys, pages, uses account favorites and records native playback',async()=>{
 const commands=[], messages=[];let favoriteCount=31;
 const loginRequest='a'.repeat(64),loginSecret='b'.repeat(64);
 const api=createServer(async(req,res)=>{
   let body='';for await(const chunk of req)body+=chunk;
   if(req.url.endsWith('/login/start')){
     res.setHeader('Content-Type','application/json');
     res.end(JSON.stringify({request:loginRequest,secret:loginSecret,expiresIn:600,verificationPath:'/auth/discord?returnTo=%2Fstreamdeck-login&request='+loginRequest}));
     return;
   }
   if(req.url.endsWith('/login/poll')){
     assert.deepEqual(JSON.parse(body),{request:loginRequest,secret:loginSecret});
     res.setHeader('Content-Type','application/json');res.end('{"token":"test-token"}');return;
   }
   assert.equal(req.headers['x-streamdeck-account'],'test-token');
   res.setHeader('Content-Type','application/json');
   if(req.url.endsWith('/status'))res.end(JSON.stringify({name:'Test computer',destination:'local',
     sounds:Array.from({length:favoriteCount},(_,i)=>({filename:'sound-'+i+'.mp3',displayname:'Sound '+i}))}));
   else {commands.push(JSON.parse(body));res.end('{"ok":true}');}
 });
 api.listen(0,'127.0.0.1');await once(api,'listening');
 const wss=new WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 const info={application:{version:'7.1.0',platform:'windows',language:'en',platformVersion:'10'},
   plugin:{uuid:'com.giro.soundboard',version:'0.6.4.0'},
   devices:[{id:'deck',name:'XL',type:2,size:{columns:8,rows:4}}],
   devicePixelRatio:1,colors:{highlightColor:'#69e2c2'}};
 const child=spawn(process.execPath,['bin/plugin.js','-port',String(wss.address().port),
   '-pluginUUID','test-plugin','-registerEvent','registerPlugin','-info',JSON.stringify(info)],
   {cwd:new URL('../com.giro.soundboard.sdPlugin',import.meta.url),stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const until=async(predicate)=>{
   const start=Date.now();
   while(!predicate()){
     if(child.exitCode!==null)throw new Error('Plugin exited: '+stderr);
     if(Date.now()-start>7000)throw new Error('Timed out waiting for SDK event: '+stderr);
     await new Promise(r=>setTimeout(r,20));
   }
 };
 let socket;
 wss.on('connection',ws=>{
   socket=ws;ws.on('message',raw=>{
     const event=JSON.parse(raw);messages.push(event);
     if(event.event==='getGlobalSettings')ws.send(JSON.stringify({event:'didReceiveGlobalSettings',
       payload:{settings:{url:'http://127.0.0.1:'+api.address().port,token:'test-token',mode:'account'}}}));
   });
 });
 const hasLabel=(context,label)=>messages.some(e=>e.event==='setImage' && e.context===context &&
   Buffer.from(String(e.payload.image).split(',')[1] || '', 'base64').toString().includes('>'+label+'</text>'));
 const emit=(event,kind,id,slot)=>socket.send(JSON.stringify({event,action:'com.giro.soundboard.'+kind,
   context:id,device:'deck',payload:{controller:'Keypad',coordinates:{column:slot%8,row:Math.floor(slot/8)},settings:kind==='favorite'?{slot}:{} }}));
 try{
   await until(()=>messages.some(e=>e.event==='getGlobalSettings'));
   assert(messages.some(e=>e.event==='registerPlugin'));
   for(let i=0;i<29;i++)emit('willAppear','favorite','favorite-'+i,i);
   emit('willAppear','next','next',30);
   emit('willAppear','stop','stop',31);
   await until(()=>hasLabel('favorite-0','Sound 0'));
   emit('keyDown','favorite','favorite-0',0);
   await until(()=>commands.length===1);
   assert.deepEqual(commands[0],{file:'sound-0.mp3'});
   emit('keyDown','next','next',30);
   await until(()=>hasLabel('favorite-0','Sound 29'));
   emit('keyDown','favorite','favorite-0',0);
   await until(()=>commands.length===2);
   assert.equal(commands[1].file,'sound-29.mp3');
   emit('keyDown','stop','stop',31);
   await until(()=>messages.some(e=>e.event==='showOk' && e.context==='stop'));
   assert.equal(commands.length,2);
   const marker=messages.length;favoriteCount=10;
   socket.send(JSON.stringify({event:'propertyInspectorDidAppear',action:'com.giro.soundboard.favorite',context:'favorite-0',device:'deck'}));
   socket.send(JSON.stringify({event:'sendToPlugin',action:'com.giro.soundboard.favorite',context:'favorite-0',
     payload:{op:'login',url:'http://127.0.0.1:'+api.address().port}}));
   await until(()=>messages.slice(marker).some(e=>e.event==='openUrl'));
   const browser=messages.slice(marker).find(e=>e.event==='openUrl');
   assert.equal(browser.payload.url,'http://127.0.0.1:'+api.address().port+'/auth/discord?returnTo=%2Fstreamdeck-login&request='+loginRequest);
   assert(!browser.payload.url.includes(loginSecret));
   await until(()=>messages.slice(marker).some(e=>e.event==='setGlobalSettings' && e.payload?.token==='test-token'));
   await until(()=>hasLabel('favorite-0','Sound 0'));
   emit('willAppear','favorite','added-key',3);
   await until(()=>messages.some(e=>e.event==='setTitle' && e.context==='added-key'));
   assert.equal(messages.filter(e=>e.event==='switchToProfile').length,0);
   socket.send(JSON.stringify({event:'sendToPlugin',action:'com.giro.soundboard.favorite',context:'favorite-0',
     payload:{op:'keySettings',settings:{favorite:'sound-5.mp3',customText:'Mine',fontSize:22,output:'virtual-device'}}}));
   await until(()=>messages.some(e=>e.event==='setSettings' && e.context==='favorite-0' && e.payload.favorite==='sound-5.mp3'));
   await until(()=>hasLabel('favorite-0','Mine'));
   emit('keyDown','favorite','favorite-0',0);
   await until(()=>commands.length===3);
   assert.equal(commands[2].file,'sound-5.mp3');
   const saved=messages.find(e=>e.event==='setSettings' && e.context==='favorite-0' && e.payload.favorite==='sound-5.mp3');
   assert.equal(saved.payload.output,'virtual-device');assert.equal(saved.payload.fontSize,22);
   await until(()=>messages.some(e=>e.event==='setImage' && e.context==='next' && e.payload.image==='imgs/next-muted.svg'));
   const marker2=commands.length;
   for(let i=0;i<5;i++)emit('keyDown','favorite','favorite-0',0);
   await until(()=>commands.length===marker2+5);
   assert(commands.slice(marker2).every(command=>command.file==='sound-5.mp3'));



 }finally{
   const exited=once(child,'exit');child.kill();await exited;
   for(const ws of wss.clients)ws.terminate();
   await new Promise(r=>wss.close(r));api.closeAllConnections();await new Promise(r=>api.close(r));
 }
});
