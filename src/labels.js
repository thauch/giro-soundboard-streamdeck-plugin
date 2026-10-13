const escapeXml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
function width(text,size) {
  return [...text].reduce((total,char)=>total+(/[ilI.,'!|]/.test(char)?.32:/[MW@#%]/.test(char)?.9:/\s/.test(char)?.32:.61)*size,0);
}
function wrap(text,size,maxWidth) {
  const lines=[];
  for(const paragraph of String(text).replace(/\r/g,'').split('\n')){
    let line='';
    for(const word of paragraph.split(/\s+/).filter(Boolean)){
      if(line && width(line+' '+word,size)<=maxWidth){line+=' '+word;continue;}
      if(line){lines.push(line);line='';}
      for(const char of word){
        if(line && width(line+char,size)>maxWidth){lines.push(line);line='';}
        line+=char;
      }
    }
    lines.push(line);
  }
  return lines;
}
export function fitLabel(text,requested=20) {
  const maximum=Math.max(8,Math.min(28,Number(requested)||20));
  let result;
  for(let size=maximum;size>=4;size-=.5){
    const lines=wrap(text,size,124);
    result={lines,fontSize:size,lineHeight:size*1.2};
    if(lines.length*result.lineHeight<=112)return result;
  }
  return result;
}
export function keyImage(filename,text,requested=20) {
  let hash=0;for(const char of filename)hash=(hash*31+char.charCodeAt(0))>>>0;
  const hue=hash%360,{lines,fontSize,lineHeight}=fitLabel(text,requested);
  const y=72-(lines.length-1)*lineHeight/2;
  const labels=lines.map((line,i)=>'<text x="72" y="'+(y+i*lineHeight)+'" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="'+fontSize+'" font-weight="600" fill="#f0f5fa">'+escapeXml(line)+'</text>').join('');
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="14" fill="#141c27"/><rect x="5" y="5" width="134" height="134" rx="12" fill="hsl('+hue+',30%,18%)" stroke="hsl('+hue+',55%,60%)" stroke-width="3"/>'+labels+'</svg>';
  return 'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
}
export function resolveFavorite(sounds,settings,page,slot,pageSize) {
  return settings.favorite?sounds.find(sound=>sound.filename===settings.favorite):sounds[page*pageSize+slot];
}
