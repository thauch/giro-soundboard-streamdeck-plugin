import json, uuid, zipfile
from pathlib import Path
root=Path('com.giro.soundboard.sdPlugin')
manifest=json.loads((root/'manifest.json').read_text())
profiles=Path('dist/profiles');profiles.mkdir(parents=True,exist_ok=True)
def write_profile(name,count,paging=False):
    actions={}
    for i in range(count):
        actions[f'{i%8},{i//8}']={
            'UUID':'com.giro.soundboard.favorite','Name':'Favorite Sound',
            'Settings':{'slot':i},
            'States':[{'Image':'','Title':'','TitleAlignment':'middle','FontSize':13}],
            'LinkedTitle':True
        }
    controls={31:'stop'}
    if paging: controls.update({29:'previous',30:'next'})
    for i,kind in controls.items():
        definition=next(a for a in manifest['Actions'] if a['UUID'].endswith('.'+kind))
        actions[f'{i%8},{i//8}']={
            'UUID':definition['UUID'],'Name':definition['Name'],'Settings':{},
            'States':[{'Image':'','Title':'','TitleAlignment':'bottom','FontSize':11}],
            'LinkedTitle':True
        }
    bundle={'Actions':actions,'DeviceModel':'20GAV9901','Name':name,'Version':'1.0'}
    with zipfile.ZipFile(profiles/f'{name}.streamDeckProfile','w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(str(uuid.uuid4()).upper()+'.sdProfile/manifest.json',json.dumps(bundle))
write_profile('Giro Soundboard XL',29,True)
for count in range(1,30):
    write_profile(f'Giro Favorites XL - {count}',count)
print('Generated auto-sized XL layouts for 1–29 favorites plus full paged layout.')
# The plugin-list icon must be PNG. Generate its geometric play artwork directly.
import struct, zlib
def chunk(kind,data):
    return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
def make_icon(size):
    rows=[]
    for y in range(size):
        row=bytearray()
        for x in range(size):
            xx,yy=x*144/size,y*144/size
            border=(5<=xx<139 and 5<=yy<139 and (xx<8 or xx>135 or yy<8 or yy>135))
            play=(43<=xx<=103 and abs(yy-72)<=max(0,(103-xx)*.65))
            row.extend((105,226,194,255) if border or play else (20,28,39,255))
        rows.append(b'\x00'+row)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
(root/'imgs/plugin.png').write_bytes(make_icon(144))
(root/'imgs/plugin@2x.png').write_bytes(make_icon(288))
