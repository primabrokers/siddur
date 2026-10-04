// Run inside a disposable release-image container, never against the live
// gateway. Closing this gateway destroys only this check's temporary work.
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createDemoGateway} from './gateway.mjs';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync(new URL('../../public/version.json',import.meta.url),'utf8')).version;

const server=createDemoGateway({html:'<html>Sofer capacity check</html>'});
server.listen(0,'127.0.0.1');await once(server,'listening');
function request(path='/',cookie,body,token){
  return new Promise((resolve,reject)=>{
    const bytes=body?JSON.stringify(body):undefined;
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:body?'POST':'GET',headers:{host:'sofer.primainsurance.tech',...(cookie?{cookie}:{}),...(body?{'content-type':'application/json','content-length':Buffer.byteLength(bytes),'x-sofer-token':token,origin:'https://sofer.primainsurance.tech'}:{})}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]?.split(';')[0],text}));
    });
    req.on('error',reject);req.end(bytes);
  });
}
try{
  const cookies=[],tokens=[];
  for(let i=0;i<12;i++){
    const result=await request();assert.equal(result.status,200,'workspace '+(i+1));cookies.push(result.cookie);
    const session=await request('/api/session',result.cookie);assert.equal(session.status,200);
    const token=JSON.parse(session.text).token;assert.ok(token);tokens.push(token);
    const health=await request('/api/health',result.cookie);assert.equal(health.status,200);assert.equal(JSON.parse(health.text).version,version);
  }
  assert.equal(new Set(cookies).size,12);assert.equal(new Set(tokens).size,12);
  assert.equal((await request()).status,503);
  const created=await request('/api/profiles',cookies[0],{name:'Disposable capacity verification'},tokens[0]);assert.equal(created.status,200);
  const id=JSON.parse(created.text).id;assert.ok(id);
  assert.equal((await request('/api/profiles/'+id,cookies[0])).status,200);
  assert.equal((await request('/api/profiles/'+id,cookies[1])).status,404,'a second workspace must not see the first workspace data');
  assert.equal((await request('/api/profiles',cookies[1],{name:'Forbidden cross-session mutation'},tokens[0])).status,401);
  for(const cookie of cookies)assert.equal((await request('/api/health',cookie)).status,200);
  const health=JSON.parse((await request('/health')).text);
  assert.equal(health.activeSessions,12);assert.equal(health.maxSessions,12);
  console.log(JSON.stringify({ok:true,realWorkspaces:12,version,fourthVisitorAllowed:true,workspaceDataIsolated:true,mutationTokensIsolated:true,existingWorkAccessibleAtCapacity:true}));
}finally{
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}
