import http from 'node:http';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const HOST='sofer.primainsurance.tech';
const ORIGIN=`https://${HOST}`;
const COOKIE=process.env.SOFER_DEMO_COOKIE||'__Host-sofer_demo_v5';
if(!/^__Host-sofer_demo_v\d+$/.test(COOKIE))throw new Error('Invalid demo cookie name');
const COOKIE_RE=new RegExp('(?:^|;\\s*)'+COOKIE+'=([a-f0-9]{64})(?:;|$)');
const HEADERS={
  'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
};
function sessionId(req){const match=(req.headers.cookie||'').match(COOKIE_RE);return match?.[1];}
function launchSession(){
  return new Promise((resolve,reject)=>{
    const child=fork('/app/demo/session.mjs',[],{cwd:'/tmp',execArgv:['--max-old-space-size=768'],env:{PATH:process.env.PATH,NODE_ENV:'production'},stdio:['ignore','ignore','ignore','ipc']});
    const timer=setTimeout(()=>{child.kill();reject(new Error('Session startup timed out'));},8000);
    child.once('error',()=>{clearTimeout(timer);reject(new Error('Session startup failed'));});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Session exited'));});
    child.once('message',m=>{clearTimeout(timer);if(!Number.isInteger(m.port)||m.port<1){child.kill();reject(new Error('Invalid session port'));return;}resolve({port:m.port,child});});
  });
}

// The original three-workspace ceiling also counted browser checks and blocked
// real visitors. Keep a bounded, configurable capacity without evicting work.
export const DEFAULT_MAX_SESSIONS=12;
export function demoSessionCapacity(value=DEFAULT_MAX_SESSIONS){
  if(!/^[1-9][0-9]*$/.test(String(value)))throw new Error('Invalid demo session capacity');
  const count=Number(value);
  if(count>24)throw new Error('Demo session capacity must not exceed 24');
  return count;
}

export function createDemoGateway({launch=launchSession,html,ttl=60*60*1000,maxSessions=DEFAULT_MAX_SESSIONS,clock=Date.now}={}){
  maxSessions=demoSessionCapacity(maxSessions);
  const sessions=new Map();let starting=0;let creations=[];
  function expire(){for(const[id,s]of sessions){if(s.expires<=clock()||s.child.exitCode!=null){s.child.kill();sessions.delete(id);}}}
  const timer=setInterval(expire,30_000).unref();
  const server=http.createServer(async(req,res)=>{
    function send(status,message){if(res.headersSent||res.destroyed)return;res.writeHead(status,{...HEADERS,'content-type':'application/json'});res.end(JSON.stringify({error:message}));}
    if(req.method==='GET'&&req.url==='/health'){expire();res.writeHead(200,{...HEADERS,'content-type':'application/json'});res.end(JSON.stringify({ok:true,mode:'isolated-demo',activeSessions:sessions.size,startingSessions:starting,maxSessions}));return;}
    if(![HOST,`${HOST}:443`].includes(req.headers.host))return send(400,'Invalid site address');
    if(!req.url.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))return send(400,'Invalid request target');
    if(req.headers.origin!==undefined&&req.headers.origin!==ORIGIN)return send(403,'Cross-origin request blocked');
    if(req.headers['sec-fetch-site']==='cross-site'&&req.method!=='GET')return send(403,'Cross-site request blocked');
    if(!['GET','POST','PUT','DELETE'].includes(req.method))return send(405,'Method not allowed');
    const path=new URL(req.url,ORIGIN).pathname;
    if(path.startsWith('/_prima_auth/'))return send(404,'Not found');
    expire();let id=sessionId(req),session=sessions.get(id);
    if(!session){
      if(req.method!=='GET'||!['/','/index.html'].includes(path))return send(401,'Demo session expired. Refresh the page to start a new temporary workspace.');
      creations=creations.filter(at=>at>clock()-60_000);
      if(sessions.size+starting>=maxSessions||creations.length>=12){
        res.setHeader('retry-after','60');
        return send(503,'The demo is busy. Please try again later.');
      }
      starting++;creations.push(clock());
      try{const process=await launch();id=randomBytes(32).toString('hex');session={...process,expires:clock()+ttl,requests:[]};sessions.set(id,session);}
      catch{return send(503,'Demo temporarily unavailable');}
      finally{starting--;}
      res.setHeader('set-cookie',`${COOKIE}=${id}; Path=/; Max-Age=${Math.floor(ttl/1000)}; Secure; HttpOnly; SameSite=Lax`);
    }
    session.requests=session.requests.filter(at=>at>clock()-60_000);
    if(session.requests.length>=180)return send(429,'Please slow down and try again in a minute.');
    session.requests.push(clock());
    if(req.method==='GET'&&['/','/index.html'].includes(path)){
      res.writeHead(200,{...HEADERS,'content-type':'text/html; charset=utf-8'});res.end(html);return;
    }
    const limit=2*1024*1024;
    if(Number(req.headers['content-length'])>limit){req.resume();return send(413,'Demo imports are limited to 2 MB.');}
    // Buffer only bounded request bodies. Login cookies and identity headers are
    // never passed to the temporary application.
    const chunks=[];let size=0;
    try{for await(const chunk of req){size+=chunk.length;if(size>limit){send(413,'Demo imports are limited to 2 MB.');return;}chunks.push(chunk);}}
    catch{return send(400,'Invalid request');}
    const headers={host:`127.0.0.1:${session.port}`,'content-length':String(size)};
    for(const name of ['content-type','x-sofer-token','accept'])if(req.headers[name]!==undefined)headers[name]=req.headers[name];
    if(req.headers.origin!==undefined)headers.origin=`http://127.0.0.1:${session.port}`;
    const upstream=http.request({hostname:'127.0.0.1',port:session.port,path:req.url,method:req.method,headers},r=>{
      const outgoing={...r.headers,...HEADERS};delete outgoing['set-cookie'];delete outgoing.connection;
      if(res.destroyed)return r.destroy();res.writeHead(r.statusCode,outgoing);r.pipe(res);
    });
    upstream.setTimeout(30_000,()=>upstream.destroy());
    upstream.on('error',()=>{if(!res.headersSent)send(502,'Temporary demo workspace unavailable. Refresh to try again.');else res.destroy();});
    res.on('close',()=>{if(!res.writableEnded)upstream.destroy();});
    upstream.end(Buffer.concat(chunks));
  });
  server.headersTimeout=10_000;server.requestTimeout=35_000;
  server.on('close',()=>{clearInterval(timer);for(const s of sessions.values())s.child.kill();sessions.clear();});
  return server;
}

export function demoHtml(original){
  return original.replace('<title>Sofer Studio — Sefer Torah layout planner</title>','<title>Sofer Studio Demo — Temporary workspace</title>')
    .replace('</head>',`<style>.demo-notice{background:#e7f2e8;color:#163b2b;padding:10px 16px;font:13px/1.45 system-ui;display:flex;gap:12px;justify-content:space-between;flex-wrap:wrap;border-bottom:1px solid #779783}.demo-notice a{color:#163b2b}.demo-notice strong{font-weight:750}</style></head>`)
    .replace('<body>',`<body><aside class="demo-notice" role="note"><span><strong>Sofer Studio · No-login demo</strong> — Separate temporary workspace for this browser. Expires after one hour or a restart. Export anything you want to keep; do not upload private documents.</span><a href="/_prima_auth/login?next=%2F">Saved workspace sign-in</a></aside>`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const html=demoHtml(readFileSync('/app/sofer-studio/public/index.html','utf8'));
  const server=createDemoGateway({html,maxSessions:demoSessionCapacity(process.env.SOFER_DEMO_MAX_SESSIONS)});server.listen(8080,'0.0.0.0',()=>console.log('Isolated Sofer demo ready'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();setTimeout(()=>process.exit(0),1500).unref();});
}
