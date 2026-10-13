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
