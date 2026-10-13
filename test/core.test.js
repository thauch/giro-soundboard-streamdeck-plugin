import test from 'node:test';
import assert from 'node:assert/strict';
import {favoriteFor,clampPage,normalizeUrl,SoundboardClient,titleLines} from '../src/core.js';
test('XL paging maps 29 favorite slots without overlap and clamps after removal',()=>{
 const sounds=Array.from({length:65},(_,i)=>({filename:String(i)}));
 assert.equal(favoriteFor(sounds,0,28).filename,'28');
 assert.equal(favoriteFor(sounds,1,0).filename,'29');
 assert.equal(favoriteFor(sounds,2,6).filename,'64');
 assert.equal(favoriteFor(sounds,2,7),undefined);
 assert.equal(clampPage(2,28),0);assert.equal(clampPage(1,30),1);
});
test('connection addresses reject unsafe schemes, credentials, and insecure remote hosts',()=>{
 assert.equal(normalizeUrl('https://example.com/'),'https://example.com');
 assert.equal(normalizeUrl('http://localhost:3000'),'http://localhost:3000');
 for(const url of ['file:///tmp/x','https://user:pass@example.com','http://example.com','https://example.com?token=secret'])
   assert.throws(()=>normalizeUrl(url));
});
test('native requests use scoped tokens and never forward across redirects',async()=>{
 const calls=[];
 const client=new SoundboardClient(async(url,options)=>{
   calls.push({url,options});return {ok:true,json:async()=>({ok:true})};
 });
 await client.recordPlay({url:'https://example.com',token:'deck-token'},'a.mp3');
 assert.equal(calls[0].options.headers['X-StreamDeck-Account'],'deck-token');
 assert.equal(calls[0].options.redirect,'error');
 assert.deepEqual(JSON.parse(calls[0].options.body),{file:'a.mp3'});
 const failing=new SoundboardClient(async()=>({ok:false,status:401,json:async()=>({error:'Pair again'})}));
 await assert.rejects(failing.status({url:'https://example.com',token:'bad'}),/Pair again/);
});
test('favorite titles fit keys and flatten embedded newlines',()=>{
 const title=titleLines('A very long favorite sound name for the key');
 assert(title.split('\n').length<=3);assert(title.split('\n').every(line=>line.length<=15));
 assert.equal(titleLines('One\nTwo'),'One Two');
});
