import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
process.chdir(import.meta.dirname);
const root='com.giro.soundboard.sdPlugin';
mkdirSync(root+'/bin',{recursive:true});rmSync(root+'/profiles',{recursive:true,force:true});mkdirSync('dist',{recursive:true});
await build({absWorkingDir:import.meta.dirname,entryPoints:['src/plugin.js'],outfile:root+'/bin/plugin.js',bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"},legalComments:'eof'});
for(const script of ['player.ps1','player-host.ps1','player.jxa','devices.ps1','ptt.ps1'])writeFileSync(root+'/bin/'+script,readFileSync('src/'+script));
writeFileSync(root+'/package.json','{"type":"module"}\n');
const symbols={plugin:'★',favorite:'▶',previous:'←',next:'→',stop:'■'};
for(const [name,symbol] of Object.entries(symbols)){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="14" fill="#141c27"/><rect x="5" y="5" width="134" height="134" rx="12" fill="none" stroke="#69e2c2" stroke-width="3"/><text x="72" y="76" dominant-baseline="middle" text-anchor="middle" fill="#69e2c2" font-size="64" font-family="Arial">'+symbol+'</text></svg>';
  writeFileSync(root+'/imgs/'+name+'.svg',svg);
  if(name==='previous' || name==='next')writeFileSync(root+'/imgs/'+name+'-muted.svg',svg.replaceAll('#69e2c2','#657182'));
}
execFileSync('python3',['generate-profile.py'],{stdio:'inherit'});
writeFileSync(root+'/THIRD-PARTY-LICENSES.txt',[
  'Official Stream Deck SDK v2.1.2 and bundled dependencies.\n',
  ...['@elgato/streamdeck','@elgato/utils','ws'].map(name=>{
    try{return name+'\n'+readFileSync('node_modules/'+name+'/LICENSE','utf8');}
    catch{return name+' — MIT license; see package repository.';}
  })
].join('\n\n'));
console.log('Built SDK v2 plugin and XL favorite profile.');
