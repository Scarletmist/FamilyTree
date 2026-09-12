"""P2 UX regressions: sticky member tools, desktop locate shortcut,
landscape side sheets and persisted local view preferences.
"""
import json
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEMO = json.loads((ROOT / 'data/family.json').read_text())
HTML = re.sub(r'<script src="assets/[^"\n]+"></script>', '', (ROOT / 'family-tree.html').read_text())
ASSETS = [
    'family-model.js', 'relationship-details.js', 'generation-bands.js', 'kinship.js',
    'relationship-search.js', 'connector-routing.js', 'label-layout.js', 'family-tree.js',
    'family-storage.js', 'family-repository.js', 'member-form.js', 'google-drive-sync.js',
    'member-tools.js', 'mobile-gesture-policy.js', 'mobile-landscape-toolbar.js'
]

with tempfile.TemporaryDirectory(prefix='family-p2-') as temp:
    data_file = Path(temp) / 'family.json'
    data_file.write_text(json.dumps(DEMO, ensure_ascii=False, indent=2) + '\n')
    command = [
        'node', '-e',
        "const {createFamilyServer}=require(process.argv[1]);const s=createFamilyServer({dataFile:process.argv[2]});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));",
        str(ROOT / 'server.cjs'), str(data_file)
    ]
    server = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        port = int(server.stdout.readline().strip())
        base = f'http://127.0.0.1:{port}'

        def request(route, method='GET', body=None):
            headers = {'Origin': base, 'Content-Type': 'application/json'}
            req = urllib.request.Request(base + '/' + route.lstrip('/'), data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=10) as response:
                raw = response.read()
                try: payload = json.loads(raw)
                except Exception: payload = raw.decode()
                return {'status': response.status, 'payload': payload}

        def bridge(_, options):
            return request(options['url'], options.get('method', 'GET'), json.loads(options['body']) if options.get('body') else None)

        def install_document(page):
            page.set_content(HTML, wait_until='load')
            page.evaluate("""() => {
                window.__p2SessionData = window.__p2SessionData || {};
                Object.defineProperty(window, 'sessionStorage', {configurable:true, value:{
                  getItem:key => Object.prototype.hasOwnProperty.call(window.__p2SessionData,key) ? window.__p2SessionData[key] : null,
                  setItem:(key,value) => { window.__p2SessionData[key]=String(value); },
                  removeItem:key => { delete window.__p2SessionData[key]; },
                  key:index => Object.keys(window.__p2SessionData)[index] ?? null,
                  get length(){ return Object.keys(window.__p2SessionData).length; }
                }});
                Object.defineProperty(crypto, 'randomUUID', {value: () => '00000000-0000-4000-8000-000000000001', configurable:true});
                window.fetch = async (url, options = {}) => {
                    const result = await window.familyRequest({url, method:options.method || 'GET', body:options.body || null});
                    return new Response(typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload), {status:result.status, headers:{'Content-Type':'application/json'}});
                };
            }""")
            for asset in ASSETS:
                page.add_script_tag(content=(ROOT / 'assets' / asset).read_text())
            page.wait_for_function('(count) => window.FAMILY && window.FAMILY.people.length === count', arg=len(DEMO['people']))
            page.wait_for_function("document.querySelectorAll('.person').length > 0")

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                # Desktop: sticky member controls, selected-member locate, and local preference persistence.
                context = browser.new_context(viewport={'width':1440, 'height':900})
                page = context.new_page(); errors=[]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.expose_binding('familyRequest', bridge)
                install_document(page)

                page.locator('#show-member-list').click()
                scroller = page.locator('.member-list-scroll')
                page.evaluate("""() => { const el=document.querySelector('.member-list-scroll'); el.scrollTop=el.scrollHeight; }""")
                page.wait_for_timeout(50)
                sticky = page.locator('.member-list-sticky').bounding_box(); scrollbox = scroller.bounding_box(); scrolltop=scroller.evaluate('el=>el.scrollTop')
                assert sticky and scrollbox and scrolltop > 100, (sticky, scrollbox, scrolltop)
                assert sticky['y'] <= scrollbox['y'] + 18 and sticky['y'] + sticky['height'] > scrollbox['y'] + 30, (sticky, scrollbox)
                assert page.locator('#member-list-search').is_visible() and page.locator('.member-list-filters').is_visible() and page.locator('#member-list-count').is_visible()
                page.locator('#close-member-list').click()

                first = page.locator('.person').first; first.click(); panel=page.locator('#relationship-details'); assert panel.is_visible()
                locate = panel.locator('.details-locate'); assert locate.is_visible()
                header_box=panel.locator('.relationship-details__header').bounding_box(); actions_box=panel.locator('.relationship-details__actions').bounding_box(); title_box=panel.locator('#relationship-details-title').bounding_box()
                assert header_box and actions_box and title_box, (header_box,actions_box,title_box)
                assert actions_box['y'] >= header_box['y'] + header_box['height'] - 1, (header_box,actions_box)
                assert title_box['width'] >= 175, title_box
                assert panel.locator('.details-action__label', has_text='編輯').is_visible() and panel.locator('.details-action__label', has_text='定位').is_visible()
                person_id = first.get_attribute('data-person-id')
                page.evaluate("""() => { const view=document.querySelector('.tree'); view.scrollLeft=view.scrollWidth; view.scrollTop=view.scrollHeight; }""")
                locate.click(); page.wait_for_timeout(650)
                centered = page.evaluate("""id => { const view=document.querySelector('.tree'),node=document.querySelector(`.person[data-person-id="${id}"]`); const vr=view.getBoundingClientRect(),nr=node.getBoundingClientRect(); return {dx:Math.abs(nr.left+nr.width/2-(vr.left+vr.width/2)),dy:Math.abs(nr.top+nr.height/2-(vr.top+vr.height/2)),vw:vr.width,vh:vr.height}; }""", person_id)
                assert centered['dx'] < centered['vw']*.09 and centered['dy'] < centered['vh']*.11, centered

                page.locator('#toggle-canvas-names').click()
                legend=page.locator('.legend-panel')
                if legend.evaluate('el=>el.open'): legend.locator('summary').click()
                page.wait_for_timeout(220)
                stored=page.evaluate("""() => { const key=Object.keys(window.__p2SessionData).find(k=>k.startsWith('family-tree:canvas-view:v1:')); return key?JSON.parse(window.__p2SessionData[key]):null; }""")
                assert stored and stored.get('hideCanvasNames') is True and stored.get('legendOpen') is False, stored
                # Recreate the document in the same browsing context: sessionStorage survives,
                # giving us a deterministic reload-equivalent without localhost navigation.
                install_document(page)
                assert page.locator('#toggle-canvas-names').get_attribute('aria-pressed') == 'true'
                assert page.locator('.legend-panel').evaluate('el=>el.open') is False
                assert not errors, errors
                context.close()

                # Portrait: the same controls collapse back into the existing one-row mobile header.
                context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True, device_scale_factor=1)
                page = context.new_page(); errors=[]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.expose_binding('familyRequest', bridge); install_document(page)
                portrait_id=page.locator('.person').first.get_attribute('data-person-id'); page.evaluate("id => window.selectFamilyMember(id,{expandDetails:true})", portrait_id); page.wait_for_timeout(30)
                topbox=page.locator('#relationship-details .relationship-details__top').bounding_box(); titlebox=page.locator('#relationship-details-title').bounding_box(); editbox=page.locator('#relationship-details .edit-member').bounding_box()
                assert topbox and titlebox and editbox and topbox['height'] <= 52, (topbox,titlebox,editbox)
                assert abs((titlebox['y']+titlebox['height']/2)-(editbox['y']+editbox['height']/2)) < 3, (titlebox,editbox)
                assert not page.locator('#relationship-details .details-locate').is_visible()
                assert not page.locator('#relationship-details .details-action__label', has_text='編輯').is_visible()
                assert not errors, errors
                context.close()

                # Landscape: relationship query and More are right-side sheets.
                context = browser.new_context(viewport={'width':844, 'height':390}, is_mobile=True, has_touch=True, device_scale_factor=1)
                page = context.new_page(); errors=[]
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.expose_binding('familyRequest', bridge); install_document(page)
                page.locator('#landscape-relationship-open').click(); page.wait_for_timeout(60)
                rel=page.locator('.relationship-sheet'); relbox=rel.bounding_box(); assert rel.get_attribute('open') is not None and relbox
                assert relbox['x'] > 400 and relbox['x']+relbox['width'] >= 843 and relbox['y'] < 100 and relbox['height'] > 240, relbox
                page.locator('#relationship-sheet-close').click(); page.wait_for_timeout(30)
                page.locator('#landscape-more-open').click(); page.wait_for_timeout(60)
                more=page.locator('#landscape-more-sheet'); morebox=more.bounding_box(); assert more.get_attribute('open') is not None and morebox
                assert morebox['x'] > 400 and morebox['x']+morebox['width'] >= 843 and morebox['y'] < 100 and morebox['height'] > 240, morebox
                page.locator('#landscape-more-close').click(); page.locator('.person').first.click(); page.wait_for_timeout(30)
                assert not page.locator('#relationship-details .details-locate').is_visible()
                topbox=page.locator('#relationship-details .relationship-details__top').bounding_box(); titlebox=page.locator('#relationship-details-title').bounding_box(); editbox=page.locator('#relationship-details .edit-member').bounding_box()
                assert topbox and titlebox and editbox and topbox['height'] <= 60, (topbox,titlebox,editbox)
                assert abs((titlebox['y']+titlebox['height']/2)-(editbox['y']+editbox['height']/2)) < 3, (titlebox,editbox)
                assert not page.locator('#relationship-details .details-action__label', has_text='編輯').is_visible()
                assert not errors, errors
                context.close()
                print('P2 UX regressions passed')
            finally:
                browser.close()
    finally:
        server.terminate(); server.wait(timeout=5)
