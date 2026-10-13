let socket,context,actionInfo,loadedUrl=false,urlEdited=false,loadedKey=false,latestKey={};
let favoriteSignature='',outputSignature='';
const $=id=>document.getElementById(id);
function send(payload){
  if(socket?.readyState!==1){$('status').textContent='Stream Deck is disconnected. Select the key again.';return;}
  socket.send(JSON.stringify({event:'sendToPlugin',action:actionInfo.action,context,payload}));
}
function fill(select,first,options,selected) {
  select.replaceChildren(new Option(first.label,first.value));
  for(const option of options)select.add(new Option(option.label,option.value));
  if(selected && ![...select.options].some(option=>option.value===selected))
    select.add(new Option('Unavailable: '+selected,selected));
  select.value=selected || first.value;
}
function saveKey(){
  latestKey={...latestKey,favorite:$('favorite').value,customText:$('customText').value,
    fontSize:Number($('fontSize').value),output:$('output').value,
    pttMode:$('pttMode').value || 'local',squadKey:$('squadKey').value.trim() || 'J',localKey:$('localKey').value.trim() || 'K'};
  send({op:'keySettings',settings:latestKey});
}
window.connectElgatoStreamDeckSocket=(port,uuid,event,_info,serializedAction)=>{
  context=uuid;actionInfo=JSON.parse(serializedAction);
  socket=new WebSocket('ws://127.0.0.1:'+port);
  socket.onopen=()=>{socket.send(JSON.stringify({event,uuid}));send({op:'status'});};
  socket.onmessage=message=>{
    const data=JSON.parse(message.data);if(data.event!=='sendToPropertyInspector')return;
    const state=data.payload;
    if(!loadedUrl && !urlEdited){$('url').value=state.url || '';loadedUrl=true;}
    $('status').textContent=state.notice || 'Sign in to load favorites.';
    $('login').disabled=Boolean(state.loginPending);
    $('login').textContent=state.loginPending?'Waiting for Discord…':'Sign in with Discord';
    $('keyOptions').hidden=state.isFavorite===false;
    $('pttOptions').hidden=state.pttSupported===false;
    const key=loadedKey?latestKey:state.key || {};
    if(!loadedKey){
      latestKey={...key};$('customText').value=key.customText || '';
      $('fontSize').value=key.fontSize || 20;
      $('pttMode').value=key.pttMode || 'local';$('squadKey').value=key.squadKey || 'J';$('localKey').value=key.localKey || 'K';
      loadedKey=true;
    }
    const sounds=state.sounds || [],favoriteState=JSON.stringify([sounds,key.favorite || '']);
    if(favoriteState!==favoriteSignature){
      fill($('favorite'),{label:'Auto',value:''},sounds.map(sound=>({label:sound.displayname,value:sound.filename})),key.favorite || '');
      favoriteSignature=favoriteState;
    }
    const devices=state.outputs || [],outputState=JSON.stringify([devices,key.output || 'auto']);
    if(outputState!==outputSignature){
      fill($('output'),{label:'System default',value:'auto'},devices.map(device=>({label:device.name,value:device.id})),key.output || 'auto');
      outputSignature=outputState;
    }
    $('outputsStatus').textContent=state.outputsError || '';
    if(document.activeElement!==$('volume'))$('volume').value=state.volume ?? 100;
    $('volumeLabel').textContent=$('volume').value+'%';
    $('fontSizeLabel').textContent=$('fontSize').value;
  };
  socket.onclose=()=>{$('status').textContent='Stream Deck disconnected. Select the key again.';};
};
$('url').oninput=()=>{urlEdited=true;};
$('login').onclick=()=>{$('status').textContent='Opening Discord sign-in…';send({op:'login',url:$('url').value.trim()});};
$('open').onclick=()=>send({op:'openSoundboard',url:$('url').value.trim()});
$('favorite').onchange=saveKey;
$('customText').oninput=saveKey;
$('fontSize').oninput=()=>{$('fontSizeLabel').textContent=$('fontSize').value;saveKey();};
$('output').onchange=saveKey;
$('outputs').onclick=()=>{$('outputsStatus').textContent='Loading audio outputs…';send({op:'outputs'});};
$('volume').oninput=()=>{$('volumeLabel').textContent=$('volume').value+'%';};
$('volume').onchange=()=>send({op:'volume',volume:Number($('volume').value)});
$('refresh').onclick=()=>send({op:'refresh'});
$('disconnect').onclick=()=>send({op:'disconnect'});

for(const id of ['pttMode','squadKey','localKey'])$(id).onchange=saveKey;
