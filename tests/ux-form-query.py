import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/'data/family.json').read_text())
HTML=re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT/'family-tree.html').read_text())
ASSETS=['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']
with tempfile.TemporaryDirectory(prefix='ux56-') as temp:
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
      page.evaluate("""() => { Object.defineProperty(crypto,'randomUUID',{value:()=>String(Date.now())+'-0000-4000-8000-000000000001',configurable:true}); window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})} }""")
      for a in ASSETS: page.add_script_tag(content=(ROOT/'assets'/a).read_text())
      page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length===n',arg=len(DEMO['people']))
      page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")
      # Add form: untouched closes directly
      page.locator('#add-member').click(); assert page.locator('#member-dialog').is_visible()
      page.locator('#cancel-member').click(); assert page.locator('#member-dialog').is_hidden(); assert page.locator('#unsaved-changes-dialog').is_hidden()
      # Add form: dirty prompts, keep preserves, discard closes
      page.locator('#add-member').click(); page.locator('#member-name').fill('尚未儲存的人')
      page.locator('#cancel-member').click(); assert page.locator('#member-dialog').is_visible(); assert page.locator('#unsaved-changes-dialog').is_visible()
      page.locator('#keep-editing-member').click(); assert page.locator('#member-name').input_value()=='尚未儲存的人'; assert page.locator('#member-dialog').is_visible()
      page.locator('#close-member-dialog').click(); assert page.locator('#unsaved-changes-dialog').is_visible(); page.locator('#discard-member-changes').click(); assert page.locator('#member-dialog').is_hidden()
      # Edit form: Escape is guarded
      page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
      panel=page.locator('#relationship-details')
      if panel.get_attribute('data-collapsed')=='true': panel.locator('.relationship-details__tab').click()
      panel.locator('.edit-member').click(); original=page.locator('#member-location').input_value(); page.locator('#member-location').fill(original+'測試')
      page.keyboard.press('Escape'); assert page.locator('#unsaved-changes-dialog').is_visible(); assert page.locator('#member-dialog').is_visible()
      page.locator('#keep-editing-member').click(); assert page.locator('#member-location').input_value()==original+'測試'
      page.keyboard.press('Escape'); page.locator('#discard-member-changes').click(); assert page.locator('#member-dialog').is_hidden()
      # Relationship shortcut from details.
      page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
      if panel.get_attribute('data-collapsed')=='true': panel.locator('.relationship-details__tab').click()
      query=panel.locator('.query-relationship'); assert query.is_visible(); assert '陳建國' in query.get_attribute('aria-label')
      header_metrics=panel.locator('.relationship-details__header').evaluate("el=>({cw:el.clientWidth,sw:el.scrollWidth,w:el.getBoundingClientRect().width})")
      assert header_metrics['sw'] <= header_metrics['cw']+1, (name,header_metrics)
      title_metrics=panel.locator('#relationship-details-title').evaluate("el=>({h:el.clientHeight,sh:el.scrollHeight,whiteSpace:getComputedStyle(el).whiteSpace,textOverflow:getComputedStyle(el).textOverflow})")
      if mobile:
        assert title_metrics['whiteSpace']=='nowrap', (name,title_metrics)
        assert title_metrics['sh'] <= title_metrics['h']+1, (name,title_metrics)
        assert title_metrics['textOverflow']=='ellipsis', (name,title_metrics)
      query.click(); page.wait_for_timeout(50)
      assert page.locator('#relationship-a').input_value()==''; assert page.locator('#relationship-b').input_value()=='p11'
      is_land=page.evaluate("matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)').matches")
      if mobile:
        assert page.locator('.relationship-sheet').is_visible(), (name,is_land)
        page.locator('#relationship-sheet-close').click()
      else:
        assert page.locator('.relationship-sheet').is_hidden()
        # A's custom trigger should be the focused entry point.
        focused=page.evaluate("document.activeElement?.className || ''")
        assert 'select-trigger' in focused, (name,focused)
      assert not errors, errors
      print(name,'PASS',header_metrics,'landscapeMedia=',is_land)
      ctx.close()
    with sync_playwright() as p:
      b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
      try:
        load(b,'desktop',{'width':1440,'height':900},False)
        load(b,'portrait',{'width':390,'height':844},True)
        load(b,'landscape',{'width':844,'height':390},True)
      finally:b.close()
  finally:
    server.terminate();
    try:server.communicate(timeout=5)
    except subprocess.TimeoutExpired: server.kill();server.communicate()
