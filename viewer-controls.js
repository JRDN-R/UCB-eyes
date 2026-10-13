import './controls-core.js';
const P=globalThis.UcbControlCore;
const $=id=>document.getElementById(id);
const KEY='ucb-eyes-control-code-v1',PENDING='ucb-eyes-control-pending-v1';
export class ViewerControls {
  constructor(board) {
    this.board=board;this.generation=0;this.info=null;this.pending=null;this.result=null;this.infoReceipt=0;this.reportReceipt=0;
    this.secret='';this.key=null;this.keyId='';this.error='';this.infoStamp=0;
    try{const saved=sessionStorage.getItem(KEY);if(saved)void this.prepare(saved);this.pending=JSON.parse(sessionStorage.getItem(PENDING)||'null');}catch{}
    $('generateControl').addEventListener('click',()=>this.prepare(P.generateCode()).catch(e=>globalThis.ucbToast(e.message)));
    $('copyControl').addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(this.secret);globalThis.ucbToast('Private CONTROL code copied. Paste it only into your source computer’s approval prompt.');}
      catch{$('controlCode').type='text';$('controlCode').focus();$('controlCode').select();}
    });
    $('clearPending').addEventListener('click',()=>{
      if(!window.confirm('First disable controls on the source PC and check the call in UCB.\n\nHave you done that? Clearing this message does NOT undo or cancel a click.'))return;
      this.pending=null;this.savePending();this.render();
    });
    $('confirmAccept').addEventListener('click',()=>void this.submit());
    $('cancelAccept').addEventListener('click',()=>$('acceptDialog').close());
    board.onRender=()=>this.render();
    this.healthTimer=setInterval(()=>this.render(),1000);
  }
  async prepare(secret) {
    if(this.pending)throw new Error('Resolve the pending request before changing the control code.');
    this.secret=P.code(secret);this.key=await P.importKey(secret);this.keyId=await P.keyId(secret);
    try{sessionStorage.setItem(KEY,secret);}catch{}
    $('controlCode').value=secret;$('controlCode').type='password';$('controlCodeWrap').hidden=false;
    $('generateControl').textContent='Create a new control code';
    this.result=null;
    if(this.services && this.viewKey)await this.start(this.services,this.viewKey);
    this.render();
  }
  savePending(){try{if(this.pending)sessionStorage.setItem(PENDING,JSON.stringify(this.pending));else sessionStorage.removeItem(PENDING);}catch{}}
  stop() {
    ++this.generation;this.offInfo?.();this.offResult?.();this.offInfo=null;this.offResult=null;
    this.info=null;this.infoReceipt=0;this.infoStamp=0;this.reportReceipt=0;this.error='';this.resultSession='';
    this.services=null;this.viewKey=null;this.render();
  }
  forget() {
    this.stop();this.key=null;this.secret='';this.keyId='';this.pending=null;this.result=null;
    try{sessionStorage.removeItem(KEY);sessionStorage.removeItem(PENDING);}catch{}
    $('controlCode').value='';$('controlCodeWrap').hidden=true;$('generateControl').textContent='Create control code';
    this.render();
  }
  received(time) {this.reportReceipt=time;this.render();}
  async start(services,viewKey) {
    this.stop();this.services=services;this.viewKey=viewKey;
    const gen=this.generation,{fs,db}=services;
    this.offInfo=fs.onSnapshot(fs.doc(db,'live_capture','control_info'),{includeMetadataChanges:true},async snap=>{
      if(gen!==this.generation || snap.metadata.fromCache || snap.metadata.hasPendingWrites)return;
      if(!snap.exists()){this.info=null;this.render();return;}
      const stamp=snap.data().updatedAt?.toMillis?.();
      if(!Number.isFinite(stamp)||stamp<=this.infoStamp)return;
      try{
        const info=P.validateInfo(await P.open(snap.data().data,viewKey,'info'));
        if(gen!==this.generation||stamp<=this.infoStamp)return;
        this.info=info;this.infoStamp=stamp;this.infoReceipt=Date.now();this.error='';
        if(info.enabled && this.key && info.keyId===this.keyId && this.resultSession!==info.session)this.watchResult(info.session,gen);
        if(this.pending && info.enabled && this.pending.session!==info.session)
          this.error='The source control session changed. Check the pending call in UCB before clearing it.';
        this.render();
      }catch{if(gen===this.generation){this.error='The control connection could not be verified. The report remains read-only.';this.render();}}
    },()=>{if(gen===this.generation){this.error='Controls are unavailable. Check the optional bridge and Firebase control-document permissions.';this.render();}});
  }
  watchResult(session,gen) {
    const {fs,db}=this.services;this.offResult?.();this.resultSession=session;let lastStamp=0;
    this.offResult=fs.onSnapshot(fs.doc(db,'live_capture','control_result_'+session),{includeMetadataChanges:true},async snap=>{
      if(gen!==this.generation||this.resultSession!==session||!snap.exists()||snap.metadata.fromCache||snap.metadata.hasPendingWrites)return;
      const stamp=snap.data().updatedAt?.toMillis?.();if(!Number.isFinite(stamp)||stamp<=lastStamp)return;
      try{
        const result=P.validateResult(await P.open(snap.data().data,this.key,'result',session),session);
        if(gen!==this.generation||this.resultSession!==session||stamp<=lastStamp)return;lastStamp=stamp;
        if(this.pending && result.commandId!==this.pending.id)return;
        this.result=result;
        if(this.pending?.id===result.commandId && P.terminal(result.phase)){this.pending=null;this.savePending();}
        this.render();
      }catch{if(gen===this.generation){this.error='Could not authenticate the action result. Check the source computer; do not retry blindly.';this.render();}}
    },()=>{if(gen===this.generation){this.error='Action confirmation is unavailable. Check the source computer before retrying.';this.render();}});
  }
  get busy(){return Boolean(this.pending || this.info?.busy);}
  readiness() {
    const i=this.info;
    if(this.error)return this.error;
    if(!this.secret)return 'Create a separate control code, then approve it on the source computer.';
    if(!i?.enabled)return 'Controls are off. Approve this control code in the source Console.';
    if(i.keyId!==this.keyId)return 'The source has approved a different control code.';
    if(Date.now()>=i.expiresAt)return 'Source control approval expired. Approve it again on the source computer.';
    if(!navigator.onLine)return 'This device is offline.';
    if(Date.now()-this.infoReceipt>12000 || Date.now()-this.infoStamp>12000)return 'The control bridge is not responding.';
    if(this.pending)return 'A request is still pending. Do not submit it again.';
    if(i.busy)return 'The source is processing a call.';
    if(!i.ready)return i.reason||'The source is not ready.';
    if(!this.reportReceipt || Date.now()-this.reportReceipt>8000)return 'Waiting for a fresh report.';
    return '';
  }
  render() {
    const reason=this.readiness(),i=this.info;
    if($('controlState'))$('controlState').textContent=reason||('Ready. Calls will be accepted as '+i.actor+'.');
    for(const [id,node] of this.board.nodes) {
      const row=node.__row,wrap=node.querySelector('.call-actions'),button=node.querySelector('.accept-call');
      if(!wrap||!button)continue;
      wrap.hidden=row.status!=='Accept';
      let note=reason;
      if(!note&&!i.visibleCallIds.includes(id))note='Open this call’s page on the source PC first.';
      if(!note && row.examiner && row.examiner.toUpperCase().trim()!==i.actor.toUpperCase().trim())note='Assigned to another examiner.';
      button.disabled=Boolean(note);
      const buttonText=this.pending?.callId===id?'Processing…':'Accept call';
      if(button.textContent!==buttonText)button.textContent=buttonText;
      node.querySelector('.action-note').textContent=note;
      if(!button.__bound){button.__bound=true;button.addEventListener('click',()=>this.confirm(id));}
    }
    const result=this.result,pending=this.pending;
    let text='';
    if(pending)text=(result?.commandId===pending.id?result.message:'Request sent. Waiting for the source computer.')+
      (Date.now()-pending.sentAt>45000?' No confirmation yet. Check UCB before retrying.':'');
    else if(result)text='Call '+result.callId+': '+result.message;
    $('actionNotice').textContent=text;$('actionNotice').hidden=!text;
    $('clearPending').hidden=!pending || Date.now()-pending.sentAt<45000;
    $('generateControl').disabled=Boolean(pending);
    $('confirmAccept').disabled=Boolean(reason);
  }
  async confirm(id) {
    const reason=this.readiness();if(reason)return globalThis.ucbToast(reason);
    const row=this.board.nodes.get(id)?.__row;if(!row||row.status!=='Accept')return;
    this.selected={...row};this.selectedSession=this.info.session;
    $('acceptSummary').textContent=row.aircraft+' · WO '+row.workOrder+' · Call '+row.callId;
    $('acceptActor').textContent='Accept as '+this.info.actor+' using the signed-in UCB source computer?';
    $('acceptDialog').showModal();
  }
  async submit() {
    const reason=this.readiness();if(reason)return globalThis.ucbToast(reason);
    const row=this.selected,info=this.info;
    if(!row || this.selectedSession!==info.session)return globalThis.ucbToast('The control session changed. Review and confirm again.');
    if(row.status!=='Accept'||!info.visibleCallIds.includes(row.callId))return;
    $('confirmAccept').disabled=true;
    // Set a synchronous UI lock before hashing to prevent two rapid confirmations.
    if(this.submitting)return;this.submitting=true;
    try{
      const fingerprint=await P.rowFingerprint(row);
      if(this.readiness() || this.info.session!==info.session)throw new Error('The source is no longer ready. Review the call again.');
      const issuedAt=Date.now(),command={id:crypto.randomUUID(),session:info.session,type:'accept',callId:row.callId,
        workOrder:row.workOrder,aircraft:row.aircraft,fingerprint,issuedAt,expiresAt:issuedAt+P.TTL};
      P.validateCommand(command,info.session);
      const data=await P.seal(command,this.key,'command',info.session);
      if(this.readiness() || this.info.session!==info.session)throw new Error('The source changed before sending.');
      this.pending={id:command.id,callId:command.callId,session:command.session,sentAt:issuedAt};
      this.result=null;this.savePending();$('acceptDialog').close();this.render();
      const {fs,db}=this.services;
      // Do not retry writes or create another command on an ambiguous acknowledgement.
      let timer;
      try{await Promise.race([fs.setDoc(fs.doc(db,'live_capture','control_request_'+info.session),
        {data,updatedAt:fs.serverTimestamp()}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('No write confirmation yet. Check the source before retrying.')),15000);})]);}
      finally{clearTimeout(timer);}
    }catch(error){globalThis.ucbToast(error.message||'Request not confirmed. Check the source computer.');}
    finally{this.submitting=false;this.render();}
  }
}
