import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn as nodeSpawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {WindowsPttBridge,normalizeKey} from './ptt.js';
import {normalizeUrl} from './core.js';
import {WindowsStreamPlayer} from './windows-player.js';
const cancelled=()=>Object.assign(new Error('Playback cancelled.'),{name:'AbortError'});

// An in-memory loopback proxy attaches the scoped token to streamed audio.
// Native players get only a per-play loopback URL; no sound is written to disk.
export class NativeAudioPlayer {
  constructor({platform=process.platform,spawn=nodeSpawn,fetcher=fetch,scriptDirectory=path.dirname(process.argv[1]),ptt,persistent=true}={}) {
    this.platform=platform;this.spawn=spawn;this.fetcher=fetcher;this.scriptDirectory=scriptDirectory;this.generation=0;this.ptt=ptt || (platform==='win32'?new WindowsPttBridge({spawn,scriptDirectory}):null);
    if(platform==='win32' && persistent){this.warm=new WindowsStreamPlayer({spawn,fetcher,scriptDirectory,ptt:this.ptt});this.warm.onError=error=>this.onError?.(error);}
  }
  async listOutputs() {
    if(this.platform!=='win32')return [];
    return new Promise((resolve,reject)=>{
      const child=this.spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass',
        '-File',path.join(this.scriptDirectory,'devices.ps1'),'-Mode','list'],
        {windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='',errors='';
      const timer=setTimeout(()=>{child.kill();reject(new Error('Audio output discovery timed out.'));},16000);
      child.stdout.on('data',data=>{output+=data;if(output.length>524288){child.kill();clearTimeout(timer);reject(new Error('Audio device response was too large.'));}});
      child.stderr.on('data',data=>{errors=(errors+data).slice(-1000);});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{
        clearTimeout(timer);
        if(code!==0){reject(new Error(errors.trim() || 'Could not load audio outputs.'));return;}
        try {
          const data=JSON.parse(output.replace(/^\uFEFF/,'').trim() || '[]');
          resolve((Array.isArray(data)?data:[data]).filter(device=>typeof device.id==='string' && typeof device.name==='string'));
        }catch{reject(new Error('Windows returned an invalid audio-device list.'));}
      });
    });
  }
  async cleanup() {
    const child=this.child,server=this.server;
    this.child=undefined;this.server=undefined;
    if(child && child.exitCode===null)child.kill();
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    if(this.ptt)await this.ptt.release();
  }
  async stop(){if(this.warm)return this.warm.stop();++this.generation;await this.cleanup();}
  async play(settings,file,volume=100,output='auto',holdKey='') {
    if(this.warm)return this.warm.play(settings,file,volume,output,holdKey);
    const generation=++this.generation;
    await this.cleanup();
    if(generation!==this.generation)throw cancelled();
    if(this.platform!=='win32' && output && output!=='auto')throw new Error('Named audio outputs are supported on Windows; choose System default on macOS.');
    if(!['win32','darwin'].includes(this.platform))throw new Error('Local audio playback requires Windows or macOS.');
    if(this.platform==='win32' && holdKey){
      holdKey=normalizeKey(holdKey);await this.ptt.prepare();
      if(generation!==this.generation)throw cancelled();
    }
    const capability='/'+randomBytes(24).toString('hex');
    const audioUrl=normalizeUrl(settings.url)+'/api/streamdeck/account/audio?'+new URLSearchParams({file});
    const server=createServer(async(req,res)=>{
      if(!['GET','HEAD'].includes(req.method) || req.url!==capability){res.writeHead(404);res.end();return;}
      const abort=new AbortController();
      res.on('close',()=>abort.abort());
      try {
        const response=await this.fetcher(audioUrl,{
          method:req.method,headers:{'X-StreamDeck-Account':settings.token,'Accept-Encoding':'identity',
            ...(req.headers.range?{Range:req.headers.range}:{})},redirect:'error',signal:abort.signal});
        const headers={};
        for(const name of ['content-type','content-length','content-range','accept-ranges'])
          if(response.headers.has(name))headers[name]=response.headers.get(name);
        res.writeHead(response.status,{...headers,'Cache-Control':'no-store'});
        if(req.method==='HEAD' || !response.body)res.end();
        else await pipeline(Readable.fromWeb(response.body),res);
      }catch(error){if(!res.headersSent){res.writeHead(502);res.end('Audio stream unavailable.');}else res.destroy();}
    });
    this.server=server;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    if(generation!==this.generation){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));throw cancelled();}
    const url='http://127.0.0.1:'+server.address().port+capability;
    const level=Math.max(0,Math.min(100,Number(volume)))/100;
    const executable=this.platform==='win32'?'powershell.exe':'/usr/bin/osascript';
    const args=this.platform==='win32'
      ?['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(this.scriptDirectory,'player.ps1')]
      :['-l','JavaScript',path.join(this.scriptDirectory,'player.jxa'),url,String(level)];
    const child=this.spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],
      env:{...process.env,GIRO_AUDIO_URL:url,GIRO_AUDIO_VOLUME:String(level),GIRO_AUDIO_DEVICE:output || 'auto'}});
    this.child=child;
    await new Promise((resolve,reject)=>{
      let started=false,prepared=false,output='',errorOutput='';
      const timeout=setTimeout(()=>{if(!started){child.kill();reject(new Error('Local audio could not start. Check your audio output and file format.'));}},40000);
      const clear=()=>clearTimeout(timeout);
      child.stdout.on('data',data=>{
        output+=data;
        if(output.includes('PREPARED') && !prepared){
          prepared=true;
          (async()=>{
            if(generation!==this.generation)return;
            if(this.platform==='win32' && holdKey)await this.ptt.hold(holdKey);
            if(generation!==this.generation)return;
            child.stdin.write('GO\n');
          })().catch(error=>{clear();child.kill();reject(error);});
        }
        if(output.includes('READY') && !started){started=true;clear();resolve();}
      });
      child.stderr.on('data',data=>{errorOutput=(errorOutput+data).slice(-1000);});
      child.once('error',error=>{clear();reject(new Error('Could not start the local audio player: '+error.message));});
      child.once('exit',code=>{
        clear();
        if(!started)reject(generation!==this.generation?cancelled():
          new Error('Audio playback failed. '+errorOutput.trim()));
        if(generation===this.generation){
          if(code && started)this.onError?.(new Error('Local audio playback failed. Check the sound format and output device.'));
          this.cleanup().catch(error=>this.onError?.(error)).finally(()=>this.onFinished?.());
        }
      });
    }).catch(async error=>{if(generation===this.generation)await this.cleanup();throw error;});
  }
}
