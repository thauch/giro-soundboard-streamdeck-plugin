import test from 'node:test';
import assert from 'node:assert/strict';
import {SoundMixer} from '../src/mixer.js';
import {PttLeases} from '../src/ptt.js';
import {navigationFor} from '../src/core.js';

test('rapid presses reuse one restarting player instead of creating overlapping voices',async()=>{
 const voices=[];
 const mixer=new SoundMixer({platform:'linux',createVoice:()=>{
   const voice={played:[],stops:0,play:async(...args)=>voice.played.push(args),stop:async()=>{voice.stops++;}};
   voices.push(voice);return voice;
 }});
 await Promise.all(Array.from({length:12},()=>mixer.play({url:'https://example.com'},'a.mp3',100,'auto','K')));
 assert.equal(voices.length,1);assert.equal(voices[0].played.length,12);
 await mixer.stop();assert.equal(voices[0].stops,1);
});
test('overlapping clips retain a shared PTT key until the last finishes and route Local/Squad independently',async()=>{
 const events=[],bridge={prepare:async()=>{},hold:async key=>events.push('down:'+key),releaseKey:async key=>events.push('up:'+key),release:async()=>events.push('all-up')};
 const leases=new PttLeases(bridge),first=leases.create(),second=leases.create(),squad=leases.create();
 await Promise.all([first.hold('K'),second.hold('K'),squad.hold('J')]);
 assert.deepEqual(events,['down:K','down:J']);
 await first.release();assert.deepEqual(events,['down:K','down:J']);
 await second.release();assert.equal(events.at(-1),'up:K');assert.equal(leases.counts.get('J'),1);
 await squad.release();assert.equal(events.at(-1),'up:J');assert.equal(leases.counts.size,0);
});
test('navigation placeholders stay visible on a single page and at paging boundaries',()=>{
 for(const kind of ['previous','next']){
   const nav=navigationFor(kind,0,10,29);assert.equal(nav.enabled,false);
   assert.equal(nav.image,'imgs/'+kind+'-muted.svg');assert(nav.title.includes('1 / 1'));
 }
 assert.equal(navigationFor('next',0,65,29).enabled,true);
 assert.equal(navigationFor('previous',0,65,29).enabled,false);
 assert.equal(navigationFor('next',2,65,29).enabled,false);
 assert.equal(navigationFor('previous',2,65,29).enabled,true);
});
