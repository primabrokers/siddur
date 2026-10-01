// Scope-locked demo capacity fix. The saved v21 application is unchanged.
// Preserve every existing temporary workspace in its original process.
import {readFileSync,lstatSync,copyFileSync,chmodSync,openSync,writeSync,ftruncateSync,fsyncSync,closeSync,statfsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';

const path='/opt/agent-stack/Caddyfile',apply=process.argv.includes('--apply');
const hash=s=>createHash('sha256').update(s).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const normal=s=>JSON.stringify(canonical(JSON.parse(s)));
function run(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024});if(r.status!==0)throw new Error('Docker operation failed; shared config output withheld');return r.stdout;}
if(hostname()!=='srv1876836')throw new Error('Wrong host');
const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0)throw new Error('Unexpected Caddyfile');
const old=readFileSync(path,'utf8'),marker='sofer.primainsurance.tech {';
const start=old.indexOf(marker);if(start<0||old.indexOf(marker,start+1)!==-1)throw new Error('Expected one Sofer block');
let depth=0,end=-1;for(let i=old.indexOf('{',start);i<old.length;i++){if(old[i]==='{')depth++;if(old[i]==='}'&&--depth===0){end=i+1;break;}}
if(end<0)throw new Error('Unbalanced block');
const original=old.slice(start,end);
const expected=readFileSync(new URL('./sofer-site-v21.caddy',import.meta.url),'utf8').replace(/\r\n/g,'\n').trim();
if(original!==expected)throw new Error('Sofer routing changed since audit; stop for review');
const block=readFileSync(new URL('./sofer-site-demo-capacity-v22.caddy',import.meta.url),'utf8').replace(/\r\n/g,'\n').trim();
if(!block.includes('sofer-studio-app-v21:8080')||!block.includes('sofer-studio-demo-v22:8080'))throw new Error('Missing capacity or saved-workspace route');
const desired=old.slice(0,start)+block+old.slice(end);
const live=run(['exec','agent-stack-caddy-1','wget','-qO-','http://127.0.0.1:2019/config/']);
const adapted=run(['exec','-i','agent-stack-caddy-1','caddy','adapt','--config','/dev/stdin','--adapter','caddyfile'],old);
if(normal(live)!==normal(adapted))throw new Error('Live config/file mismatch');
run(['exec','-i','agent-stack-caddy-1','caddy','validate','--config','/dev/stdin','--adapter','caddyfile'],desired);
console.log(JSON.stringify({validated:true,apply,change:'Sofer demo capacity 3 to 12; preserve all existing temporary and saved workspaces',otherHostBytesHash:hash(old.slice(0,start)+old.slice(end))}));
if(!apply)process.exit(0);
for(const name of ['prima-sofer-studio-v21','prima-sofer-demo-v21','prima-sofer-demo-v22']){
  const state=JSON.parse(run(['inspect',name,'--format','{{json .State}}']));
  if(!state.Running||state.Health?.Status!=='healthy')throw new Error('Required Sofer service not healthy');
}
const parentImage='sha256:bca1635b8502f427c3085c7a8aec553dc7eb8ba0998cacee9df752204e406bc6';
for(const name of ['prima-sofer-studio-v21','prima-sofer-demo-v21']){
  if(run(['inspect',name,'--format','{{.Image}}']).trim()!==parentImage)throw new Error('Unexpected v21 application image');
}
const capacity=JSON.parse(run(['exec','prima-sofer-demo-v22','node','-e',"fetch('http://127.0.0.1:8080/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"]));
if(capacity.maxSessions!==12||capacity.mode!=='isolated-demo')throw new Error('Wrong demo capacity');
const memAvailable=Number(readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1])*1024;
if(!Number.isFinite(memAvailable)||memAvailable<16*1024**3)throw new Error('Insufficient memory headroom for demo capacity');
const disk=statfsSync('/opt');if(disk.bavail*disk.bsize<2*1024**3)throw new Error('Low disk');
if(readFileSync(path,'utf8')!==old)throw new Error('Concurrent config edit');
const backup='/opt/sofer-studio/backups/Caddyfile.before-demo-capacity-v22-'+Date.now();copyFileSync(path,backup);chmodSync(backup,0o600);
function persist(text){const bytes=Buffer.from(text),fd=openSync(path,'r+');try{let i=0;while(i<bytes.length)i+=writeSync(fd,bytes,i,bytes.length-i,i);ftruncateSync(fd,bytes.length);fsyncSync(fd);}finally{closeSync(fd);}}
try{
  persist(desired);run(['exec','agent-stack-caddy-1','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);
  const after=run(['exec','agent-stack-caddy-1','wget','-qO-','http://127.0.0.1:2019/config/']);
  const expected=run(['exec','-i','agent-stack-caddy-1','caddy','adapt','--config','/dev/stdin','--adapter','caddyfile'],desired);
  if(normal(after)!==normal(expected))throw new Error('Live config mismatch');
  console.log(JSON.stringify({applied:true,backup,otherHostsUnchanged:true,oldSoferContainersRestarted:false}));
}catch(e){
  if(readFileSync(path,'utf8')===desired){persist(old);run(['exec','agent-stack-caddy-1','caddy','reload','--config','/etc/caddy/Caddyfile','--adapter','caddyfile']);console.log('Scoped Sofer route restored after verification failure');}
  throw e;
}
