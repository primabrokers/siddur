import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {test} from 'node:test';
import {createDemoGateway, demoSessionCapacity, DEFAULT_MAX_SESSIONS} from '../deploy/demo/gateway.mjs';

const host='sofer.primainsurance.tech';
const html='<html><body>Sofer capacity regression</body></html>';
async function fixture(options={}){
  const children=[];
  let launches=0;
  const launch=async()=>{
    const id=++launches;
    if(options.beforeLaunch)await options.beforeLaunch(id);
    const upstream=http.createServer((req,res)=>{
      res.setHeader('content-type','application/json');
      res.setHeader('set-cookie','upstream_cookie=must-not-leak');
      res.end(JSON.stringify({id,headers:req.headers}));
    });
    upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
    const child={exitCode:null,kills:0,kill(){this.kills++;this.exitCode=0;upstream.closeAllConnections();upstream.close();}};
    children.push(child);
    return {port:upstream.address().port,child};
  };
  const server=createDemoGateway({...options,launch,html});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  function request(path='/',{cookie,headers={},method='GET'}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host,...(cookie?{cookie}:{}),...headers}},res=>{
        let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
        res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}));
      });
      req.on('error',reject);req.end();
    });
  }
  return {request,children,get launches(){return launches;},close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

await test('twelve isolated workspaces open; a fourth visitor is not blocked and full capacity preserves existing work',async()=>{
  const f=await fixture();
  try{
    const cookies=[];
    for(let i=0;i<DEFAULT_MAX_SESSIONS;i++){
      const result=await f.request();
      assert.equal(result.status,200,'visitor '+(i+1));
      assert.equal(result.body,html);
      assert.match(result.headers['set-cookie'][0],/; Path=\/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax$/);
      cookies.push(result.cookie);
    }
    assert.equal(cookies.length,12);assert.equal(new Set(cookies).size,12);
    const blocked=await f.request();assert.equal(blocked.status,503);assert.equal(blocked.headers['retry-after'],'60');
    const identities=[];
    for(const cookie of cookies){
      const result=await f.request('/api/health',{cookie});assert.equal(result.status,200);
      identities.push(JSON.parse(result.body).id);
      assert.equal((await f.request('/',{cookie})).status,200);
    }
    assert.equal(new Set(identities).size,12);assert.equal(f.launches,12);
    assert.ok(f.children.every(child=>child.kills===0),'active workspaces were not evicted');
  }finally{await f.close();}
});

await test('health, rejected requests, and assets without cookies never reserve a workspace',async()=>{
  const f=await fixture();
  try{
    const health=await f.request('/health');
    assert.deepEqual(JSON.parse(health.body),{ok:true,mode:'isolated-demo',activeSessions:0,startingSessions:0,maxSessions:12});
    assert.equal(health.cookie,undefined);
    assert.equal((await f.request('/api/session')).status,401);
    assert.equal((await f.request('/styles.css')).status,401);
    assert.equal((await f.request('/',{headers:{host:'example.com'}})).status,400);
    assert.equal((await f.request('/',{headers:{origin:'https://example.com'}})).status,403);
    assert.equal((await f.request('/',{method:'PATCH'})).status,405);
    assert.equal((await f.request('/_prima_auth/login')).status,404);
    assert.equal(f.launches,0);
  }finally{await f.close();}
});

await test('concurrent starts count toward the cap before child processes become ready',async()=>{
  let release;
  const gate=new Promise(resolve=>release=resolve);
  const f=await fixture({maxSessions:4,beforeLaunch:()=>gate});
  const pending=Array.from({length:4},()=>f.request());
  try{
    const deadline=Date.now()+3000;
    while(f.launches<4&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(f.launches,4);
    const health=JSON.parse((await f.request('/health')).body);
    assert.equal(health.startingSessions,4);assert.equal(health.activeSessions,0);
    assert.equal((await f.request()).status,503);
    release();assert.ok((await Promise.all(pending)).every(result=>result.status===200));
    assert.equal(f.launches,4);
  }finally{release();await Promise.allSettled(pending);await f.close();}
});

await test('a failed start releases its reservation and the next visitor can enter',async()=>{
  const f=await fixture({maxSessions:1,beforeLaunch:id=>{if(id===1)throw new Error('fixture failure');}});
  try{
    assert.equal((await f.request()).status,503);
    assert.equal(JSON.parse((await f.request('/health')).body).startingSessions,0);
    assert.equal((await f.request()).status,200);
  }finally{await f.close();}
});

await test('only expired workspaces are reclaimed, leaving newer workspace identity unchanged',async()=>{
  let now=100;
  const f=await fixture({maxSessions:2,ttl:1000,clock:()=>now});
  try{
    const first=await f.request();now=200;const second=await f.request();
    const identity=JSON.parse((await f.request('/api/session',{cookie:second.cookie})).body).id;
    now=1100;
    assert.equal((await f.request()).status,200);
    assert.equal(f.children[0].kills,1);assert.equal(f.children[1].kills,0);
    assert.equal(JSON.parse((await f.request('/api/session',{cookie:second.cookie})).body).id,identity);
    assert.equal((await f.request('/api/session',{cookie:first.cookie})).status,401);
  }finally{await f.close();}
});

await test('an exited child frees capacity without killing another workspace',async()=>{
  const f=await fixture({maxSessions:2});
  try{
    await f.request();const second=await f.request();f.children[0].exitCode=1;
    assert.equal((await f.request()).status,200);
    assert.equal((await f.request('/api/session',{cookie:second.cookie})).status,200);
    assert.equal(f.children[1].kills,0);
  }finally{await f.close();}
});

await test('session creation remains rate limited even when short-lived sessions expire',async()=>{
  let now=0;
  const f=await fixture({ttl:100,clock:()=>now});
  try{
    for(let i=0;i<12;i++){assert.equal((await f.request()).status,200);now+=200;}
    assert.equal((await f.request()).status,503);
    now=60_001;assert.equal((await f.request()).status,200);
  }finally{await f.close();}
});

await test('upstream still receives no sign-in cookies or identity headers',async()=>{
  const f=await fixture();
  try{
    const {cookie}=await f.request();
    const response=await f.request('/api/session',{cookie:cookie+'; private_auth=secret',headers:{origin:'https://'+host,'x-auth-user':'anthony','x-sofer-token':'fixture-token'}});
    assert.equal(response.status,200);assert.equal(response.headers['set-cookie'],undefined);
    const {headers}=JSON.parse(response.body);
    assert.equal(headers.cookie,undefined);assert.equal(headers['x-auth-user'],undefined);
    assert.equal(headers['x-sofer-token'],'fixture-token');assert.match(headers.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  }finally{await f.close();}
});

await test('capacity configuration accepts bounded integers and fails closed on invalid values',()=>{
  assert.equal(demoSessionCapacity(),12);assert.equal(demoSessionCapacity('12'),12);assert.equal(demoSessionCapacity(4),4);
  for(const value of ['',0,-1,1.5,'12abc','Infinity',25])assert.throws(()=>demoSessionCapacity(value));
});
