import json, re, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEMO = json.loads((ROOT / 'data/family.json').read_text())
HTML = re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT / 'family-tree.html').read_text())
ASSETS = ['family-model.js','relationship-details.js','generation-bands.js','kinship.js','relationship-search.js','connector-routing.js','label-layout.js','family-tree.js','family-storage.js','family-repository.js','member-form.js','member-tools.js','mobile-landscape-toolbar.js']

with tempfile.TemporaryDirectory(prefix='ux78-') as temp:
    data = Path(temp) / 'family.json'
    data.write_text(json.dumps(DEMO, ensure_ascii=False, indent=2) + '\n')
    server = subprocess.Popen(['node','-e',"const {createFamilyServer}=require(process.argv[1]);const s=createFamilyServer({dataFile:process.argv[2]});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));",str(ROOT/'server.cjs'),str(data)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        port = int(server.stdout.readline().strip()); base = f'http://127.0.0.1:{port}'
        def request(route, method='GET', body=None):
            req = urllib.request.Request(base + '/' + route.lstrip('/'), data=json.dumps(body).encode() if body is not None else None, headers={'Origin':base,'Content-Type':'application/json'}, method=method)
            try:
                with urllib.request.urlopen(req,timeout=10) as response: return {'status':response.status,'payload':json.loads(response.read())}
            except urllib.error.HTTPError as error: return {'status':error.code,'payload':json.loads(error.read())}
        def bridge(_, opts): return request(opts['url'],opts.get('method','GET'),json.loads(opts['body']) if opts.get('body') else None)
        def load(browser, name, viewport, mobile=False):
            ctx = browser.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile, device_scale_factor=1)
            page = ctx.new_page(); page.set_default_timeout(4000); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
            page.expose_binding('familyRequest', bridge); page.set_content(HTML, wait_until='load')
            page.evaluate("""() => { Object.defineProperty(crypto,'randomUUID',{value:()=>String(Date.now())+'-0000-4000-8000-000000000001',configurable:true}); window.fetch=async(url,options={})=>{const result=await window.familyRequest({url,method:options.method||'GET',body:options.body||null});return new Response(JSON.stringify(result.payload),{status:result.status,headers:{'Content-Type':'application/json'}})} }""")
            for asset in ASSETS: page.add_script_tag(content=(ROOT/'assets'/asset).read_text())
            page.wait_for_function('(n)=>window.FAMILY&&window.FAMILY.people.length===n', arg=len(DEMO['people']))
            page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")

            print(name, 'loaded', flush=True)
            fit = page.locator('#mobile-tree-fit')
            if mobile:
                assert fit.is_visible(), name
                page.locator('.tree').evaluate('(el)=>{el.scrollLeft=Math.min(700,el.scrollWidth-el.clientWidth);el.scrollTop=Math.min(350,el.scrollHeight-el.clientHeight)}')
                before = page.locator('#tree-canvas').evaluate("el=>({transform:getComputedStyle(el).transform,top:el.closest('.tree').scrollTop,left:el.closest('.tree').scrollLeft})")
                fit.click(); page.wait_for_timeout(50)
                after = page.locator('#tree-canvas').evaluate("el=>({transform:getComputedStyle(el).transform,top:el.closest('.tree').scrollTop,left:el.closest('.tree').scrollLeft})")
                assert after['top'] == 0, (name,before,after)
                assert after['transform'] != 'none', (name,before,after)
            else:
                assert fit.is_hidden(), name
                assert page.locator('#tree-zoom-controls').is_visible(), name

            print(name, 'fit PASS', flush=True)
            # Esc closes only the topmost layer: first modal, then underlying relationship details.
            page.evaluate("window.selectFamilyMember('p11',{expandDetails:true})")
            panel = page.locator('#relationship-details'); assert panel.is_visible(), name
            page.locator('#show-member-list').click(); assert page.locator('#member-list-dialog').is_visible(), name
            page.keyboard.press('Escape'); page.wait_for_timeout(50)
            assert page.locator('#member-list-dialog').is_hidden(), name
            assert panel.is_visible(), name
            page.keyboard.press('Escape'); page.wait_for_timeout(50)
            assert panel.is_hidden(), name
            assert page.locator('.person[aria-pressed="true"]').count() == 0, name

            print(name, 'escape layering PASS', flush=True)
            if mobile:
                # Relationship query sheet supports backdrop dismissal without changing the query state.
                def open_query():
                    if name == 'landscape':
                        page.locator('#landscape-more-open').click()
                        page.locator('#landscape-more-sheet [data-action="relationship"]').click()
                    else:
                        page.locator('#portrait-more-open').click()
                        page.locator('#landscape-more-sheet [data-action="relationship"]').click()
                open_query(); sheet = page.locator('.relationship-sheet'); assert sheet.is_visible(), name
                page.mouse.click(4, 4); page.wait_for_timeout(60)
                assert sheet.is_hidden(), name

                print(name, 'backdrop PASS', flush=True)
                # Activate a query and ensure blank Canvas taps do not cancel it.
                open_query()
                ids = page.locator('#relationship-a option').evaluate_all("els=>els.map(o=>o.value).filter(Boolean).slice(0,2)")
                assert len(ids) == 2, name
                for selector,value in [('#relationship-a',ids[0]),('#relationship-b',ids[1])]:
                    page.locator(selector).evaluate("(el,value)=>{el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}", value)
                page.locator('#relationship-search [type=submit]').click(force=True)
                page.wait_for_function("!document.querySelector('#relationship-summary').hidden")
                assert page.locator('#relationship-summary').is_visible(), name
                page.locator('.tree').click(position={'x':8,'y':8}, force=True); page.wait_for_timeout(50)
                assert page.locator('#relationship-summary').is_visible(), name

                print(name, 'active blank PASS', flush=True)
                # Complete path details are the topmost relationship UI and Escape closes them first.
                page.locator('.relationship-result-details').click(); result = page.locator('#relationship-result-sheet'); assert result.is_visible(), name
                page.keyboard.press('Escape'); page.wait_for_timeout(50)
                assert result.is_hidden(), name
                assert page.locator('#relationship-summary').is_visible(), name
                page.locator('.relationship-result-end').click()

            assert not errors, (name, errors)
            print(name, 'PASS')
            ctx.close()

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server'])
            try:
                load(browser,'desktop',{'width':1440,'height':900},False)
                load(browser,'portrait',{'width':390,'height':844},True)
                load(browser,'landscape',{'width':844,'height':390},True)
            finally: browser.close()
    finally:
        server.terminate()
        try: server.communicate(timeout=5)
        except subprocess.TimeoutExpired: server.kill(); server.communicate()
