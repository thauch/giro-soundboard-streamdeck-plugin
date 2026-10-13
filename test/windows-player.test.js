import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {WindowsStreamPlayer} from '../src/windows-player.js';
function fixture({delayReady=false}={}) {
 const children=[],commands=[],keys=[];
 const ptt={hold:async key=>keys.push('down:'+key),release:async()=>keys.push('up')};
 const player=new WindowsStreamPlayer({scriptDirectory:'/plugin/bin',ptt,fetcher:async(url,options)=>{
  assert.equal(options.headers['X-StreamDeck-Account'],'secret');
  assert.equal(options.headers.Range,'bytes=0-3');
  return new Response('abcd',{status:206,headers:{'content-type':'audio/mpeg','content-range':'bytes 0-3/8'}});
 },spawn:(exe,args)=>{
  assert(args.includes('/plugin/bin/player-host.ps1'));
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.exitCode=null;
  child.stdin.on('data',raw=>commands.push(JSON.parse(raw.toString())));
  child.kill=()=>{child.exitCode=0;queueMicrotask(()=>child.emit('exit',0));};
  children.push(child);if(!delayReady)setImmediate(()=>child.stdout.write('HOST_READY\n'));return child;
 }});
 return {player,children,commands,keys};
}
const connection={url:'https://example.com',token:'secret'};
test('50 rapid restarts reuse the host and stream URL without releasing PTT',async()=>{
 const {player,children,commands,keys}=fixture();
 try {
  await player.play(connection,'a.mp3',80,'device','K');
  for(let i=0;i<50;i++)await player.play(connection,'a.mp3',80,'device','K');
  assert.equal(children.length,1);assert.equal(commands.length,51);
  assert(commands.every(command=>command.url===commands[0].url));
  assert(commands.every(command=>command.output==='device' && command.volume===0.8));
  assert.deepEqual(keys,['down:K']);
  const response=await fetch(commands[0].url,{headers:{Range:'bytes=0-3'}});
  assert.equal(response.status,206);assert.equal(await response.text(),'abcd');
  assert.equal((await fetch(new URL('/wrong',commands[0].url))).status,404);
  await player.stop();assert.equal(commands.at(-1).op,'stop');assert.deepEqual(keys,['down:K','up']);
  assert.equal((await fetch(commands[0].url)).status,404);
 }finally{await player.dispose();}
});
test('a newer cold press wins, switching sounds changes source without creating another process',async()=>{
 const {player,children,commands,keys}=fixture({delayReady:true});
 try {
  const old=player.play(connection,'old.mp3',100,'auto','K');
  const aborted=assert.rejects(old,error=>error.name==='AbortError');
  const last=player.play(connection,'new.mp3',100,'auto','K');
  while(!children.length)await new Promise(resolve=>setImmediate(resolve));
  children[0].stdout.write('HOST_READY\n');await Promise.all([aborted,last]);
  assert.equal(commands.length,1);assert.deepEqual(keys,['down:K']);
  await player.play(connection,'different.mp3',100,'auto','J');
  assert.equal(children.length,1);assert.notEqual(commands[0].url,commands[1].url);
  assert.deepEqual(keys,['down:K','up','down:J']);
  children[0].stdout.write('ENDED:'+commands[0].id+'\n');
  assert.deepEqual(keys,['down:K','up','down:J']);
  children[0].stdout.write('ENDED:'+commands[1].id+'\n');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(keys.at(-1),'up');
 }finally{await player.dispose();}
});
test('Stop cancels a pending host startup; Off does not hold a key',async()=>{
 const {player,children,commands,keys}=fixture({delayReady:true});
 try {
  const play=player.play(connection,'a.mp3',100,'auto','K');
  const aborted=assert.rejects(play,error=>error.name==='AbortError');
  await player.stop();
  while(!children.length)await new Promise(resolve=>setImmediate(resolve));
  children[0].stdout.write('HOST_READY\n');await aborted;
  assert(!commands.some(command=>command.op==='play'));
  await player.play(connection,'a.mp3',100,'auto','');
  assert(!keys.some(key=>key.startsWith('down:')));
 }finally{await player.dispose();}
});
test('a stale output/key transition cannot release the newest sound key',async()=>{
 const {player,commands,keys}=fixture();
 try {
  await player.play(connection,'a.mp3',100,'auto','K');
  let resume;
  player.ptt.release=()=>new Promise(resolve=>{keys.push('up');resume=resolve;});
  const old=player.play(connection,'b.mp3',100,'auto','J');
  const aborted=assert.rejects(old,error=>error.name==='AbortError');
  while(!resume)await new Promise(resolve=>setImmediate(resolve));
  const newest=player.play(connection,'a.mp3',100,'auto','K');
  resume();await Promise.all([aborted,newest]);
  assert.equal(player.key,'K');assert.equal(keys.at(-1),'down:K');
  assert.equal(commands.length,2);
 }finally{player.ptt.release=async()=>{};await player.dispose();}
});
