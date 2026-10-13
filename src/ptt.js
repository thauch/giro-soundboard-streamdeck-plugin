import path from 'node:path';
import {EventEmitter} from 'node:events';
const named={SPACE:0x20,ENTER:0x0D,TAB:0x09,SHIFT:0x10,CTRL:0x11,ALT:0x12,CAPSLOCK:0x14,
  BACKSPACE:0x08,ESC:0x1B,UP:0x26,DOWN:0x28,LEFT:0x25,RIGHT:0x27,HOME:0x24,END:0x23,
  INSERT:0x2D,DELETE:0x2E,PAGEUP:0x21,PAGEDOWN:0x22};
export function normalizeKey(value) {
  let key=String(value || '').trim().toUpperCase();
  key=({CONTROL:'CTRL',RETURN:'ENTER',ESCAPE:'ESC',PGUP:'PAGEUP',PGDN:'PAGEDOWN'}[key] || key);
  if(/^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || named[key])return key;
  throw new Error('Use a letter, digit, F1–F24, or a named key such as Space, Ctrl, or Shift.');
}
export function virtualKey(value) {
  const key=normalizeKey(value);
  return named[key] || (key.length===1?key.charCodeAt(0):0x6F+Number(key.slice(1)));
}
export function pttSettings(settings={}) {
  const mode=settings.pttMode ?? 'local';
  if(!['local','squad','off'].includes(mode))throw new Error('Choose Local, Squad, or Off.');
  return {pttMode:mode,localKey:normalizeKey(settings.localKey ?? 'K'),squadKey:normalizeKey(settings.squadKey ?? 'J')};
}
export function holdKeyFor(settings={}) {
  const options=pttSettings(settings);
  return options.pttMode==='off'?'':options.pttMode==='squad'?options.squadKey:options.localKey;
}
export class WindowsPttBridge {
  constructor({spawn,scriptDirectory}) {this.spawn=spawn;this.scriptDirectory=scriptDirectory;this.events=new EventEmitter();this.queue=Promise.resolve();}
  prepare() {
    if(this.starting)return this.starting;
    if(this.child)return Promise.resolve();
    this.starting=new Promise((resolve,reject)=>{
      const child=this.spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(this.scriptDirectory,'ptt.ps1')],
        {windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,GIRO_PARENT_PID:String(process.pid)}});
      this.child=child;let buffer='',ready=false,errors='';
      const timeout=setTimeout(()=>reject(new Error('Push-to-talk helper could not start.')),18000);
      child.stdout.on('data',chunk=>{
        buffer+=chunk;
        let end;
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
          if(line==='PTT_READY'){ready=true;clearTimeout(timeout);resolve();}
          if(line.startsWith('ERROR:')){clearTimeout(timeout);if(!ready)reject(new Error(line.slice(6)));this.events.emit('failure',new Error(line.slice(6)));}
          this.events.emit('line',line);
        }
      });
      child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-1000);});
      child.stdin.on('error',()=>{});
      child.once('error',error=>{clearTimeout(timeout);reject(error);this.events.emit('failure',error);this.child=undefined;});
      child.once('exit',code=>{
        clearTimeout(timeout);this.child=undefined;
        const error=new Error(errors.trim() || 'Push-to-talk helper exited.');
        if(!ready)reject(error);
        this.events.emit('failure',error);
      });
    }).finally(()=>{this.starting=undefined;});
    return this.starting;
  }
  command(command,ack) {
    return new Promise((resolve,reject)=>{
      const done=(error)=>{
        clearTimeout(timer);this.events.off('line',onLine);this.events.off('failure',onError);
        error?reject(error):resolve();
      };
      const onLine=line=>{if(line===ack)done();},onError=error=>done(error);
      const timer=setTimeout(()=>done(new Error('Push-to-talk key operation timed out.')),5000);
      this.events.on('line',onLine);this.events.on('failure',onError);
      if(!this.child?.stdin?.writable){done(new Error('Push-to-talk helper is unavailable.'));return;}
      this.child.stdin.write(command+'\n',error=>{if(error)done(error);});
    });
  }
  hold(key) {
    const vk=virtualKey(key);
    const task=this.queue.catch(()=>{}).then(async()=>{await this.prepare();await this.command('DOWN:'+vk,'KEY_DOWN');});
    this.queue=task;return task;
  }
  releaseKey(key) {
    const vk=virtualKey(key);
    const task=this.queue.catch(()=>{}).then(async()=>{if(this.child)await this.command('UP:'+vk,'KEY_UP');});
    this.queue=task;return task;
  }
  release() {
    if(!this.child && !this.starting)return Promise.resolve();
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(this.starting)try{await this.starting;}catch{return;}
      if(this.child)await this.command('UP','KEY_UP');
    });
    this.queue=task;return task;
  }
}

// Each overlapping clip owns a lease. Shared keys stay held until the last
// clip using that key ends; Local and Squad can be held independently.
export class PttLeases {
  constructor(bridge){this.bridge=bridge;this.owners=new Map();this.counts=new Map();this.queue=Promise.resolve();}
  enqueue(operation){const task=this.queue.catch(()=>{}).then(operation);this.queue=task;return task;}
  create() {
    const owner=Symbol('audio');
    return {
      prepare:()=>this.bridge.prepare(),
      hold:key=>this.enqueue(async()=>{
        const normalized=normalizeKey(key);
        if(this.owners.has(owner))await this.remove(owner);
        const count=this.counts.get(normalized)||0;
        if(!count)await this.bridge.hold(normalized);
        this.counts.set(normalized,count+1);this.owners.set(owner,normalized);
      }),
      release:()=>this.enqueue(()=>this.remove(owner))
    };
  }
  async remove(owner) {
    const key=this.owners.get(owner);if(!key)return;
    const count=this.counts.get(key)||0;
    if(count<=1){await this.bridge.releaseKey(key);this.counts.delete(key);}
    else this.counts.set(key,count-1);
    this.owners.delete(owner);
  }
  clear(){return this.enqueue(async()=>{await this.bridge.release();this.owners.clear();this.counts.clear();});}
}
