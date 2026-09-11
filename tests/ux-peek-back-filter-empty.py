import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/'data/family.json').read_text())
DEMO=json.loads(json.dumps(DEMO))
DEMO['people'].append({'id':'ux-unlinked','name':'待整理成員','gender':'U','location':'測試地','position':'','siblingOrder':None,'relationships':[]})
HTML=re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT/'family-tree.html').read_text())
ASSETS=['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']

with tempfile.TemporaryDirectory(prefix='ux4679-') as temp:
  data=Path(temp)/'family.json'; data.write_text(json.dumps(DEMO,ensure_ascii=False,indent=2)+'\n')
  server=subprocess.Popen(['node','-e',"const {createFamilyServer}=require(process.argv[1]);const s=createFamilyServer({dataFile:process.argv[2]});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));",str(ROOT/'server.cjs'),str(data)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  try:
    port=int(server.stdout.readline().strip()); base=f'http://127.0.0.1:{port}'
    def request(route,method='GET',body=None):
      req=urllib.request.Request(base+'/'+route.lstrip('/'),data=json.dumps(body).encode() if body is not None else None,headers={'Origin':base,'Content-Type':'application/json'},method=method)
      try:
        with urllib.request.urlopen(req,timeout=10) as r:return {'status':r.status,'payload':json.loads(r.read())}
      except urllib.error.HTTPError as e:return {'status':e.code,'payload':json.loads(e.read())}
    def bridge(_,opts):return request(opts['url'],opts.get('method','GET'),json.loads(opts['body']) if opts.get('body') else None)
    def load(browser,name,viewport,mobile=False):
      ctx=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
      page=ctx.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
      page.expose_binding('familyRequest',bridge); page.set_content(HTML,wait_until='load')
      page.evaluate("""() => {
        Object.defineProperty(crypto,'randomUUID',{value:()=>String(Date.now())+'-0000-4000-8000-000000000001',configurable:true});
        const store=new Map(); Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()}});
        window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})};
      }""")
      for a in ASSETS: page.add_script_tag(content=(ROOT/'assets'/a).read_text())
      page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length===n',arg=len(DEMO['people']))
      page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")

      # 7. Member status filter works together with the member list in every layout.
      page.locator('#show-member-list').click(); page.wait_for_function("document.querySelector('#member-list-dialog').open")
      unlinked_filter=page.locator('[data-member-filter="unlinked"]'); assert unlinked_filter.is_visible(); unlinked_filter.click()
      page.wait_for_function("document.querySelectorAll('#member-list-body tr').length===1")
      assert page.locator('#member-list-body tr').first.get_attribute('data-person-id')=='ux-unlinked',(name,'filter target')
      assert unlinked_filter.get_attribute('aria-pressed')=='true'
      page.locator('[data-member-filter="all"]').click(); assert page.locator('#member-list-body tr').count()==len(DEMO['people'])
      page.locator('#close-member-list').click()

      if mobile:
        # 6. Browser/system Back routes through the same unsaved-change protection as Esc/X.
        page.locator('#add-member').click(); page.wait_for_function("document.querySelector('#member-dialog').open")
        page.locator('#member-name').fill('Back保護測試')
        page.evaluate('history.back()'); page.wait_for_function("document.querySelector('#unsaved-changes-dialog').open")
        assert page.locator('#member-dialog').is_visible(),(name,'member form should remain under unsaved dialog')
        page.locator('#discard-member-changes').click(); page.wait_for_function("!document.querySelector('#member-dialog').open")
        page.wait_for_function("history.state && history.state.__familyTreeMobileGuard === true")

      if name=='portrait':
        # 4. Portrait selection opens a useful peek rather than a near-empty 50px tab.
        page.evaluate("window.selectFamilyMember('p11')")
        panel=page.locator('#relationship-details'); page.wait_for_function("document.querySelector('#relationship-details').dataset.collapsed==='true'")
        summary=panel.locator('.relationship-details__tab-summary'); assert summary.is_visible(); assert summary.inner_text().strip()
        metrics=panel.evaluate("el=>({height:el.getBoundingClientRect().height,summary:getComputedStyle(el.querySelector('.relationship-details__tab-summary')).display})")
        assert 65 <= metrics['height'] <= 100,(name,metrics)
        panel.locator('.relationship-details__tab').click(); assert panel.get_attribute('data-collapsed')=='false'

      # 9. Empty state exposes the three primary ways to continue.
      page.evaluate("""() => {
        window.FAMILY={schemaVersion:2,people:[]};
        window.__emptySyncCalls=0;
        window.FamilyGoogleDriveSync={syncNow:async()=>{window.__emptySyncCalls++;return {outcome:'needs-auth'}}};
        window.renderFamilyTree();
      }""")
      empty=page.locator('.tree-empty-state'); assert empty.is_visible(),name
      buttons=empty.locator('button'); labels=[buttons.nth(i).inner_text() for i in range(buttons.count())]
      assert labels==['從 Google Drive 同步','新增第一位成員','匯入族譜'],(name,labels)
      buttons.nth(0).click(); page.wait_for_function('window.__emptySyncCalls===1')
      assert not errors,errors
      print(name,'PASS',{'emptyActions':labels})
      ctx.close()
    with sync_playwright() as p:
      b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
      try:
        load(b,'desktop',{'width':1440,'height':900},False)
        load(b,'portrait',{'width':390,'height':844},True)
        load(b,'landscape',{'width':844,'height':390},True)
      finally:b.close()
  finally:
    server.terminate()
    try:server.communicate(timeout=5)
    except subprocess.TimeoutExpired:server.kill();server.communicate()
