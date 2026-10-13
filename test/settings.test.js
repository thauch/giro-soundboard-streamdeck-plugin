import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function fixture() {
 const ids=['url','status','login','keyOptions','favorite','customText','fontSize','fontSizeLabel','pttOptions','pttMode','squadKey','localKey','output','outputs','outputsStatus','volume','volumeLabel','open','refresh','disconnect'];
 const elements=Object.fromEntries(ids.map(id=>[id,{value:id==='volume'?'100':id==='fontSize'?'20':'',textContent:'',hidden:false,options:[],
   replaceChildren(...items){this.options=items;},add(option){this.options.push(option);}}]));
 const sent=[];let socket;
 class MockSocket {constructor(){socket=this;this.readyState=1;}send(raw){sent.push(JSON.parse(raw));}}
 class Option {constructor(label,value){this.label=label;this.text=label;this.value=value;}}
 const document={activeElement:null,getElementById:id=>elements[id]},sandbox={document,window:{},WebSocket:MockSocket,Option};
 vm.runInNewContext(fs.readFileSync(new URL('../com.giro.soundboard.sdPlugin/ui/settings.js',import.meta.url),'utf8'),sandbox);
 sandbox.window.connectElgatoStreamDeckSocket(123,'context','registerPropertyInspector','{}','{"action":"com.giro.soundboard.favorite"}');
 socket.onopen();
 const status=payload=>socket.onmessage({data:JSON.stringify({event:'sendToPropertyInspector',payload})});
 return {elements,sent,document,status};
}
test('status polling preserves the typed URL after focus moves and sends it to Discord login',()=>{
 const {elements,sent,document,status}=fixture();
 status({url:'',volume:100});
 elements.url.value='https://dirtydeedsgaming.com:8443';elements.url.oninput();document.activeElement=elements.login;
 status({url:'',volume:100});assert.equal(elements.url.value,'https://dirtydeedsgaming.com:8443');
 elements.login.onclick();assert.equal(sent.at(-1).payload.url,'https://dirtydeedsgaming.com:8443');assert.equal(sent.at(-1).payload.op,'login');
});
test('favorite dropdown starts with Auto; per-key pin, edited label, and selected device survive polling',()=>{
 const {elements,sent,status}=fixture();
 const payload={sounds:[{filename:'one.mp3',displayname:'One'},{filename:'two.mp3',displayname:'Two'}],
   outputs:[{id:'device-123',name:'Virtual cable'}],key:{slot:0},isFavorite:true};
 status(payload);
 assert.equal(elements.favorite.options[0].text,'Auto');assert.equal(elements.favorite.options[0].value,'');
 elements.favorite.value='two.mp3';elements.favorite.onchange();
 elements.customText.value='My custom\nlabel';elements.customText.oninput();
 elements.output.value='device-123';elements.output.onchange();
 assert.equal(sent.at(-1).payload.settings.favorite,'two.mp3');
 assert.equal(sent.at(-1).payload.settings.output,'device-123');
 assert.equal(sent.at(-1).payload.settings.customText,'My custom\nlabel');
 status(payload);assert.equal(elements.favorite.value,'two.mp3');assert.equal(elements.customText.value,'My custom\nlabel');
 assert.equal(elements.output.value,'device-123');
});

test('PTT defaults to Local/K with Squad/J and saves the user choices per button',()=>{
 const {elements,sent,status}=fixture();status({key:{},isFavorite:true,pttSupported:true});
 assert.equal(elements.pttMode.value,'local');assert.equal(elements.localKey.value,'K');assert.equal(elements.squadKey.value,'J');
 elements.pttMode.value='squad';elements.squadKey.value='F8';elements.localKey.value='Space';
 elements.pttMode.onchange();
 assert.equal(sent.at(-1).payload.settings.pttMode,'squad');
 assert.equal(sent.at(-1).payload.settings.squadKey,'F8');assert.equal(sent.at(-1).payload.settings.localKey,'Space');
 elements.pttMode.value='off';elements.pttMode.onchange();
 assert.equal(sent.at(-1).payload.settings.pttMode,'off');
});
