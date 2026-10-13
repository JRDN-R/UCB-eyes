"""Offline viewer control UI tests with synthetic Firebase callbacks. No live writes."""
from browser_checks import offline_page, ROOT
import json
from playwright.sync_api import sync_playwright
VIEWER_MOCK=r"""async()=>{
 window.mock={listeners:{},docs:{},writes:[]};
 mock.snap=name=>({exists:()=>!!mock.docs[name],data:()=>mock.docs[name],metadata:{fromCache:false,hasPendingWrites:false}});
 mock.emit=(name,data)=>{mock.docs[name]=data;for(const f of mock.listeners[name]||[])f(mock.snap(name));};
 mock.fs={doc:(_,a,b)=>a+'/'+b,onSnapshot:(ref,options,callback,error)=>{
   (mock.listeners[ref] ||= []).push(callback);queueMicrotask(()=>callback(mock.snap(ref)));
   return ()=>mock.listeners[ref]=mock.listeners[ref].filter(f=>f!==callback);
 },setDoc:async(ref,data)=>{mock.writes.push({ref,data});},serverTimestamp:()=>({test:true})};
 const P=UcbControlCore,C=UcbEyesCore;
 window.testBoard=new UcbEyesBoard();window.testControls=new ViewerControls(testBoard);
 mock.viewKey=await C.importKey(C.makeCode());
 mock.row=Object.fromEntries(C.KEYS.map(k=>[k,({status:'Accept',callId:'1001',workOrder:'00001001',aircraft:'DEMO-01',remarks:'EXAMPLE ONLY. Selectable text.'})[k]||'']));
 testBoard.set(C.snapshot([mock.row],'rpc'));
 await testControls.start({fs:mock.fs,db:{}},mock.viewKey);
 mock.controlCode=P.generateCode();await testControls.prepare(mock.controlCode);testControls.received(Date.now());
 mock.info={format:P.FORMAT,enabled:true,ready:true,busy:false,actor:'EXAMPLE EXAMINER',reason:'',session:crypto.randomUUID(),keyId:await P.keyId(mock.controlCode),expiresAt:Date.now()+100000,visibleCallIds:['1001']};
 mock.updateInfo=async()=>mock.emit('live_capture/control_info',{data:await P.seal(mock.info,mock.viewKey,'info'),updatedAt:{toMillis:()=>Date.now()}});
 await mock.updateInfo();
}"""
def checks(browser):
    html=(ROOT/'index.html').read_text();c,p=offline_page(browser,html);p.set_viewport_size({'width':390,'height':844})
    p.add_style_tag(content=(ROOT/'styles.css').read_text())
    for name in ['ucb-core.js','controls-core.js','board.js']:
        p.add_script_tag(content=(ROOT/name).read_text())
    script=(ROOT/'viewer-controls.js').read_text().replace("import './controls-core.js';",'').replace('export class ViewerControls','window.ViewerControls = class ViewerControls')
    p.add_script_tag(content=script);p.evaluate(VIEWER_MOCK)
    p.wait_for_function("!document.querySelector('.accept-call').disabled")
    results=['approved separate control code enables only eligible Accept buttons']
    assert p.evaluate('document.documentElement.scrollWidth<=window.innerWidth')
    results.append('390-pixel portrait layout has no horizontal overflow')
    p.locator('.accept-call').click();assert p.locator('#acceptDialog').is_visible()
    assert '00001001' in p.locator('#acceptSummary').inner_text()
    p.locator('#confirmAccept').click();p.wait_for_function('mock.writes.length===1')
    r=p.evaluate("async()=>{const w=mock.writes[0];return UcbControlCore.open(w.data.data,testControls.key,'command',mock.info.session);}")
    assert r['callId']=='1001' and r['type']=='accept' and r['workOrder']=='00001001',r
    assert p.locator('.accept-call').is_disabled()
    results.append('confirmation produces one call-bound encrypted command and disables duplicate submission')
    p.evaluate("""async()=>{const command=await UcbControlCore.open(mock.writes[0].data.data,testControls.key,'command',mock.info.session);mock.emit('live_capture/control_result_'+mock.info.session,{data:await UcbControlCore.seal({session:mock.info.session,commandId:command.id,callId:'1001',phase:'succeeded',message:'UCB confirmed Inwork under EXAMPLE EXAMINER.'},testControls.key,'result',mock.info.session),updatedAt:{toMillis:()=>Date.now()}});}""")
    p.wait_for_function('testControls.pending===null')
    assert 'UCB confirmed Inwork' in p.locator('#actionNotice').inner_text()
    results.append('matching authenticated result clears pending and reports UCB confirmation')
    p.evaluate("testControls.infoReceipt=Date.now()-20000;testControls.render()")
    assert p.locator('.accept-call').is_disabled()
    results.append('stale bridge disables acceptance while retaining the report')
    p.evaluate("testControls.infoReceipt=Date.now();testControls.info.keyId='A'.repeat(43);testControls.render()")
    assert p.locator('.accept-call').is_disabled()
    results.append('a different control code cannot use an existing approval')
    p.locator('#settingsDialog').evaluate('(el)=>el.showModal()')
    p.screenshot(path=str(ROOT.parent/'UCB-Eyes-Control-Setup-Preview.png'),full_page=True)
    c.close();return results
if __name__=='__main__':
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        passed=checks(browser);print(json.dumps({'group':'viewer','passed':len(passed),'checks':passed},indent=2));browser.close()
