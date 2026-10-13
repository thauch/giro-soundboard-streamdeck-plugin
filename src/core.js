export const PREFIX = 'com.giro.soundboard';
export function normalizeUrl(value) {
  let url;
  try {url=new URL(String(value || '').replace(/[\u200B-\u200D\uFEFF]/g,'').trim());}
  catch {throw new Error('Enter your full soundboard address, such as https://dirtydeedsgaming.com:8443');}
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Enter the soundboard address, such as https://soundboard.example.com');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    throw new Error('Use HTTPS for a remote soundboard.');
  return url.href.replace(/\/$/, '');
}
export function favoriteFor(sounds, page, slot, pageSize=29) {
  return sounds[Math.max(0, page)*pageSize + slot];
}
export function clampPage(page, count, pageSize=29) {
  return Math.max(0, Math.min(page, Math.max(0, Math.ceil(count/pageSize)-1)));
}
export function titleLines(value) {
  const words=String(value).replace(/[\r\n]+/g,' ').trim().split(/\s+/), lines=[''];
  for (const word of words) {
    if(lines.at(-1).length + word.length + 1 > 13 && lines.at(-1))lines.push('');
    lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;
  }
  return lines.slice(0,3).map(line=>line.length>15?line.slice(0,14)+'…':line).join('\n');
}
export class SoundboardClient {
  constructor(fetcher=fetch) {this.fetcher=fetcher;}
  async request(url, path, token, body) {
    const response=await this.fetcher(normalizeUrl(url)+path,{
      method:body?'POST':'GET',
      headers:{'Content-Type':'application/json',...(token?{'X-StreamDeck-Token':token}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(8000), redirect:'error', cache:'no-store'
    });
    let data;
    try {data=await response.json();}catch {throw new Error('The address did not return a soundboard response.');}
    if(response.status===404)throw new Error('Update and restart the soundboard server to enable Stream Deck sign-in.');
    if(!response.ok)throw Object.assign(new Error(data.error || 'Soundboard request failed.'),{status:response.status});
    return data;
  }
  startLogin(url) {return this.request(url,'/api/streamdeck/account/login/start','',{});}
  pollLogin(url,request,secret) {return this.request(url,'/api/streamdeck/account/login/poll','',{request,secret});}
  async accountRequest(settings,path,body) {
    const response=await this.fetcher(normalizeUrl(settings.url)+path,{
      method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-StreamDeck-Account':settings.token},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000),redirect:'error',cache:'no-store'});
    let data;
    try {data=await response.json();}catch {throw new Error('Update and restart the soundboard server to enable Stream Deck sign-in.');}
    if(!response.ok)throw Object.assign(new Error(data.error || 'Soundboard request failed.'),{status:response.status});
    return data;
  }
  status(settings) {return this.accountRequest(settings,'/api/streamdeck/account/status');}
  recordPlay(settings,file) {return this.accountRequest(settings,'/api/streamdeck/account/play',{file});}
  logout(settings) {return this.accountRequest(settings,'/api/streamdeck/account/logout',{});}
}

export function favoriteLayout(count) {
  return count>29 || count<1 ? 'profiles/Giro Soundboard XL' : 'profiles/Giro Favorites XL - '+count;
}
export const BLANK_KEY='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" fill="black"/></svg>').toString('base64');

export function navigationFor(kind,page,count,pageSize) {
  const total=Math.max(1,Math.ceil(count/pageSize));
  const enabled=kind==='next'?page<total-1:page>0;
  return {enabled,title:(kind==='next'?'Next':'Previous')+'\n'+(page+1)+' / '+total,
    image:'imgs/'+kind+(enabled?'':'-muted')+'.svg'};
}
