import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {EventEmitter,once} from 'node:events';
import {PassThrough} from 'node:stream';
import {NativeAudioPlayer} from '../src/player.js';

test('native player streams authenticated audio ranges in memory and Stop closes playback',async()=>{
 const upstreamRequests=[],spawnCalls=[];
 const api=createServer((req,res)=>{
   upstreamRequests.push(req);
   assert.equal(req.headers['x-streamdeck-account'],'private-token');
   assert.equal(req.url,'/api/streamdeck/account/audio?file=some+sound.mp3');
   res.writeHead(206,{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-3/8','Accept-Ranges':'bytes','Content-Length':'4'});
   res.end('abcd');
 });
 api.listen(0,'127.0.0.1');await once(api,'listening');
 let child,proxyUrl,streamError;
 const spawn=(executable,args,options)=>{
   spawnCalls.push({executable,args,options});
   child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   proxyUrl=options.env.GIRO_AUDIO_URL;
   setImmediate(async()=>{
     try{
       const response=await fetch(proxyUrl,{headers:{Range:'bytes=0-3'}});
       assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-3/8');
       assert.equal(await response.text(),'abcd');
       child.stdout.write('READY\n');
     }catch(error){streamError=error;child.stderr.write(error.message);child.kill();}
   });
   return child;
 };
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,spawn,scriptDirectory:'/trusted/plugin/bin'});
 try{
   await player.play({url:'http://127.0.0.1:'+api.address().port,token:'private-token'},'some sound.mp3',75,'selected-device-id');
   if(streamError)throw streamError;
   assert.equal(spawnCalls[0].executable,'powershell.exe');
   assert.equal(spawnCalls[0].options.env.GIRO_AUDIO_VOLUME,'0.75');
   assert.equal(spawnCalls[0].options.env.GIRO_AUDIO_DEVICE,'selected-device-id');
   assert(!JSON.stringify(spawnCalls[0].args).includes('private-token'));
   assert(!proxyUrl.includes('private-token'));
   assert.equal(upstreamRequests[0].headers.range,'bytes=0-3');
   const denied=await fetch(new URL('/wrong-path',proxyUrl));assert.equal(denied.status,404);
   await player.stop();assert.equal(child.exitCode,0);
   await assert.rejects(fetch(proxyUrl));
 }finally{await player.stop();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
});

test('Stop during native startup cancels playback and never keeps the stream running',async()=>{
 let child,started;
 const spawned=new Promise(resolve=>started=resolve);
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,spawn:()=>{
   child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   started();return child;
 }});
 const playing=player.play({url:'https://example.com',token:'secret'},'a.mp3');
 const rejected=assert.rejects(playing,error=>error.name==='AbortError');
 await spawned;await player.stop();await rejected;
 assert.equal(player.server,undefined);
});

test('Windows output enumeration handles single-device JSON and BOM without swallowing errors',async()=>{
 const calls=[];
 const spawn=(exe,args)=>{
   calls.push({exe,args});
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
   setImmediate(()=>{child.stdout.write('\uFEFF{"id":"endpoint","name":"Virtual output"}');child.emit('exit',0);});
   return child;
 };
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,spawn,scriptDirectory:'/plugin/bin'});
 assert.deepEqual(await player.listOutputs(),[{id:'endpoint',name:'Virtual output'}]);
 assert.equal(calls[0].exe,'powershell.exe');assert(calls[0].args.includes('/plugin/bin/devices.ps1'));
 const failing=new NativeAudioPlayer({platform:'win32',persistent:false,spawn:()=>{
   const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
   setImmediate(()=>{child.stderr.write('Device bridge failed');child.emit('exit',1);});return child;
 }});
 await assert.rejects(failing.listOutputs(),/Device bridge failed/);
});

test('PTT goes down before audio starts and releases after Stop even when audio is killed',async()=>{
 const events=[];
 const ptt={prepare:async()=>events.push('prepare'),hold:async key=>events.push('down:'+key),release:async()=>events.push('up')};
 let child;
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,ptt,spawn:()=>{
   child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.stdin.on('data',data=>{assert.equal(data.toString(),'GO\n');events.push('play');child.stdout.write('READY\n');});
   child.kill=()=>{events.push('audio-killed');child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   setImmediate(()=>child.stdout.write('PREPARED\n'));return child;
 }});
 try{
   await player.play({url:'https://example.com',token:'secret'},'a.mp3',100,'auto','J');
   assert(events.indexOf('down:J')<events.indexOf('play'));
   events.length=0;await player.stop();
   assert.deepEqual(events,['audio-killed','up']);
 }finally{await player.stop();}
});

test('PTT releases at normal audio completion and Off never presses a key',async()=>{
 const events=[];
 const ptt={prepare:async()=>events.push('prepare'),hold:async key=>events.push('down:'+key),release:async()=>events.push('up')};
 let child;
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,ptt,spawn:()=>{
   child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.stdin.on('data',()=>{events.push('play');child.stdout.write('READY\n');});
   child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   setImmediate(()=>child.stdout.write('PREPARED\n'));return child;
 }});
 try{
   await player.play({url:'https://example.com',token:'secret'},'a.mp3',100,'auto','K');
   events.length=0;child.exitCode=0;child.emit('exit',0);
   for(let i=0;i<50 && !events.includes('up');i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert(events.includes('up'));
   events.length=0;
   await player.play({url:'https://example.com',token:'secret'},'a.mp3',100,'auto','');
   assert(events.includes('play'));assert(!events.includes('prepare'));assert(!events.some(event=>event.startsWith('down:')));
 }finally{await player.stop();}
});

test('pressing the sound again stops the existing audio before starting its replacement',async()=>{
 const children=[],events=[];
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,spawn:()=>{
   const index=children.length;
   const child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.kill=()=>{events.push('stop:'+index);child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   children.push(child);events.push('spawn:'+index);
   setImmediate(()=>child.stdout.write('READY\n'));return child;
 }});
 try{
   await player.play({url:'https://example.com',token:'secret'},'a.mp3');
   await player.play({url:'https://example.com',token:'secret'},'a.mp3');
   assert.equal(children.length,2);assert.equal(children[0].exitCode,0);assert.equal(children[1].exitCode,null);
   assert(events.indexOf('stop:0')<events.indexOf('spawn:1'));
 }finally{await player.stop();}
});

test('rapid presses cancel older pending starts so the newest sound is the only one started',async()=>{
 let releasePreparation;
 const pending=new Promise(resolve=>releasePreparation=resolve);
 const ptt={prepare:()=>pending,release:async()=>{},hold:async()=>{}};
 const children=[];
 const player=new NativeAudioPlayer({platform:'win32',persistent:false,ptt,spawn:()=>{
   const child=new EventEmitter();child.exitCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
   child.stdin.on('data',()=>child.stdout.write('READY\n'));
   child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
   children.push(child);setImmediate(()=>child.stdout.write('PREPARED\n'));return child;
 }});
 try{
   const first=player.play({url:'https://example.com',token:'secret'},'old.mp3',100,'auto','K');
   const aborted=assert.rejects(first,error=>error.name==='AbortError');
   await new Promise(resolve=>setImmediate(resolve));
   const last=player.play({url:'https://example.com',token:'secret'},'new.mp3',100,'auto','K');
   releasePreparation();await Promise.all([aborted,last]);
   assert.equal(children.length,1);
 }finally{await player.stop();}
});
