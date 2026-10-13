import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {favoriteLayout} from '../src/core.js';
test('ten favorites choose a real ten-key layout, with Stop and empty remaining keys',()=>{
 assert.equal(favoriteLayout(10),'profiles/Giro Favorites XL - 10');
 const readProfile=count=>JSON.parse(execFileSync('python3',['-c',
   'import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.read(z.namelist()[0]).decode())',
   fileURLToPath(new URL('../dist/profiles/Giro Favorites XL - '+count+'.streamDeckProfile',import.meta.url))],{encoding:'utf8'}));
 const profile=readProfile(10),actions=Object.values(profile.Actions);
 assert.equal(actions.filter(action=>action.UUID.endsWith('.favorite')).length,10);
 assert.equal(actions.filter(action=>action.UUID.endsWith('.stop')).length,1);
 assert.equal(actions.length,11);assert.equal(profile.Actions['2,1'],undefined);
 for(const count of [1,29]){
   assert.equal(Object.values(readProfile(count).Actions).filter(action=>action.UUID.endsWith('.favorite')).length,count);
 }
 assert.equal(favoriteLayout(30),'profiles/Giro Soundboard XL');
 assert.equal(favoriteLayout(150),'profiles/Giro Soundboard XL');
});
