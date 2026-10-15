import test from 'node:test';
import assert from 'node:assert/strict';
import {fitLabel,keyImage,resolveFavorite} from '../src/labels.js';
test('Auto follows its slot and pinned favorites survive page/order changes',()=>{
 const sounds=[{filename:'a.mp3'},{filename:'b.mp3'},{filename:'c.mp3'}];
 assert.equal(resolveFavorite(sounds,{},0,1,2).filename,'b.mp3');
 assert.equal(resolveFavorite(sounds,{favorite:'a.mp3'},1,1,2).filename,'a.mp3');
 assert.equal(resolveFavorite([...sounds].reverse(),{favorite:'a.mp3'},0,0,2).filename,'a.mp3');
 assert.equal(resolveFavorite(sounds,{favorite:'deleted.mp3'},0,0,2),undefined);
});
test('long names wrap and auto-fit without cutting characters or adding ellipses',()=>{
 const text='A very long sound name that should wrap completely onto this button without cutting off the ending';
 const fitted=fitLabel(text,28);
 assert.equal(fitted.lines.join(' ').replace(/\s/g,''),text.replace(/\s/g,''));
 assert(fitted.lines.length*fitted.lineHeight<=112);
 assert(fitted.fontSize<=28);assert(!fitted.lines.join('').includes('…'));
 const long='Supercalifragilisticexpialidocious'.repeat(3),wrapped=fitLabel(long,24);
 assert.equal(wrapped.lines.join(''),long);assert(wrapped.lines.length>1);
 assert.deepEqual(fitLabel('First\nSecond',20).lines,['First','Second']);
});
test('custom labels render as safe SVG text instead of native cut-off titles',()=>{
 const svg=Buffer.from(keyImage('a.mp3','Hello <script> & "World"',20).split(',')[1],'base64').toString();
 assert(!svg.includes('<script>'));assert(svg.includes('&lt;script&gt;'));assert(svg.includes('&amp;'));
 assert(svg.includes('font-size="'));assert(svg.includes('text-anchor="middle"'));
});

test('playing keys show a clamped bottom progress bar without changing their label',()=>{
 const svg=value=>Buffer.from(value.split(',')[1],'base64').toString();
 assert(!svg(keyImage('a.mp3','My label')).includes('y="128"'));
 const half=svg(keyImage('a.mp3','My label',20,.5));
 assert(half.includes('My label'));assert(half.includes('width="62.00" height="6"'));
 assert(svg(keyImage('a.mp3','My label',20,2)).includes('width="124.00" height="6"'));
 assert(svg(keyImage('a.mp3','My label',20,-1)).includes('width="0.00" height="6"'));
});
