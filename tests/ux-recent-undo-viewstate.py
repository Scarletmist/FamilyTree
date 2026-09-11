import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
DEMO=json.loads((ROOT/'data/family.json').read_text())
HTML=re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT/'family-tree.html').read_text())
ASSETS=['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']

with tempfile.TemporaryDirectory(prefix='ux81011-') as temp:
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

    def page_with_app(browser,viewport,mobile=False,session_seed=None,local_seed=None):
      ctx=browser.new_context(viewport=viewport,is_mobile=mobile,has_touch=mobile,device_scale_factor=1)
      page=ctx.new_page(); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
      page.expose_binding('familyRequest',bridge); page.set_content(HTML,wait_until='load')
      seed=json.dumps(session_seed or {},ensure_ascii=False); local=json.dumps(local_seed or {},ensure_ascii=False)
      page.evaluate("""({seed,local}) => {
        Object.defineProperty(crypto,'randomUUID',{value:()=>String(Date.now())+'-0000-4000-8000-000000000001',configurable:true});
        const sessionStore=new Map(Object.entries(seed));
        const localStore=new Map(Object.entries(local));
        Object.defineProperty(window,'sessionStorage',{configurable:true,value:{getItem:k=>sessionStore.has(k)?sessionStore.get(k):null,setItem:(k,v)=>sessionStore.set(k,String(v)),removeItem:k=>sessionStore.delete(k),clear:()=>sessionStore.clear()}});
        Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>localStore.has(k)?localStore.get(k):null,setItem:(k,v)=>localStore.set(k,String(v)),removeItem:k=>localStore.delete(k),clear:()=>localStore.clear()}});
        window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})};
      }""",{'seed':json.loads(seed),'local':json.loads(local)})
      for a in ASSETS: page.add_script_tag(content=(ROOT/'assets'/a).read_text())
      page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length===n',arg=len(DEMO['people']))
      page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")
      page.wait_for_timeout(180)
      return ctx,page,errors

    def run_layout(browser,name,viewport,mobile=False):
      ctx,page,errors=page_with_app(browser,viewport,mobile)
      try:
        # 8. Recently viewed members appear above the full list, newest first, and hide while searching.
        page.evaluate("window.selectFamilyMember('p11',{expandDetails:true}); window.selectFamilyMember('p24',{expandDetails:true});")
        page.locator('#show-member-list').click(); page.wait_for_function("document.querySelector('#member-list-dialog').open")
        recent=page.locator('#member-list-recent'); assert recent.is_visible(),(name,'recent hidden')
        recent_buttons=recent.locator('.member-list-recent__item'); assert recent_buttons.count()>=2,(name,recent_buttons.count())
        expected24=page.evaluate("FAMILY.people.find(p=>p.id==='p24').name"); expected11=page.evaluate("FAMILY.people.find(p=>p.id==='p11').name")
        assert recent_buttons.nth(0).inner_text()==expected24,(name,'recent order')
        assert recent_buttons.nth(1).inner_text()==expected11,(name,'recent order second')
        page.locator('#member-list-search').fill('不存在的人'); assert recent.is_hidden(),(name,'recent should hide during search')
        page.locator('#member-list-search').fill(''); assert recent.is_visible()
        page.locator('#close-member-list').click()

        # 10. A saved member change exposes Undo, which restores the previous persisted dataset.
        original=page.evaluate("FAMILY.people.find(p=>p.id==='p11').location")
        page.evaluate("window.editFamilyMember('p11')"); page.wait_for_function("document.querySelector('#member-dialog').open")
        page.locator('#member-location').fill(f'{name}-Undo位置')
        page.locator('#save-member').click(); page.wait_for_function("!document.querySelector('#member-dialog').open")
        toast=page.locator('#save-status'); undo=toast.locator('.save-status__action')
        assert toast.is_visible() and undo.is_visible() and undo.inner_text()=='復原',(name,'undo toast')
        assert page.evaluate("FAMILY.people.find(p=>p.id==='p11').location")==f'{name}-Undo位置'
        undo.click(); page.wait_for_function('(value)=>FAMILY.people.find(p=>p.id==="p11").location===value',arg=original)
        assert '已復原' in toast.inner_text(),(name,toast.inner_text())

        # 11. Save a per-tab canvas scale / pan / family filter state.
        filter_select=page.locator('#family-filter')
        options=filter_select.locator('option').evaluate_all('(opts)=>opts.map(o=>o.value).filter(Boolean)')
        chosen=options[0] if options else ''
        if chosen:
          filter_select.select_option(chosen); page.wait_for_timeout(120)
        for _ in range(3): page.evaluate("document.querySelector('#tree-zoom-in').click()")
        page.evaluate("""() => { const v=document.querySelector('.tree'); v.scrollLeft=120; v.scrollTop=80; v.dispatchEvent(new Event('scroll')); }""")
        page.wait_for_timeout(300)
        saved_state=page.evaluate("JSON.parse(sessionStorage.getItem('family-tree:canvas-view:v1:'+location.pathname))")
        assert saved_state and saved_state['scale']>1,(name,saved_state)
        if chosen: assert saved_state['filter']==chosen,(name,saved_state)
        session_key=page.evaluate("'family-tree:canvas-view:v1:'+location.pathname")
      finally:
        assert not errors,errors
        ctx.close()

      # Simulate a reload/new document in the same tab session by pre-seeding sessionStorage.
      ctx2,page2,errors2=page_with_app(browser,viewport,mobile,{session_key:json.dumps(saved_state,ensure_ascii=False)})
      try:
        page2.wait_for_timeout(250)
        restored=page2.evaluate("""() => ({
          zoom:document.querySelector('#tree-zoom-value').textContent,
          filter:document.querySelector('#family-filter').value,
          left:document.querySelector('.tree').scrollLeft,
          top:document.querySelector('.tree').scrollTop
        })""")
        assert restored['zoom']==f"{round(saved_state['scale']*100)}%",(name,restored,saved_state)
        if saved_state['filter']: assert restored['filter']==saved_state['filter'],(name,restored,saved_state)
        assert abs(restored['left']-saved_state['scrollLeft'])<=3,(name,'scrollLeft',restored,saved_state)
        assert abs(restored['top']-saved_state['scrollTop'])<=3,(name,'scrollTop',restored,saved_state)
        assert not errors2,errors2
        print(name,'PASS',{'recent':[expected24,expected11],'undo':True,'viewState':saved_state})
      finally: ctx2.close()

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
