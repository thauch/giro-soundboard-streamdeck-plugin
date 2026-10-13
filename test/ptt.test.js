import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {pttSettings,holdKeyFor,normalizeKey,virtualKey,WindowsPttBridge} from '../src/ptt.js';
test('Local/K and Squad/J defaults, custom keys, Off, and helper-compatible validation',()=>{
 assert.deepEqual(pttSettings(),{pttMode:'local',localKey:'K',squadKey:'J'});
 assert.equal(holdKeyFor(),'K');assert.equal(holdKeyFor({pttMode:'squad'}),'J');
 assert.equal(holdKeyFor({pttMode:'off'}),'');
 assert.equal(holdKeyFor({pttMode:'squad',squadKey:'f12'}),'F12');
 assert.equal(normalizeKey(' Control '),'CTRL');assert.equal(virtualKey('K'),75);
 assert.equal(virtualKey('F24'),0x87);
 for(const key of ['Ctrl+J','F25','bad key',''])assert.throws(()=>normalizeKey(key));
});
test('independent key guardian serializes key-down/release and receives the plugin parent PID',async()=>{
 const commands=[],calls=[];let child;
 const spawn=(exe,args,options)=>{
   calls.push({exe,args,options});child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.stdin=new PassThrough();child.stdin.on('data',data=>{
     const command=data.toString().trim();commands.push(command);
     setImmediate(()=>child.stdout.write(command==='UP'?'KEY_UP\n':'KEY_DOWN\n'));
   });
   setImmediate(()=>child.stdout.write('PTT_READY\n'));return child;
 };
 const bridge=new WindowsPttBridge({spawn,scriptDirectory:'/plugin/bin'});
 await bridge.prepare();
 const down=bridge.hold('K'),up=bridge.release();await Promise.all([down,up]);
 assert.deepEqual(commands,['DOWN:75','UP']);
 assert.equal(calls[0].options.env.GIRO_PARENT_PID,String(process.pid));
 assert(calls[0].args.includes('/plugin/bin/ptt.ps1'));
});
