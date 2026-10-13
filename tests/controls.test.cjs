'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const C=require('../ucb-core.js'),P=require('../controls-core.js');
const sample=()=>Object.fromEntries(C.KEYS.map(k=>[k,({callId:'1001',workOrder:'00001001',aircraft:'DEMO-01',status:'Accept',remarks:'EXAMPLE ONLY.'})[k]||'']));
async function command(){const now=Date.now();return {id:crypto.randomUUID(),session:crypto.randomUUID(),type:'accept',
 callId:'1001',workOrder:'00001001',aircraft:'DEMO-01',fingerprint:await P.rowFingerprint(sample()),issuedAt:now,expiresAt:now+P.TTL};}
test('control code round trips as a random 256-bit secret',async()=>{
 const code=P.generateCode();assert.equal(code.length,43);assert.equal(P.code(code),code);assert.throws(()=>P.code('123456'));
 assert.equal((await P.keyId(code)).length,43);assert.notEqual(await P.keyId(code),await P.keyId(P.generateCode()));
});
test('valid Accept command has a bounded lifetime and exact schema',async()=>{
 const c=await command();assert.equal(P.validateCommand(c,c.session),c);
 for(const override of [{type:'execute'},{callId:'1;alert(1)'},{session:crypto.randomUUID()},{workOrder:5},{selector:'button'},
   {expiresAt:c.issuedAt+60000},{issuedAt:c.issuedAt+60000,expiresAt:c.expiresAt+60000}])
  assert.throws(()=>P.validateCommand({...c,...override},c.session));
 assert.throws(()=>P.validateCommand(c,c.session,c.expiresAt),/expired/);
});
test('a viewing key cannot decrypt or authenticate a control command',async()=>{
 const key=await P.importKey(P.generateCode()),view=await C.importKey(C.makeCode()),c=await command();
 const envelope=await P.seal(c,key,'command',c.session);assert.deepEqual(await P.open(envelope,key,'command',c.session),c);
 await assert.rejects(P.open(envelope,view,'command',c.session));
});
test('session and direction are authenticated; results cannot be replayed as commands',async()=>{
 const key=await P.importKey(P.generateCode()),c=await command(),text=await P.seal(c,key,'command',c.session);
 await assert.rejects(P.open(text,key,'result',c.session));await assert.rejects(P.open(text,key,'command',crypto.randomUUID()));
 const value=JSON.parse(text);value.data=(value.data[0]==='A'?'B':'A')+value.data.slice(1);
 await assert.rejects(P.open(JSON.stringify(value),key,'command',c.session));
});
test('control envelopes use fresh nonces and contain no readable request fields',async()=>{
 const key=await P.importKey(P.generateCode()),c=await command();
 const first=await P.seal(c,key,'command',c.session),second=await P.seal(c,key,'command',c.session);
 assert.notEqual(first,second);assert.equal(first.includes('DEMO-01'),false);
});
test('fingerprints bind all twelve report fields, including remarks and owner',async()=>{
 const row=sample(),base=await P.rowFingerprint(row);
 for(const k of C.KEYS)assert.notEqual(base,await P.rowFingerprint({...row,[k]:row[k]+'x'}),k);
});
test('status/info validation rejects invalid session and arbitrary result phases',()=>{
 const info={format:P.FORMAT,enabled:true,ready:true,busy:false,actor:'EXAMPLE EXAMINER',reason:'',
 session:crypto.randomUUID(),keyId:'A'.repeat(43),expiresAt:Date.now()+10000,visibleCallIds:['1001']};
 assert.equal(P.validateInfo(info),info);assert.throws(()=>P.validateInfo({...info,session:'arbitrary'}));
 assert.throws(()=>P.validateInfo({...info,visibleCallIds:['bad']}));
 assert.throws(()=>P.validateResult({session:info.session,commandId:crypto.randomUUID(),callId:'1001',phase:'pretend-success',message:''},info.session));
 assert.equal(P.terminal('verifying'),false);assert.equal(P.terminal('uncertain'),true);
});
test('control messages reject oversized data and unsupported contexts',async()=>{
 const key=await P.importKey(P.generateCode()),session=crypto.randomUUID();
 await assert.rejects(P.seal({data:'x'.repeat(21000)},key,'command',session));
 await assert.rejects(P.open('x'.repeat(31000),key,'command',session));
 await assert.rejects(P.seal({},key,'unknown',session));
});
test('standalone optional control bundle parses and contains no executable network response loader',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../console-controls.js'),'utf8');new vm.Script(source);
 assert.equal(/\beval\s*\(|new Function\s*\(/.test(source),false);
 assert.ok(source.includes('afterAccept:2000,afterReturn:1000'));
});
