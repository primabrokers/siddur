"""Build the portable Windows ZIP from pinned runtime archives and npm lockfile.

python offline/build.py --node-zip PATH --sqlite-tar PATH --output ZIP_PATH
Run npm ci before building. No user data, credentials or dev dependencies enter
the package. The only binaries are the verified Node archive and SQLite binding.
"""
import argparse, hashlib, json, shutil, tarfile, tempfile, zipfile
from pathlib import Path

NODE_SHA256 = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'
parser = argparse.ArgumentParser()
parser.add_argument('--node-zip', type=Path, required=True)
parser.add_argument('--sqlite-tar', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert hashlib.sha256(args.node_zip.read_bytes()).hexdigest() == NODE_SHA256, 'Node archive checksum mismatch'
assert hashlib.sha256(args.sqlite_tar.read_bytes()).hexdigest() == '94bdd2d44203759a4e1b76f4f7e91750cfeca4190e9fe356b05c1f73599124e9', 'SQLite binding archive checksum mismatch'
app = Path(__file__).resolve().parents[1]
lock = json.loads((app/'package-lock.json').read_text())
assert lock['packages']['node_modules/better-sqlite3']['version'] == '11.10.0'
with tempfile.TemporaryDirectory(prefix='sofer-offline-build-') as temp:
    base = Path(temp)/'Sofer Studio'; target = base/'sofer-studio'; target.mkdir(parents=True)
    for folder in ['public','engine','server','db','reference-data']:
        shutil.copytree(app/folder,target/folder,ignore=shutil.ignore_patterns('downloads','*.sqlite*','*.db*','*.log','__pycache__'))
    for name in ['package.json','package-lock.json','server.js']:
        shutil.copy2(app/name,target/name)
    index=target/'public'/'index.html'
    index.write_text(index.read_text(encoding='utf-8').replace('<a class="btn btn-ghost account-link" href="/_prima_auth/change-password">Change password</a>',''),encoding='utf-8')
    index.write_text(index.read_text(encoding='utf-8').replace('</head>','<style>.offline-download{display:none!important}</style></head>'),encoding='utf-8')
    shutil.copytree(app.parent/'docs'/'sofer-studio'/'source-data',base/'docs'/'sofer-studio'/'source-data')
    (target/'offline').mkdir()
    shutil.copy2(app/'offline'/'launch.mjs',target/'offline'/'launch.mjs')
    for name in ['Start Sofer.cmd','README.txt']: shutil.copy2(app/'offline'/name,base/name)
    for name, meta in lock['packages'].items():
        if not name or meta.get('dev'): continue
        assert name.startswith('node_modules/') and '..' not in Path(name).parts
        shutil.copytree(app/name,target/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('test','tests','benchmark','docs','build','.github'))
    native = target/'node_modules'/'better-sqlite3'/'build'/'Release'; native.mkdir(parents=True)
    with tarfile.open(args.sqlite_tar) as archive:
        member=archive.extractfile('build/Release/better_sqlite3.node'); assert member
        (native/'better_sqlite3.node').write_bytes(member.read())
    runtime=base/'runtime';runtime.mkdir()
    with zipfile.ZipFile(args.node_zip) as archive:
        for name in ['node.exe','LICENSE']:
            (runtime/name).write_bytes(archive.read('node-v22.23.2-win-x64/'+name))
    manifest={str(p.relative_to(base)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(base.rglob('*')) if p.is_file()}
    (base/'manifest.json').write_text(json.dumps({'release':'feedback-v17','node':'22.23.2','sqlite':'11.10.0','files':manifest},indent=2))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for path in sorted(base.rglob('*')):
            if path.is_file(): archive.write(path,path.relative_to(base.parent))
print(json.dumps({'zip':str(args.output),'bytes':args.output.stat().st_size,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'files':len(manifest)}))
