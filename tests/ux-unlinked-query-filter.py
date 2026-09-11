import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/'data/family.json').read_text())
UNLINKED_ID='ux-unlinked-member'
DEMO['people'].append({'id':UNLINKED_ID,'name':'未設定關係測試','gender':'U','location':'','position':'','siblingOrder':None,'discipleOrder':None,'notes':'','relationships':[]})
HTML=re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT/'family-tree.html').read_text())
ASSETS=['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']

with tempfile.TemporaryDirectory(prefix='ux-unlinked-query-') as temp:
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

    def run_layout(browser,name,viewport,mobile=False):
      ctx=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
      page=ctx.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
      page.expose_binding('familyRequest',bridge); page.set_content(HTML,wait_until='load')
      page.evaluate("""() => {
        Object.defineProperty(crypto,'randomUUID',{value:()=>String(Date.now())+'-0000-4000-8000-000000000001',configurable:true});
        window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})};
      }""")
      for a in ASSETS: page.add_script_tag(content=(ROOT/'assets'/a).read_text())
      page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length===n',arg=len(DEMO['people']))
      page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")
      page.wait_for_timeout(180)
      try:
        linked=page.evaluate("[...FamilyModel.relationshipMemberIds(FAMILY.people)]")
        assert UNLINKED_ID not in linked,(name,'unlinked helper')
        inverse_only=page.evaluate("FAMILY.people.find(p=>FamilyModel.relationshipMemberIds(FAMILY.people).has(p.id)&&p.relationships.length===0)?.id")
        assert inverse_only,(name,'need inverse-only fixture')

        # Detail query shortcut is unavailable only for truly unlinked members.
        page.evaluate("id=>window.selectFamilyMember(id,{expandDetails:true})",UNLINKED_ID)
        page.wait_for_timeout(80)
        assert page.locator('#relationship-details .query-relationship').count()==0,(name,'unlinked query shortcut visible')
        assert page.locator('#relationship-details .details-query-placeholder').count()==1,(name,'query placeholder missing')
        page.evaluate("id=>window.selectFamilyMember(id,{expandDetails:true})",inverse_only)
        page.wait_for_timeout(80)
        assert page.locator('#relationship-details .query-relationship').count()==1,(name,'inverse-only related shortcut missing')

        # Both query selectors contain only members with at least one recorded relation.
        for selector in ['#relationship-a','#relationship-b']:
          values=page.locator(selector+' option').evaluate_all("opts=>opts.map(o=>o.value).filter(Boolean)")
          assert UNLINKED_ID not in values,(name,selector,'unlinked option present')
          assert inverse_only in values,(name,selector,'inverse-only option missing')
          assert set(values)==set(linked),(name,selector,'option set differs from relationshipMemberIds')

        print(name,'PASS',{'queryOptions':len(linked),'unlinked':UNLINKED_ID,'inverseOnly':inverse_only})
        assert not errors,errors
      finally: ctx.close()

    with sync_playwright() as p:
      b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
      try:
        run_layout(b,'desktop',{'width':1440,'height':900},False)
        run_layout(b,'portrait',{'width':390,'height':844},True)
        run_layout(b,'landscape',{'width':844,'height':390},True)
      finally:b.close()
  finally:
    server.terminate()
    try:server.communicate(timeout=5)
    except subprocess.TimeoutExpired:server.kill();server.communicate()
