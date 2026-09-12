"""P1 UX regressions: desktop focal wheel zoom, semantic zoom feedback,
portrait core+More toolbar and stronger Google Drive attention UI.
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

with tempfile.TemporaryDirectory(prefix='family-p1-') as temp:
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
                return {'status': response.status, 'payload': json.loads(response.read())}

        def bridge(_, options):
            return request(options['url'], options.get('method', 'GET'), json.loads(options['body']) if options.get('body') else None)

        def load_page(browser, viewport, mobile=False):
            context = browser.new_context(viewport=viewport, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.expose_binding('familyRequest', bridge)
            page.set_content(HTML, wait_until='load')
            page.evaluate("""() => {
                Object.defineProperty(crypto, 'randomUUID', {value: () => '00000000-0000-4000-8000-000000000001', configurable:true});
                window.fetch = async (url, options = {}) => {
                    const result = await window.familyRequest({url, method:options.method || 'GET', body:options.body || null});
                    return new Response(JSON.stringify(result.payload), {status:result.status, headers:{'Content-Type':'application/json'}});
                };
            }""")
            for asset in ASSETS:
                page.add_script_tag(content=(ROOT / 'assets' / asset).read_text())
            page.wait_for_function('(count) => window.FAMILY && window.FAMILY.people.length === count', arg=len(DEMO['people']))
            page.wait_for_function("document.querySelectorAll('.person').length > 0")
            return context, page, errors

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                # Desktop: Ctrl/Cmd-wheel zoom anchors the logical point under the cursor.
                context, page, errors = load_page(browser, {'width':1440, 'height':900}, mobile=False)
                try:
                    before = page.evaluate("""() => {
                        const view=document.querySelector('.tree'); const r=view.getBoundingClientRect();
                        const canvas=document.getElementById('tree-canvas'); const m=new DOMMatrix(getComputedStyle(canvas).transform);
                        const anchor={x:view.clientWidth*.72,y:view.clientHeight*.42};
                        return {scale:m.a,anchor,client:{x:r.left+anchor.x,y:r.top+anchor.y},logical:{x:(view.scrollLeft+anchor.x)/m.a,y:(view.scrollTop+anchor.y)/m.a}};
                    }""")
                    page.evaluate("""data => document.querySelector('.tree').dispatchEvent(new WheelEvent('wheel', {
                        bubbles:true,cancelable:true,ctrlKey:true,deltaY:-85,clientX:data.client.x,clientY:data.client.y
                    }))""", before)
                    page.wait_for_timeout(40)
                    after = page.evaluate("""data => {
                        const view=document.querySelector('.tree'); const canvas=document.getElementById('tree-canvas'); const m=new DOMMatrix(getComputedStyle(canvas).transform);
                        return {scale:m.a,logical:{x:(view.scrollLeft+data.anchor.x)/m.a,y:(view.scrollTop+data.anchor.y)/m.a},label:document.getElementById('tree-zoom-value').dataset.semanticLabel,pseudo:getComputedStyle(document.getElementById('tree-zoom-value'),'::after').content};
                    }""", before)
                    assert after['scale'] > before['scale'] + .05, (before, after)
                    assert abs(after['logical']['x'] - before['logical']['x']) < 1.5, (before, after)
                    assert abs(after['logical']['y'] - before['logical']['y']) < 1.5, (before, after)
                    assert after['label'] and '·' in after['pseudo'], after
                    page.wait_for_timeout(220)
                    assert not errors, errors
                    print('desktop wheel', before['scale'], after)
                finally:
                    context.close()

                # Portrait: no hidden horizontal toolbar actions; More exposes secondary controls.
                context, page, errors = load_page(browser, {'width':390, 'height':844}, mobile=True)
                try:
                    toolbar = page.evaluate("""() => {
                        const controls=document.querySelector('.tree-controls');
                        const shown=id=>getComputedStyle(document.getElementById(id)).display!=='none';
                        return {client:controls.clientWidth,scroll:controls.scrollWidth,more:shown('portrait-more-open'),importShown:shown('import-json'),exportShown:shown('export-json'),cloudShown:shown('cloud-sync'),legend:getComputedStyle(document.querySelector('.legend-panel')).display};
                    }""")
                    assert toolbar['more'] and not toolbar['importShown'] and not toolbar['exportShown'] and not toolbar['cloudShown'], toolbar
                    assert toolbar['scroll'] <= toolbar['client'] + 1, toolbar
                    assert toolbar['legend'] == 'none', toolbar
                    page.locator('#portrait-more-open').click()
                    page.wait_for_timeout(40)
                    sheet = page.locator('#landscape-more-sheet')
                    assert sheet.get_attribute('open') is not None
                    for action in ['family-name','canvas-names','legend','ignored','import','export']:
                        assert sheet.locator(f'[data-action="{action}"]').is_visible(), action
                    sheet.locator('#landscape-more-close').click()

                    # Mobile pinch shows temporary semantic scale feedback.
                    tree = page.locator('.tree').bounding_box(); assert tree
                    cx, cy = tree['x'] + tree['width']*.5, tree['y'] + min(tree['height']*.45, 260)
                    session = context.new_cdp_session(page)
                    session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[
                        {'x':cx-35,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                        {'x':cx+35,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                    ]})
                    session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[
                        {'x':cx-60,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                        {'x':cx+60,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                    ]})
                    page.wait_for_timeout(50)
                    hud = page.locator('#tree-semantic-zoom-hud')
                    assert 'is-visible' in (hud.get_attribute('class') or '')
                    assert '%' in hud.inner_text() and '·' in hud.inner_text(), hud.inner_text()
                    session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                    page.wait_for_timeout(1100)
                    assert 'is-visible' not in (hud.get_attribute('class') or '')
                    assert not errors, errors
                    print('portrait toolbar', toolbar, 'hud', hud.inner_text())
                finally:
                    context.close()

                # Landscape also exposes transient semantic feedback (fit-to-view is enough to trigger it).
                context, page, errors = load_page(browser, {'width':844, 'height':390}, mobile=True)
                try:
                    page.locator('#mobile-tree-fit').click()
                    page.wait_for_timeout(50)
                    hud = page.locator('#tree-semantic-zoom-hud')
                    assert 'is-visible' in (hud.get_attribute('class') or ''), hud.get_attribute('class')
                    assert '%' in hud.inner_text() and '·' in hud.inner_text(), hud.inner_text()
                    assert not errors, errors
                    print('landscape hud', hud.inner_text())
                finally:
                    context.close()

                # Minimal static cloud-sync shell: pending state must create a visible actionable banner.
                context = browser.new_context(viewport={'width':390,'height':844})
                page = context.new_page()
                try:
                    page.set_content('''<!doctype html><html><head><meta name="google-oauth-client-id" content="test.apps.googleusercontent.com"></head><body>
                      <button id="cloud-sync" data-sync-state="disconnected"><span id="cloud-sync-button-text"></span></button>
                      <button id="cloud-sync-alert" hidden><span id="cloud-sync-alert-text"></span></button>
                      <dialog id="cloud-sync-dialog"><span id="cloud-sync-message"></span><span id="cloud-sync-meta"></span><button id="cloud-sync-action"></button><button id="cloud-sync-disconnect"></button><button id="close-cloud-sync-dialog"></button></dialog>
                      <dialog id="cloud-conflict-dialog"><span id="cloud-conflict-local-summary"></span><span id="cloud-conflict-remote-summary"></span><button id="cloud-conflict-use-local"></button><button id="cloud-conflict-use-remote"></button><button id="cloud-conflict-cancel"></button></dialog>
                    </body></html>''')
                    page.evaluate("""() => {
                      window.FamilyRepository={isStatic:true,getSyncState:async()=>({connected:true,dirty:true,lastSyncedAt:null}),setSyncState:async()=>{},read:async()=>({data:{people:[]},version:'v'}),isPristine:()=>false};
                      window.google={accounts:{oauth2:{initTokenClient:()=>({requestAccessToken(){}})}}};
                    }""")
                    page.add_script_tag(content=(ROOT / 'assets/google-drive-sync.js').read_text())
                    page.wait_for_function("document.getElementById('cloud-sync').dataset.syncState === 'pending'")
                    state = page.evaluate("""() => ({hidden:document.getElementById('cloud-sync-alert').hidden,text:document.getElementById('cloud-sync-alert-text').textContent,state:document.getElementById('cloud-sync-alert').dataset.syncState})""")
                    assert not state['hidden'] and state['state'] == 'pending' and '未同步' in state['text'], state
                    page.locator('#cloud-sync-alert').click()
                    page.wait_for_timeout(20)
                    assert page.locator('#cloud-sync-dialog').get_attribute('open') is not None
                    print('cloud alert', state)
                finally:
                    context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
