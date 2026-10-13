/* OPTIONAL UCB Eyes controls. Paste in the SAME top Console AFTER the sender. */
/* OFF until explicitly approved. No HAR or source credentials are uploaded. */
(function () {
/* Authenticated control messages use a DIFFERENT random key from the viewing key. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UcbControlCore = api;
})(globalThis, function() {
  'use strict';
  const FORMAT = 'ucb-control-v1';
  const TTL = 30000;
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  function encode(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decode(text) {
    if (typeof text !== 'string' || !/^[\w-]+$/.test(text)) throw new Error('Invalid control data.');
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4-text.length%4)%4)), c=>c.charCodeAt(0));
  }
  function code(text) {
    text = String(text || '').trim();
    if (!/^[\w-]{43}$/.test(text) || decode(text).length !== 32 || encode(decode(text)) !== text)
      throw new Error('Paste the 43-character CONTROL code from UCB Eyes settings, not the viewing code.');
    return text;
  }
  const generateCode = () => encode(crypto.getRandomValues(new Uint8Array(32)));
  const importKey = text => crypto.subtle.importKey('raw', decode(code(text)), 'AES-GCM', false, ['encrypt','decrypt']);
  const digest = async text => encode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const keyId = text => digest('ucb-control-key|' + code(text));
  const rowFingerprint = row => digest(JSON.stringify(['status','callId','certifier','aircraft','workOrder','trade',
    'requestDate','planner','examiner','inWorkDate','responses','remarks'].map(k => row[k])));
  function context(kind, session) {
    if (!['info','command','result'].includes(kind) || (kind !== 'info' && !uuid(session))) throw new Error('Invalid control context.');
    return new TextEncoder().encode(FORMAT + '|' + kind + '|' + (session || 'current'));
  }
  async function seal(value, key, kind, session) {
    const plain = new TextEncoder().encode(JSON.stringify(value));
    if (plain.length > 20000) throw new Error('Control message is too large.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context(kind,session)}, key, plain);
    return JSON.stringify({format:FORMAT,iv:encode(iv),data:encode(encrypted)});
  }
  async function open(text, key, kind, session) {
    if (typeof text !== 'string' || text.length > 30000) throw new Error('Invalid control envelope.');
    const e=JSON.parse(text);
    if (e.format!==FORMAT || decode(e.iv).length!==12) throw new Error('Invalid control envelope.');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),additionalData:context(kind,session)},key,decode(e.data));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function validateCommand(value, session, now = Date.now()) {
    if (!value || Object.keys(value).sort().join(',') !== 'aircraft,callId,expiresAt,fingerprint,id,issuedAt,session,type,workOrder' ||
        value.type !== 'accept' || value.session !== session || !uuid(session) || !uuid(value.id) ||
        !/^\d{1,12}$/.test(value.callId) || typeof value.callId !== 'string' ||
        typeof value.workOrder !== 'string' || value.workOrder.length > 500 ||
        typeof value.aircraft !== 'string' || value.aircraft.length > 500 ||
        typeof value.fingerprint !== 'string' || !/^[\w-]{43}$/.test(value.fingerprint))
      throw new Error('Invalid or unsupported command. Only Accept is supported.');
    if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt - value.issuedAt !== TTL || value.issuedAt > now+5000 ||
        value.issuedAt < now-TTL || value.expiresAt <= now)
      throw new Error('This request expired or the device clock differs. Review the call and try again.');
    return value;
  }
  function validateInfo(v) {
    if (!v || v.format!==FORMAT || typeof v.enabled!=='boolean' || typeof v.ready!=='boolean' ||
        typeof v.busy!=='boolean' || typeof v.actor!=='string' || v.actor.length>200 ||
        typeof v.reason!=='string' || v.reason.length>500 || !Array.isArray(v.visibleCallIds) ||
        v.visibleCallIds.length>1000 || !v.visibleCallIds.every(id=>typeof id==='string' && /^\d{1,12}$/.test(id)))
      throw new Error('Invalid control status.');
    if (v.enabled && (!uuid(v.session) || typeof v.keyId!=='string' || !/^[\w-]{43}$/.test(v.keyId) ||
        !Number.isSafeInteger(v.expiresAt))) throw new Error('Invalid control authorization.');
    return v;
  }
  function validateResult(v, session) {
    if (!v || v.session!==session || !uuid(v.commandId) || typeof v.callId!=='string' || !/^\d{1,12}$/.test(v.callId) ||
        !['checking','accept','return','continue','verifying','succeeded','rejected','uncertain','cancelled'].includes(v.phase) ||
        typeof v.message!=='string' || v.message.length>1000) throw new Error('Invalid action result.');
    return v;
  }
  const terminal = phase => ['succeeded','rejected','uncertain','cancelled'].includes(phase);
  return {FORMAT,TTL,uuid,code,generateCode,importKey,keyId,rowFingerprint,seal,open,validateCommand,validateInfo,validateResult,terminal};
});

/* Only the supplied Accept -> Return -> Continue UI path. No direct write RPC. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UcbClickFlow = api;
})(globalThis, function() {
  'use strict';
  const flat = v => String(v || '').replace(/\s+/g,' ').trim();
  const person = v => flat(v).toUpperCase();
  function visible(el) {
    if (!el?.isConnected || !el.getClientRects().length || el.closest('[hidden],[aria-hidden="true"]')) return false;
    for(let n=el; n && n.nodeType===1; n=n.parentElement) {
      const s=n.ownerDocument.defaultView.getComputedStyle(n);
      if(s.display==='none' || s.visibility==='hidden' || s.visibility==='collapse' || s.opacity==='0') return false;
    }
    return true;
  }
  const enabled = el => visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true';
  function unique(items, description) {
    if(items.length>1) throw new Error('More than one '+description+' is visible. No click was sent.');
    return items[0] || null;
  }
  function findRow(doc, callId) {
    return unique([...doc.querySelectorAll('.ucb-report-table tbody tr[cst_row_index]')].filter(tr=>
      visible(tr) && flat(tr.querySelector('td[customindex="1"]')?.textContent)===callId), 'row for this Call ID');
  }
  function availableIds(doc) {
    return [...doc.querySelectorAll('.ucb-report-table tbody tr[cst_row_index]')].filter(visible)
      .filter(tr=>enabled(tr.querySelector('td[customindex="0"] span.staticlinkblue[usertext="Accept"]')))
      .map(tr=>flat(tr.querySelector('td[customindex="1"]')?.textContent)).filter(id=>/^\d{1,12}$/.test(id));
  }
  function toolbar(doc, labels) {
    return unique([...doc.querySelectorAll('div.tableBtns')].filter(visible).filter(bar=>{
      const actual=[...bar.querySelectorAll('button.gwt-Button')].filter(visible).map(b=>flat(b.textContent));
      return actual.length===labels.length && labels.every(label=>actual.filter(x=>x===label).length===1);
    }), labels.join(' / ')+' toolbar');
  }
  function button(bar, text) {
    return bar && unique([...bar.querySelectorAll('button.gwt-Button')].filter(b=>enabled(b)&&flat(b.textContent)===text),text+' button');
  }
  function detailCallId(doc) {
    const labels=[...doc.querySelectorAll('td.tblLeft')].filter(el=>visible(el)&&flat(el.textContent)==='Call ID:');
    const values=labels.map(el=>flat(el.nextElementSibling?.textContent));
    const ids=[...new Set(values)];
    return unique(ids, 'Call ID in the detail page');
  }
  async function run({doc,command,actor,core,protocol,readReport,guard,signal,onPhase=async()=>{},
    delays={afterAccept:2000,afterReturn:1000},timeoutMs=15000}) {
    let clicked=false, step='checking';
    const startDoc=doc;
    function check() {
      if(signal?.aborted) throw new Error('Stopped. Review this call in UCB before retrying.');
      guard();
      if(doc!==startDoc) throw new Error('The source document changed.');
      const error=[...doc.querySelectorAll('.errorAlertPanel,.ndms-UncaughtExceptionHandler')].find(visible);
      if(error) throw new Error('UCB displayed an error. Review it on the source computer.');
    }
    const wait=ms=>new Promise((resolve,reject)=>{
      if(signal?.aborted) return reject(new Error('Stopped.'));
      const timer=setTimeout(done,ms);
      const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(new Error('Stopped.'));};
      function done(){signal?.removeEventListener('abort',abort);resolve();}
      signal?.addEventListener('abort',abort,{once:true});
    });
    async function until(fn,description) {
      const end=Date.now()+timeoutMs;
      while(Date.now()<end){check();const value=fn();if(value)return value;await wait(100);}
      throw new Error('Timed out waiting for '+description+'. No further clicks were sent.');
    }
    async function phase(name) {step=name;await onPhase(name);check();}
    try {
      check();
      if(!core.reportContext(doc)) throw new Error('Open the JAX / TRAINERS E&E Outstanding report.');
      const latest=await readReport();check();
      const row=latest.rows.find(r=>r.callId===command.callId);
      if(!row || row.status!=='Accept') throw new Error('This call is no longer available to accept.');
      if(row.examiner && person(row.examiner)!==person(actor)) throw new Error('This call is assigned to another examiner.');
      if(row.workOrder!==command.workOrder || row.aircraft!==command.aircraft ||
          await protocol.rowFingerprint(row)!==command.fingerprint) throw new Error('The call changed. Review its latest details before accepting.');
      check();protocol.validateCommand(command,command.session); // Recheck expiry immediately before the first click.
      const tr=findRow(doc,command.callId);
      if(!tr || flat(tr.querySelector('td[customindex="4"]')?.textContent)!==row.workOrder ||
          flat(tr.querySelector('td[customindex="3"]')?.textContent)!==row.aircraft)
        throw new Error('This call is not on the current UCB page. Open its page on the source computer first.');
      let accept=unique([...tr.querySelectorAll('td[customindex="0"] span.staticlinkblue[usertext="Accept"]')]
        .filter(el=>enabled(el)&&flat(el.textContent)==='Accept'),'Accept link');
      if(!accept) throw new Error('The Accept link is not available.');
      await phase('accept');
      // Re-find by immutable Call ID after asynchronous work; never reuse a row index.
      const fresh=findRow(doc,command.callId);
      if(fresh!==tr || !enabled(accept)) throw new Error('The report redrew before Accept. Review and try again.');
      protocol.validateCommand(command,command.session);
      clicked=true;accept.click();
      await wait(delays.afterAccept);
      const details=await until(()=>{
        const bar=toolbar(doc,['Send To P&E','Request Part','View Responses','Add Response','Return']);
        if(!bar) return null;
        const id=detailCallId(doc);
        if(id && id!==command.callId) throw new Error('A different call opened. No Return or Continue was clicked.');
        return id===command.callId ? button(bar,'Return') : null;
      },'this call’s details and Return button');
      await phase('return');
      if(!enabled(details)||detailCallId(doc)!==command.callId) throw new Error('The detail page changed before Return.');
      details.click();
      await wait(delays.afterReturn);
      const next=await until(()=>{
        if(visible(details)) return null;
        return button(toolbar(doc,['Continue','Cancel']),'Continue');
      },'the Continue / Cancel page');
      await phase('continue');
      if(!enabled(next) || button(toolbar(doc,['Continue','Cancel']),'Continue')!==next)
        throw new Error('The Continue page changed.');
      next.click();
      await until(()=>core.reportContext(doc) && [...doc.querySelectorAll('.ucb-report-table thead th')]
        .some(el=>visible(el)&&flat(el.textContent)===core.TITLE),'the Outstanding report');
      await phase('verifying');
      for(let attempt=0;attempt<3;attempt++) {
        const snapshot=await readReport();check();
        const updated=snapshot.rows.find(r=>r.callId===command.callId);
        if(updated?.status==='Inwork' && person(updated.examiner)===person(actor) &&
            updated.workOrder===command.workOrder && updated.aircraft===command.aircraft)
          return {snapshot,row:updated};
        if(attempt<2) await wait(700);
      }
      throw new Error('The clicks finished, but UCB did not confirm Inwork under this signed-in examiner. Check UCB manually.');
    } catch(error) {
      error.didClick=clicked;error.step=step;throw error;
    }
  }
  return {visible,enabled,findRow,availableIds,toolbar,detailCallId,run};
});

/* Optional control bridge. Bundle: console-controls.js. Never starts a call on installation. */
(async function installControls() {
  'use strict';
  if(window!==window.top) throw new Error('Select top in the UCB Console.');
  const C=globalThis.UcbEyesCore,P=globalThis.UcbControlCore,F=globalThis.UcbClickFlow;
  if(!C||!P||!F) throw new Error('Run the UCB Eyes sender first, then paste the entire controls script.');
  // Allows Settings to copy the sender and this optional script together.
  for(let i=0;i<50 && !window.__UCB_EYES__?.running;i++) await new Promise(r=>setTimeout(r,100));
  const sender=window.__UCB_EYES__;
  if(!sender?.running) throw new Error('Start the normal UCB Eyes sender first.');
  window.__UCB_EYES_CONTROLS__?.stop();
  function findSource(win,seen=new Set()) {
    if(seen.has(win)||seen.size>=40)return null;seen.add(win);
    try{if(C.reportContext(win.document))return win;
      for(let i=0;i<win.frames.length;i++){const found=findSource(win.frames[i],seen);if(found)return found;}
    }catch{}return null;
  }
  const source=findSource(window);
  if(!source) throw new Error('Open JAX / TRAINERS / E&E / Outstanding before installing controls.');
  const doc=source.document,origin=source.location.origin;
  if(source.location.protocol!=='https:') throw new Error('An HTTPS source is required.');
  if(sender.status().mode!=='rpc') throw new Error('Controls require the verified RPC sender, not visible-page-only DOM mode.');
  const viewKey=await C.importKey(sender.pairingCode);
  const root='projects/ucb-eyes/databases/(default)/documents';
  const cloud='https://firestore.googleapis.com/v1/';
  const apiKey='AIzaSyCtz99nbMN9caeFRnSct6NeugepWQORqvM'; // Existing public web configuration.
  let running=true,enabled=false,busy=false,halted=false,timer,controlKey=null,controlId='',session='',expiresAt=0;
  let actor='',actorId='',token='',refreshToken='',tokenExpires=0,lastInfo='',lastInfoAt=0,lastMailbox='',lastError='';
  let activeAbort=null,pendingResult=null,phase='idle',authPromise=null,approvalGeneration=0;
  const seen=new Set(),requests=new Set();
  const flat=C.flat;
  const actorName=()=>flat(source.user?.firstName+' '+source.user?.lastName).toUpperCase();
  const docName=id=>root+'/live_capture/'+id;
  function guard(requireEnabled=true) {
    if(!running||window.__UCB_EYES__!==sender||!sender.running) throw new Error('The source sender stopped or restarted.');
    if(source.closed||source.document!==doc||source.location.origin!==origin) throw new Error('The source page changed.');
    if(!source.keycloak?.authenticated||!source.user?.userId) throw new Error('The source is signed out.');
    if(requireEnabled && (!enabled || Date.now()>=expiresAt || source.user.userId!==actorId || actorName()!==actor))
      throw new Error('Control approval expired, was disabled, or the signed-in examiner changed.');
  }
  async function request(url,options={},local=false) {
    if(!running)throw new Error('Controls stopped.');
    const target=new URL(url);
    if(target.protocol!=='https:' || (local ? target.origin!==origin :
      !['firestore.googleapis.com','identitytoolkit.googleapis.com','securetoken.googleapis.com'].includes(target.hostname)))
      throw new Error('Unapproved network destination.');
    const abort=new AbortController();requests.add(abort);
    const timeout=setTimeout(()=>abort.abort(),15000);
    try {
      const response=await (local?source.fetch.bind(source):window.fetch.bind(window))(url,{...options,signal:abort.signal,
        credentials:local?'same-origin':'omit',mode:local?'same-origin':'cors',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
      const text=await response.text();
      return {ok:response.ok,status:response.status,text,json:()=>JSON.parse(text)};
    } finally {clearTimeout(timeout);requests.delete(abort);}
  }
  async function authenticate() {
    if(token && Date.now()<tokenExpires-60000)return;
    if(authPromise)return authPromise;
    authPromise=(async()=>{
      const refresh=Boolean(refreshToken);
      const r=await request(refresh?`https://securetoken.googleapis.com/v1/token?key=${apiKey}`:
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,{method:'POST',headers:{
        'Content-Type':refresh?'application/x-www-form-urlencoded':'application/json'},body:refresh?
        new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken}).toString():JSON.stringify({returnSecureToken:true})});
      if(!r.ok)throw new Error('Controls Firebase sign-in failed (HTTP '+r.status+').');
      const v=r.json();token=v.idToken||v.id_token;refreshToken=v.refreshToken||v.refresh_token;
      tokenExpires=Date.now()+Number(v.expiresIn||v.expires_in||3600)*1000;
      if(!token||!refreshToken)throw new Error('Incomplete Firebase sign-in.');
    })().finally(()=>{authPromise=null;});return authPromise;
  }
  async function put(id,data) {
    await authenticate();
    const r=await request(cloud+root+':commit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({writes:[{update:{name:docName(id),fields:{data:{stringValue:data}}},
        updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]})});
    if(r.status===401)tokenExpires=0;
    if(!r.ok)throw new Error('Controls write failed (HTTP '+r.status+'). Check access to the control documents; do not loosen all database rules.');
  }
  async function get(id) {
    await authenticate();
    const r=await request(cloud+docName(id),{headers:{Authorization:'Bearer '+token}});
    if(r.status===404)return null;
    if(r.status===401)tokenExpires=0;
    if(!r.ok)throw new Error('Controls read failed (HTTP '+r.status+'). Check Firebase permissions.');
    return r.json();
  }
  async function readReport() {
    guard();
    if(!C.reportContext(doc))throw new Error('The source is not on the Outstanding report.');
    const rows=[],ids=new Set();let total=null;
    for(let offset=0,page=0;page<25;page++){
      guard();
      const r=await request(origin+'/Ucb/ucbGwtRpcServices/UcbReportService',{method:'POST',headers:{
        'Content-Type':'text/x-gwt-rpc; charset=UTF-8','X-GWT-Module-Base':origin+'/Ucb/ucb_call_response/',
        'X-GWT-Permutation':'5F3D96C6EB4F757767F1A4D73FF240A0',Authorization:'Bearer '+source.keycloak.token},
        body:C.reportBody(origin,offset,50)},true);
      if(!r.ok)throw new Error('UCB report verification failed (HTTP '+r.status+').');
      const result=C.parseReport(r.text);
      if(total!==null&&total!==result.total)throw new Error('The report changed while checking this call. Review and try again.');
      total=result.total;
      for(const row of result.rows){if(ids.has(row.callId))throw new Error('The report shifted while checking this call.');ids.add(row.callId);rows.push(row);}
      if(rows.length===total)return C.snapshot(rows,'rpc');
      if(!result.rows.length||rows.length>total)throw new Error('Incomplete source report.');offset+=result.rows.length;
    }throw new Error('Report page limit reached.');
  }
  function info() {
    let ready=false,reason='Remote controls are off.',ids=[];
    if(enabled){
      try {guard();if(halted)reason='Check the source screen, then run __UCB_EYES_CONTROLS__.resume().';
        else if(busy)reason='Processing a selected call.';
        else if(!C.reportContext(doc))reason='Return the source computer to the Outstanding report.';
        else {ids=F.availableIds(doc);ready=true;reason='';}
      }catch(error){reason=error.message;ready=false;}
    }
    return P.validateInfo({format:P.FORMAT,enabled,ready,busy,reason,actor,session,keyId:controlId,expiresAt,visibleCallIds:ids});
  }
  async function publishInfo(force=false) {
    const value=info(),fingerprint=JSON.stringify(value);
    if(!force && fingerprint===lastInfo && Date.now()-lastInfoAt<5000)return;
    await put('control_info',await P.seal(value,viewKey,'info'));
    lastInfo=fingerprint;lastInfoAt=Date.now();
  }
  async function publishResult(required=false) {
    if(!pendingResult)return;
    const job=pendingResult;
    try {await put('control_result_'+job.session,await P.seal(job.value,job.key,'result',job.session));
      if(pendingResult===job)pendingResult=null;
    }catch(error){if(required)throw error;console.warn('[UCB controls] Action status could not be uploaded. UCB may still have changed.');}
  }
  async function setResult(command,next,message,required=false) {
    phase=next;
    pendingResult={key:controlKey,session:command.session,value:{session:command.session,commandId:command.id,
      callId:command.callId,phase:next,message,actor,at:Date.now()}};
    await publishResult(required);
  }
  async function execute(command) {
    busy=true;activeAbort=new AbortController();
    const abort=activeAbort;
    const manual=event=>{if(event.isTrusted){halted=true;abort.abort();}};
    doc.addEventListener('pointerdown',manual,true);doc.addEventListener('keydown',manual,true);
    let claimed=false;
    try {
      guard();
      await setResult(command,'checking','Checking the latest call in UCB.',true);claimed=true;
      await publishInfo(true);
      const labels={accept:'Accepting this call in UCB.',return:'Returning from the call details.',
        continue:'Continuing back to the report.',verifying:'Checking the resulting UCB status.'};
      await F.run({doc,command,actor,core:C,protocol:P,readReport,guard,signal:abort.signal,
        onPhase:name=>setResult(command,name,labels[name])});
      await setResult(command,'succeeded','UCB confirmed Inwork under '+actor+'.');
      sender.sendNow();
    } catch(error) {
      const uncertain=Boolean(error.didClick);
      if(uncertain || abort.signal.aborted)halted=true;
      // An interrupted write workflow is NEVER retried automatically.
      await setResult(command,uncertain?'uncertain':abort.signal.aborted?'cancelled':'rejected',
        (uncertain?'A click may already have changed UCB. ':'')+(error.message||'Action stopped.'));
      console.warn('[UCB controls] '+(claimed?'':'No action was started. ')+(error.message||'Stopped.'));
    } finally {
      busy=false;activeAbort=null;
      doc.removeEventListener('pointerdown',manual,true);doc.removeEventListener('keydown',manual,true);
      if(running){await publishInfo(true).catch(()=>{});sender.sendNow();}
    }
  }
  async function pollCommand() {
    guard();if(busy||halted)return;
    const remote=await get('control_request_'+session);
    if(!remote || remote.updateTime===lastMailbox)return;
    lastMailbox=remote.updateTime;
    let command;
    try{command=await P.open(remote.fields?.data?.stringValue,controlKey,'command',session);P.validateCommand(command,session);}
    catch(error){
      // Only a correctly authenticated, structurally valid request gets an expiry response.
      try{P.validateCommand(command,session,command.issuedAt);guard();
        if(!seen.has(command.id) && seen.size<2000){seen.add(command.id);await setResult(command,'rejected','This request expired or the device clock differs. No click was sent.');}
      }catch{}
      console.warn('[UCB controls] Ignored an invalid, expired or unauthenticated request.');return;
    }
    guard();if(seen.has(command.id))return;
    if(seen.size>=2000){halted=true;throw new Error('Control session action limit reached. Approve a new session.');}
    seen.add(command.id); // Consume BEFORE any asynchronous source read or click. Never evict within this session.
    await execute(command);
  }
  async function tick() {
    if(!running)return;
    try{
      if(window.__UCB_EYES__!==sender||!sender.running){stop();return;}
      if(enabled){try{guard();}catch{enabled=false;activeAbort?.abort();}}
      await publishResult();
      await publishInfo();
      if(enabled)await pollCommand();
      lastError='';
    }catch(error){if(error.message!==lastError)console.warn('[UCB controls] '+error.message);lastError=error.message;}
    finally{if(running)timer=setTimeout(tick,lastError?4000:1500);}
  }
  async function enable(input) {
    if(busy)throw new Error('Wait for the current action or approval to finish.');
    const myApproval=++approvalGeneration;
    guard(false);
    if(!C.reportContext(doc))throw new Error('Open the Outstanding report first.');
    const entered=input===undefined?window.prompt('Paste the CONTROL code from UCB Eyes → Settings → Accept calls.\nThis is separate from your viewing code.'):input;
    if(entered===null)return;
    const text=P.code(entered);
    if(text===sender.pairingCode)throw new Error('Do not reuse the viewing key. Generate a separate control code in phone settings.');
    const name=actorName(),identity=source.user.userId;
    if(!source.user?.firstName||!source.user?.lastName)throw new Error('Cannot verify the signed-in examiner.');
    if(!window.confirm('Enable remote Accept controls for '+name+'?\n\nOnly individually confirmed calls can run: Accept → wait 2 seconds → Return → wait 1 second → Continue.\n\nApproval lasts up to 8 hours or until this session changes. Use only with authorization for remote writes and this destination.'))return;
    const nextKey=await P.importKey(text),nextId=await P.keyId(text);
    guard(false);
    if(myApproval!==approvalGeneration)throw new Error('Control approval was cancelled.');
    if(source.user.userId!==identity || actorName()!==name)throw new Error('The signed-in examiner changed during approval.');
    controlKey=nextKey;controlId=nextId;actor=name;actorId=source.user.userId;session=crypto.randomUUID();
    expiresAt=Date.now()+8*60*60*1000;seen.clear();lastMailbox='';enabled=true;halted=false;phase='idle';
    try{await publishInfo(true);}catch(error){enabled=false;throw error;}
    console.info('[UCB controls] Enabled for '+name+'. Keep the control code private. Stop immediately: __UCB_EYES_CONTROLS__.disable()');
  }
  function disable() {
    ++approvalGeneration;enabled=false;activeAbort?.abort();phase=busy?'stopping':'off';
    if(running)void publishInfo(true).catch(()=>{});
    console.info('[UCB controls] Disabled. A click already sent cannot be undone; review any interrupted call in UCB.');
  }
  function stop() {
    ++approvalGeneration;enabled=false;running=false;activeAbort?.abort();clearTimeout(timer);for(const r of requests)r.abort();
    window.removeEventListener('pagehide',stop);source.removeEventListener('pagehide',stop);
    token='';refreshToken='';
  }
  async function resume() {
    guard();if(busy)throw new Error('An action is still running.');
    if(!C.reportContext(doc))throw new Error('Return to the Outstanding report manually first.');
    if(!window.confirm('Have you checked the interrupted call in UCB?\nResume controls without replaying the previous command?'))return;
    halted=false;await publishInfo(true);
  }
  window.__UCB_EYES_CONTROLS__={enable,disable,stop,resume,status:()=>({running,enabled,busy,halted,phase,actor,
    expiresAt:expiresAt?new Date(expiresAt).toLocaleString():null,error:lastError})};
  window.addEventListener('pagehide',stop,{once:true});source.addEventListener('pagehide',stop,{once:true});
  console.info('[UCB controls] Installed, OFF by default. Copy the control code from phone settings, then run __UCB_EYES_CONTROLS__.enable()');
  void tick();
})().catch(error=>console.error('[UCB controls] '+error.message));

})();
