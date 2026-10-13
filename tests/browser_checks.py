"""Offline Chromium checks. All records and network replies are synthetic. No live writes.
Run: python tests/browser_checks.py [flow|agent]
"""
import json, sys, time, re, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def serve(route):
    from urllib.parse import urlparse, unquote
    path=unquote(urlparse(route.request.url).path).lstrip('/') or 'index.html'
    target=(ROOT/path).resolve()
    if not target.is_relative_to(ROOT) or not target.is_file():
        return route.fulfill(status=404,body='Not found')
    content='text/html' if target.suffix=='.html' else 'text/css' if target.suffix=='.css' else 'text/javascript'
    route.fulfill(status=200,content_type=content,body=target.read_text())
def offline_page(browser, html):
    context=browser.new_context();page=context.new_page()
    # This environment blocks navigation. Exercise DOM entirely in about:blank.
    # Native Web Crypto is separately tested by Node; browser plumbing uses Python AES-GCM.
    def crypto_call(kind, key, iv, data, aad):
        data=bytes(data)
        if kind=='digest': return list(hashlib.sha256(data).digest())
        cipher=AESGCM(bytes(key))
        return list(cipher.encrypt(bytes(iv), data, bytes(aad)) if kind=='encrypt' else cipher.decrypt(bytes(iv), data, bytes(aad)))
    page.expose_function('__testCrypto',crypto_call)
    page.set_content(re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',html))
    page.add_script_tag(content=r"""
      crypto.randomUUID=()=>{const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=[...a].map(n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
      const arr=x=>Array.from(new Uint8Array(x.buffer||x));
      Object.defineProperty(crypto,'subtle',{value:{
        digest:async(_,data)=>new Uint8Array(await __testCrypto('digest',[],[],arr(data),[])).buffer,
        importKey:async(_,data)=>({testKey:arr(data)}),
        encrypt:async(p,k,data)=>new Uint8Array(await __testCrypto('encrypt',k.testKey,arr(p.iv),arr(data),arr(p.additionalData))).buffer,
        decrypt:async(p,k,data)=>new Uint8Array(await __testCrypto('decrypt',k.testKey,arr(p.iv),arr(data),arr(p.additionalData))).buffer
      }});
    """)
    return context,page

def fixture(browser):
    html=(ROOT/'tests/flow-fixture.html').read_text()
    context,page=offline_page(browser,html)
    for script in ['ucb-core.js','controls-core.js','ucb-click-flow.js']:
        page.add_script_tag(content=(ROOT/script).read_text())
    scripts=re.findall(r'<script>([\s\S]*?)</script>',html)
    for script in scripts:page.add_script_tag(content=script)
    return context,page

def flow_checks(browser):
    results=[]
    c,p=fixture(browser)
    r=p.evaluate('fixture.run()');assert r['ok'],r
    clicks=r['clicks'];assert [x[0] for x in clicks]==['accept','return','continue'],r
    assert clicks[1][1]-clicks[0][1]>=1990 and clicks[2][1]-clicks[1][1]>=990,r
    results.append('exact sequence, minimum delays, and verified result');c.close()
    c,p=fixture(browser);p.evaluate('fixture.delayed=2200');r=p.evaluate('fixture.run()');assert r['ok'],r
    results.append('slower source pages wait for correct buttons');c.close()
    c,p=fixture(browser);p.evaluate('fixture.wrong=true');r=p.evaluate('fixture.run()');assert not r['ok'] and len(r['clicks'])==1 and r['didClick'],r
    results.append('wrong detail Call ID blocks Return and Continue');c.close()
    c,p=fixture(browser);p.evaluate('fixture.noContinue=true');r=p.evaluate('fixture.run({timeoutMs:500})');assert not r['ok'] and [x[0] for x in r['clicks']]==['accept','return'],r
    results.append('missing Continue stops without more clicks');c.close()
    c,p=fixture(browser);r=p.evaluate("fixture.run({command:{fingerprint:'A'.repeat(43)}})");assert not r['ok'] and not r['clicks'] and not r['didClick'],r
    results.append('stale row fingerprint blocks first click');c.close()
    c,p=fixture(browser);p.evaluate("fixture.rows[0].examiner='ANOTHER EXAMINER'");r=p.evaluate('fixture.run()');assert not r['ok'] and not r['clicks'],r
    results.append('another examiner blocks acceptance');c.close()
    c,p=fixture(browser);p.evaluate('fixture.noVerify=true');r=p.evaluate('fixture.run()');assert not r['ok'] and len(r['clicks'])==3 and r['didClick'],r
    results.append('unconfirmed status never reports success');c.close()
    c,p=fixture(browser);r=p.evaluate('''async()=>{const abort=new AbortController();setTimeout(()=>abort.abort(),500);return fixture.run({signal:abort.signal});}''');assert not r['ok'] and len(r['clicks'])==1,r
    results.append('abort after Accept prevents later buttons');c.close()
    return results

AGENT_MOCK=r'''async()=>{
 window.confirm=()=>true;
 const viewing=UcbEyesCore.makeCode();window.__UCB_EYES__={running:true,pairingCode:viewing,status:()=>({mode:'rpc'}),sendNow:()=>{}};
 window.user={userId:'SYNTHETIC_USER_ID',firstName:'Example',lastName:'Examiner'};
 window.keycloak={authenticated:true,token:'SYNTHETIC_UCB_TOKEN'};
 window.mock={docs:{},network:[],controlCode:UcbControlCore.generateCode()};
 UcbEyesCore.parseReport=()=>({rows:fixture.rows.map(r=>({...r})),total:fixture.rows.length});
 window.fetch=async(url,options={})=>{
  mock.network.push({url:String(url),options});
  if(String(url).includes('/Ucb/ucbGwtRpcServices/'))return new Response('//OK synthetic');
  if(String(url).includes('accounts:signUp'))return Response.json({idToken:'SYNTHETIC_FIREBASE_TOKEN',refreshToken:'SYNTHETIC_REFRESH',expiresIn:3600});
  if(String(url).endsWith(':commit')){
   const v=JSON.parse(options.body);const now=new Date().toISOString();
   for(const w of v.writes)mock.docs[w.update.name]={fields:w.update.fields,updateTime:now};
   return Response.json({writeResults:v.writes.map(()=>({updateTime:now}))});
  }
  const name=String(url).split('/v1/')[1];return mock.docs[name]?Response.json(mock.docs[name]):new Response('',{status:404});
 };
 mock.info=async()=>UcbControlCore.open(mock.docs['projects/ucb-eyes/databases/(default)/documents/live_capture/control_info'].fields.data.stringValue,await UcbEyesCore.importKey(viewing),'info');
 mock.send=async(options={})=>{const info=await mock.info(),command=await fixture.command();command.session=info.session;Object.assign(command,options);
  mock.command=command;
  mock.docs['projects/ucb-eyes/databases/(default)/documents/live_capture/control_request_'+info.session]={fields:{data:{stringValue:await UcbControlCore.seal(command,await UcbControlCore.importKey(mock.controlCode),'command',info.session)}},updateTime:crypto.randomUUID()};return command.id;};
 mock.result=async()=>{const info=await mock.info(),r=mock.docs['projects/ucb-eyes/databases/(default)/documents/live_capture/control_result_'+info.session];return r?UcbControlCore.open(r.fields.data.stringValue,await UcbControlCore.importKey(mock.controlCode),'result',info.session):null;};
}'''
def wait_result(page,phase,timeout=20):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        result=page.evaluate('mock.result()')
        if result and result['phase']==phase:return result
        page.wait_for_timeout(150)
    raise AssertionError({'expected':phase,'last':result,'console':page.evaluate('__UCB_EYES_CONTROLS__.status()')})
def agent_checks(browser):
    results=[];c,p=fixture(browser);p.evaluate(AGENT_MOCK)
    p.evaluate(r"""code=>{let shim;shim=new Proxy(window,{get(target,key){if(key==='top')return shim;if(key==='location')return {origin:'https://synthetic-ucb.test',protocol:'https:'};const value=target[key];return ['addEventListener','removeEventListener'].includes(key)?value.bind(target):value;}});new Function('window',code)(shim);}""",(ROOT/'console-controls.js').read_text());p.wait_for_function('window.__UCB_EYES_CONTROLS__')
    p.wait_for_timeout(200)
    assert p.evaluate('__UCB_EYES_CONTROLS__.status().enabled') is False
    assert p.evaluate('fixture.clicks.length')==0
    results.append('installation stays off and sends no clicks')
    p.evaluate('__UCB_EYES_CONTROLS__.enable(mock.controlCode)');p.evaluate('mock.send()')
    wait_result(p,'succeeded');assert p.evaluate('fixture.clicks.map(x=>x[0])')==['accept','return','continue']
    results.append('source agent processes encrypted command and confirms all three clicks')
    p.evaluate('''async()=>{const info=await mock.info();mock.docs['projects/ucb-eyes/databases/(default)/documents/live_capture/control_request_'+info.session].updateTime=crypto.randomUUID();}''')
    p.wait_for_timeout(2000);assert p.evaluate('fixture.clicks.length')==3
    results.append('same command ID replay does not click again')
    cloud=p.evaluate("mock.network.filter(n=>!n.url.includes('/Ucb/')).map(n=>JSON.stringify(n)).join('')")
    assert 'SYNTHETIC_UCB_TOKEN' not in cloud and 'SYNTHETIC_USER_ID' not in cloud
    assert p.evaluate('mock.controlCode') not in cloud
    results.append('source credentials and control code never appear in cloud requests')
    p.evaluate('''async()=>{const n=Date.now()-60000;await mock.send({issuedAt:n,expiresAt:n+30000});}''')
    wait_result(p,'rejected');assert p.evaluate('fixture.clicks.length')==3
    results.append('expired authenticated commands reject without clicks')
    p.evaluate('__UCB_EYES_CONTROLS__.disable()');assert p.evaluate('__UCB_EYES_CONTROLS__.status().enabled') is False
    results.append('explicit disable immediately removes execution permission');c.close()
    return results

if __name__=='__main__':
    group=sys.argv[1] if len(sys.argv)>1 else 'flow'
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        checks=flow_checks(browser) if group=='flow' else agent_checks(browser)
        print(json.dumps({'group':group,'passed':len(checks),'checks':checks},indent=2));browser.close()
