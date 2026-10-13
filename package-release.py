"""Bundle release assets without user logs, settings, credentials, or dependencies."""
import hashlib
import json
from pathlib import Path
from shutil import copyfile
import zipfile

root = Path(__file__).resolve().parent
dist = root / 'dist'
version = json.loads((root / 'package.json').read_text())['version']
installer = dist / f'Giro-Soundboard-v{version}.streamDeckPlugin'
bundle = dist / f'Giro-StreamDeck-XL-v{version}.zip'
copyfile(dist / 'com.giro.soundboard.streamDeckPlugin', installer)
with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(installer, installer.name)
    archive.write(dist / 'profiles/Giro Soundboard XL.streamDeckProfile', 'Giro-Soundboard-XL.streamDeckProfile')
    for profile in sorted((dist / 'profiles').glob('Giro Favorites XL - *.streamDeckProfile')):
        archive.write(profile, 'Optional XL layouts/' + profile.name)
    archive.write(root / 'README.md', 'README.md')
with zipfile.ZipFile(bundle) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Release bundle failed integrity validation.')
(dist / 'SHA256SUMS.txt').write_text(''.join(
    f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n'
    for file in [installer, bundle]
))
print(f'Release ready: {installer.name}, {bundle.name}, SHA256SUMS.txt')
