import streamDeck, { action, SingletonAction } from '@elgato/streamdeck';
import {pttSettings,holdKeyFor} from './ptt.js';
import { keyImage, resolveFavorite } from './labels.js';
import { SoundMixer } from './mixer.js';
import { PREFIX, SoundboardClient, normalizeUrl, clampPage, navigationFor, BLANK_KEY } from './core.js';

const player=new SoundMixer();
const client=new SoundboardClient(), visible=new Map(), pages=new Map(), painted=new Map();
let outputs=[],outputsError='',outputLoading;
let settings={}, sounds=[], ready=false, notice='Sign in with Discord to load your favorites.', revision=0, refreshing,login,playbackRequest=0;
const confirmations=new Map();
const CONFIRMATION_IMAGE='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="14" fill="#141c27"/><circle cx="72" cy="72" r="39" fill="#294437"/><path d="m49 72 15 15 31-32" fill="none" stroke="#69e2c2" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>').toString('base64');
async function flashConfirmation(key){
  clearTimeout(confirmations.get(key.id));
  confirmations.set(key.id,setTimeout(()=>{confirmations.delete(key.id);void repaint().catch(error=>streamDeck.logger.warn(error.message));},250));
  await repaint();
}
const DEFAULT_URL='https://dirtydeedsgaming.com:8443';
player.onError=error=>{notice=error.message;tellInspector().catch(()=>{});};
player.onProgress=()=>{void repaint().catch(error=>streamDeck.logger.warn(error.message));};
async function saveSettings(){await streamDeck.settings.setGlobalSettings(settings);}
const deviceId=key=>key.device.id;
function slotsFor(device) {
  return [...visible.values()].filter(entry=>entry.kind==='favorite' && deviceId(entry.key)===device)
    .sort((a,b)=>(a.key.coordinates?.row || 0)-(b.key.coordinates?.row || 0) ||
      (a.key.coordinates?.column || 0)-(b.key.coordinates?.column || 0));
}
function slotFor(entry) {
  return Number.isInteger(entry.settings.slot) && entry.settings.slot>=0 && entry.settings.slot<29
    ?entry.settings.slot:slotsFor(deviceId(entry.key)).findIndex(item=>item.key.id===entry.key.id);
}
function pageSizeFor(device) {
  const entries=[...visible.values()].filter(entry=>entry.kind==='favorite' && deviceId(entry.key)===device);
  return Math.min(29,Math.max(1,...entries.map(entry=>slotFor(entry)+1)));
}
async function repaint() {
  await Promise.all([...visible.values()].map(async entry=>{
    const device=deviceId(entry.key), size=pageSizeFor(device),page=clampPage(pages.get(device)||0,sounds.length,size);
    pages.set(device,page);
    let title, image;
    if(entry.kind==='favorite') {
      const sound=ready?resolveFavorite(sounds,entry.settings,page,slotFor(entry),size):undefined;
      title=!settings.token?'Sign in\nDiscord':!ready?'Offline\nReconnect':'';
      image=sound?keyImage(sound.filename,entry.settings.customText || sound.displayname,entry.settings.fontSize || 20,player.progressFor(sound.filename)):ready?BLANK_KEY:'imgs/favorite.svg';
    } else {
      if(entry.kind==='stop'){title='Stop';image='imgs/stop.svg';}
      else {const nav=navigationFor(entry.kind,page,sounds.length,size);title=nav.title;image=nav.image;}
    }
    if(confirmations.has(entry.key.id)){title='';image=CONFIRMATION_IMAGE;}
    const state=JSON.stringify([title,image]);
    if(painted.get(entry.key.id)===state)return;
    await entry.key.setTitle(title);
    await entry.key.setImage(image);
    painted.set(entry.key.id,state);
  }));
}
async function tellInspector() {
  const entry=visible.get(streamDeck.ui.action?.id);
  await streamDeck.ui.sendToPropertyInspector({url:settings.url || DEFAULT_URL,signedIn:Boolean(settings.token),ready,
    notice,count:sounds.length,volume:settings.volume ?? 100,loginPending:Boolean(login),
    sounds:sounds.map(sound=>({filename:sound.filename,displayname:sound.displayname})),
    key:entry?.settings || {},isFavorite:entry?.kind==='favorite',outputs,outputsError,pttSupported:process.platform==='win32'}).catch(()=>{});
}
async function loadOutputs() {
  if(outputLoading)return outputLoading;
  outputLoading=(async()=>{
    try{outputs=await player.listOutputs();outputsError='';}
    catch(error){outputsError=error.message;}
    finally{await tellInspector();}
  })().finally(()=>{outputLoading=undefined;});
  return outputLoading;
}
async function refresh() {
  if(refreshing)return refreshing;
  const version=revision, connection={...settings};
  refreshing=(async()=>{
    try {
      if(!connection.url || !connection.token){ready=false;sounds=[];return;}
      const data=await client.status(connection);
      if(version!==revision)return;
      sounds=data.sounds || [];ready=true;
      notice='Signed in as '+data.name+' · '+sounds.length+' favorites · audio plays on this computer';
    } catch(error) {
      if(version!==revision)return;
      ready=false;notice=error.message;
    } finally {
      if(version===revision){await repaint();await tellInspector();}
    }
  })().finally(()=>{refreshing=undefined;});
  return refreshing;
}
class SoundboardAction extends SingletonAction {
  constructor(kind){super();this.kind=kind;}
  async onWillAppear(ev) {
    if(!ev.action.isKey())return;
    visible.set(ev.action.id,{key:ev.action,kind:this.kind,settings:ev.payload.settings || {}});
    await repaint();await refresh();
  }
  async onWillDisappear(ev){clearTimeout(confirmations.get(ev.action.id));confirmations.delete(ev.action.id);visible.delete(ev.action.id);painted.delete(ev.action.id);await repaint();}
  async onDidReceiveSettings(ev) {
    const entry=visible.get(ev.action.id);if(entry)entry.settings=ev.payload.settings || {};
    painted.delete(ev.action.id);await repaint();await tellInspector();
  }
  async onPropertyInspectorDidAppear(){await tellInspector();await loadOutputs();}
  async onSendToPlugin(ev) {
    const data=ev.payload || {};
    try {
      if(data.op==='login'){
        const url=normalizeUrl(data.url || settings.url || DEFAULT_URL);
        const result=await client.startLogin(url);
        login={...result,url,expiresAt:Date.now()+result.expiresIn*1000};
        notice='Authorize the soundboard in Discord. Favorites will load automatically.';
        playbackRequest++;revision++;await player.stop();ready=false;sounds=[];
        settings={url,mode:'account',volume:settings.volume ?? 100};
        await saveSettings();
        await streamDeck.system.openUrl(url+result.verificationPath);
      } else if(data.op==='openSoundboard'){
        await streamDeck.system.openUrl(normalizeUrl(data.url || settings.url || DEFAULT_URL)+'/live');
      } else if(data.op==='disconnect'){
        login=undefined;playbackRequest++;revision++;await player.stop();
        const old={...settings};
        settings={url:settings.url || DEFAULT_URL,volume:settings.volume ?? 100,mode:'account'};
        ready=false;sounds=[];notice='Signed out of Stream Deck.';
        await saveSettings();await repaint();
        if(old.token)try{await client.logout(old);}catch{notice='Signed out locally. The server could not confirm credential revocation.';}
      } else if(data.op==='keySettings'){
        const entry=visible.get(ev.action.id);
        if(!entry)throw new Error('Select a sound key first.');
        const incoming=data.settings || {};
        const favorite=String(incoming.favorite || '');
        if(favorite && !sounds.some(sound=>sound.filename===favorite) && favorite!==entry.settings.favorite)
          throw new Error('Choose one of your current favorites.');
        const customText=String(incoming.customText || '').slice(0,500);
        const fontSize=Number(incoming.fontSize || 20);
        if(!Number.isFinite(fontSize) || fontSize<8 || fontSize>28)throw new Error('Choose a text size from 8 to 28.');
        const output=String(incoming.output || 'auto');
        if(output.length>4096 || output.includes('\0'))throw new Error('Choose a valid audio output.');
        const ptt=pttSettings({...entry.settings,...incoming});
        entry.settings={...entry.settings,favorite,customText,fontSize,output,...ptt};
        await ev.action.setSettings(entry.settings);
        painted.delete(ev.action.id);await repaint();
      } else if(data.op==='outputs'){await loadOutputs();
      } else if(data.op==='volume'){
        const volume=Number(data.volume);
        if(!Number.isFinite(volume) || volume<0 || volume>100)throw new Error('Choose a volume from 0 to 100.');
        settings={...settings,volume};await saveSettings();
      } else if(data.op==='refresh'){await refresh();}
      else if(data.op==='status'){await tellInspector();}
    } catch(error){notice=error.message;await tellInspector();await ev.action.showAlert();}
    await tellInspector();
  }
  async onKeyDown(ev) {
    try {
      const entry=visible.get(ev.action.id);
      if(this.kind==='stop'){playbackRequest++;await player.stop();await flashConfirmation(ev.action);return;}
      if(!entry || !settings.token)throw new Error('Sign in with Discord in plugin settings.');
      if(this.kind==='next' || this.kind==='previous'){
        if(!ready)throw new Error('Soundboard disconnected.');
        const device=deviceId(ev.action);
        if(!navigationFor(this.kind,pages.get(device)||0,sounds.length,pageSizeFor(device)).enabled)return;
        pages.set(device,clampPage((pages.get(device)||0)+(this.kind==='next'?1:-1),sounds.length,pageSizeFor(device)));
        await repaint();return;
      }
      if(!ready)throw new Error('Soundboard unavailable. Refresh or sign in again.');
      if(this.kind==='favorite'){
        const sound=resolveFavorite(sounds,entry.settings,pages.get(deviceId(ev.action))||0,slotFor(entry),pageSizeFor(deviceId(ev.action)));
        if(!sound)throw new Error(entry.settings.favorite?'This favorite is unavailable. Choose another sound for this button.':'Add more favorites on your soundboard.');
        const sequence=++playbackRequest,connection={...settings};
        // History is independent of playback; network latency must not delay a key.
        void client.recordPlay(connection,sound.filename).catch(error=>streamDeck.logger.warn(error.message));
        if(sequence!==playbackRequest)return;
        await player.play(connection,sound.filename,settings.volume ?? 100,entry.settings.output || 'auto',holdKeyFor(entry.settings));
      }
      await flashConfirmation(ev.action);
    } catch(error){if(error.name==='AbortError')return;notice=error.message;await tellInspector();await ev.action.showAlert();}
  }
}
for(const kind of ['favorite','previous','next','stop']){
  const Registered=action({UUID:PREFIX+'.'+kind})(SoundboardAction);
  streamDeck.actions.registerAction(new Registered(kind));
}
streamDeck.settings.onDidReceiveGlobalSettings(async ev=>{
  const incoming=ev.settings || {};
  if(incoming.url!==settings.url || incoming.token!==settings.token){
    playbackRequest++;revision++;await player.stop();settings=incoming.mode==='account'?incoming:{url:incoming.url || DEFAULT_URL,volume:100,mode:'account'};ready=false;sounds=[];painted.clear();pages.clear();await repaint();
  } else settings={...settings,volume:incoming.volume ?? settings.volume ?? 100};
});
await streamDeck.connect();
settings=await streamDeck.settings.getGlobalSettings();
if(settings.mode!=='account')settings={url:settings.url || DEFAULT_URL,volume:100,mode:'account'};
await saveSettings();
await refresh();
let polling=false;
setInterval(async()=>{
  if(polling)return;polling=true;
  try{
    if(login){
      const pending=login;
      if(Date.now()>pending.expiresAt){login=undefined;notice='Sign-in expired. Click Sign in with Discord again.';await tellInspector();}
      else {
        const result=await client.pollLogin(pending.url,pending.request,pending.secret);
        if(login!==pending)return;
        if(!result.pending){
          login=undefined;playbackRequest++;revision++;await player.stop();
          settings={url:pending.url,token:result.token,mode:'account',volume:settings.volume ?? 100};
          ready=false;sounds=[];pages.clear();painted.clear();await saveSettings();
          if(refreshing)await refreshing;
        }
      }
    }
    await refresh();
  }catch(error){notice=error.message;if(error.status===401)login=undefined;await tellInspector();}
  finally{polling=false;}
},2000);
process.once('SIGTERM',()=>{player.stop().finally(()=>process.exit(0));});
