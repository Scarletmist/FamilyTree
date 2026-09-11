import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/'data/family.json').read_text())
HTML=re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT/'family-tree.html').read_text())
ASSETS=['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']

with tempfile.TemporaryDirectory(prefix='ux125-') as temp:
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
        const store=new Map();
        Object.defineProperty(window,'sessionStorage',{configurable:true,value:{
          getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()
        }});
        window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})};
      }""")
      for a in ASSETS: page.add_script_tag(content=(ROOT/'assets'/a).read_text())
      page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length>=n',arg=len(DEMO['people']))
      page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")

      # Compact relationship cards: p11 has many relations, all pre-existing cards start collapsed.
      page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
      panel=page.locator('#relationship-details')
      if panel.get_attribute('data-collapsed')=='true': panel.locator('.relationship-details__tab').click()
      panel.locator('.edit-member').click()
      rows=page.locator('#member-relations .relation-row'); count=rows.count(); assert count>=8,(name,count)
      collapsed=page.locator('#member-relations .relation-row__editor[hidden]').count(); assert collapsed==count,(name,count,collapsed)
      height=page.locator('#member-form .form-scroll').evaluate('el=>({scroll:el.scrollHeight,client:el.clientHeight})')
      first=rows.nth(0); first.locator('.relation-row__toggle').click(); assert first.locator('.relation-row__editor').is_visible()
      first.locator('.relation-row__toggle').click(); assert first.locator('.relation-row__editor').is_hidden()
      page.locator('#cancel-member').click(); assert page.locator('#member-dialog').is_hidden()

      # Relationship-detail navigation history: relative -> back returns to p11.
      page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
      if panel.get_attribute('data-collapsed')=='true': panel.locator('.relationship-details__tab').click()
      relative=panel.locator('.relationship-entry__person').first; target=relative.get_attribute('data-person-id'); relative.click()
      page.wait_for_function('(id)=>document.querySelector("#relationship-details").dataset.memberId===id',arg=target)
      back=panel.locator('.details-back'); assert back.is_visible(); assert not back.is_disabled(); back.click()
      page.wait_for_function("document.querySelector('#relationship-details').dataset.memberId==='p11'")

      # Success feedback is a short-lived toast.
      page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
      if panel.get_attribute('data-collapsed')=='true': panel.locator('.relationship-details__tab').click()
      panel.locator('.edit-member').click(); notes=page.locator('#member-notes'); notes.fill(notes.input_value()+f' {name}Toast')
      page.locator('#save-member').click(); page.wait_for_function("!document.querySelector('#member-dialog').open")
      toast=page.locator('#save-status'); assert toast.is_visible(); assert toast.get_attribute('data-kind')=='success'
      assert toast.locator('.save-status__action').is_visible(),(name,'undo action missing')
      page.wait_for_timeout(6200); assert toast.is_hidden(),(name,'undo toast did not auto-dismiss')

      # Draft is persisted in the tab and offered when the same form is opened again.
      page.locator('#add-member').click(); page.locator('#member-name').fill(f'{name}未完成草稿'); page.wait_for_timeout(250)
      saved=page.evaluate("sessionStorage.getItem('family-tree:member-form-draft:v1')"); assert saved and f'{name}未完成草稿' in saved,(name,saved)
      # Simulate an interrupted dialog lifecycle without choosing discard.
      page.evaluate("document.querySelector('#member-dialog').close()")
      page.locator('#add-member').click(); assert page.locator('#member-draft-dialog').is_visible(),name
      page.locator('#resume-member-draft').click(); assert page.locator('#member-name').input_value()==f'{name}未完成草稿'
      page.locator('#cancel-member').click(); assert page.locator('#unsaved-changes-dialog').is_visible(); page.locator('#discard-member-changes').click()
      assert page.evaluate("sessionStorage.getItem('family-tree:member-form-draft:v1')") is None

      assert not errors,errors
      print(name,'PASS',{'relations':count,'formScrollHeight':height['scroll'],'formViewport':height['client']})
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
    except subprocess.TimeoutExpired: server.kill();server.communicate()
