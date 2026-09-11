"""Regression for mobile document-level scrolling.
The page shell must stay exactly one visual viewport high while Canvas handles its own scrolling.
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
    'member-tools.js', 'mobile-landscape-toolbar.js'
]

with tempfile.TemporaryDirectory(prefix='family-mobile-shell-') as temp:
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
            req = urllib.request.Request(
                base + '/' + route.lstrip('/'),
                data=json.dumps(body).encode() if body is not None else None,
                headers=headers, method=method
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return {'status': response.status, 'payload': json.loads(response.read())}
            except urllib.error.HTTPError as error:
                return {'status': error.code, 'payload': json.loads(error.read())}

        def bridge(_, options):
            return request(options['url'], options.get('method', 'GET'), json.loads(options['body']) if options.get('body') else None)

        def load_page(browser, viewport):
            context = browser.new_context(viewport=viewport, device_scale_factor=1, is_mobile=True, has_touch=True)
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
            return context, page, errors

        def metrics(page):
            return page.evaluate("""() => ({
                innerHeight: window.innerHeight,
                scrollY: window.scrollY,
                docClientHeight: document.documentElement.clientHeight,
                docScrollHeight: document.documentElement.scrollHeight,
                bodyClientHeight: document.body.clientHeight,
                bodyScrollHeight: document.body.scrollHeight,
                bodyTop: document.body.getBoundingClientRect().top,
                bodyBottom: document.body.getBoundingClientRect().bottom,
                bodyPosition: getComputedStyle(document.body).position,
                bodyOverflowY: getComputedStyle(document.body).overflowY,
                workspaceHeight: document.querySelector('.workspace').getBoundingClientRect().height,
                controlsTouchAction: getComputedStyle(document.querySelector('.tree-controls')).touchAction
            })""")

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                for name, viewport in [('portrait', {'width':390, 'height':844}), ('landscape', {'width':844, 'height':390})]:
                    context, page, errors = load_page(browser, viewport)
                    try:
                        before = metrics(page)
                        assert before['bodyPosition'] == 'fixed', (name, before)
                        assert before['bodyOverflowY'] == 'hidden', (name, before)
                        assert before['controlsTouchAction'] == 'pan-x', (name, before)
                        assert abs(before['bodyClientHeight'] - before['innerHeight']) <= 1, (name, before)
                        assert before['docScrollHeight'] <= before['innerHeight'] + 1, (name, before)
                        assert before['bodyScrollHeight'] <= before['innerHeight'] + 1, (name, before)
                        assert abs(before['bodyTop']) <= 1 and abs(before['bodyBottom'] - before['innerHeight']) <= 1, (name, before)

                        # Even an explicit page-scroll request must not move the document shell.
                        page.evaluate('window.scrollTo(0, 160)')
                        page.wait_for_timeout(50)
                        assert page.evaluate('window.scrollY') == 0, (name, metrics(page))

                        # A vertical touch gesture starting on the horizontally scrollable top toolbar
                        # must not be handed back to the document viewport.
                        controls_dims = page.locator('.tree-controls').evaluate("el => ({clientWidth:el.clientWidth, scrollWidth:el.scrollWidth})")
                        box = page.locator('.tree-controls').bounding_box()
                        assert box
                        session = context.new_cdp_session(page)
                        x = box['x'] + min(box['width'] / 2, 120)
                        y = box['y'] + box['height'] / 2
                        session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y,'radiusX':2,'radiusY':2,'force':1}]})
                        session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x,'y':max(2, y - 90),'radiusX':2,'radiusY':2,'force':1}]})
                        session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                        page.wait_for_timeout(120)
                        after = metrics(page)
                        assert after['scrollY'] == 0, (name, after)
                        # Horizontal toolbar scrolling remains available when its content is wider than the viewport.
                        if controls_dims['scrollWidth'] > controls_dims['clientWidth'] + 1:
                            page.locator('.tree-controls').evaluate("el => { el.scrollLeft = Math.min(80, el.scrollWidth - el.clientWidth); }")
                            assert page.locator('.tree-controls').evaluate('el => el.scrollLeft') > 0, (name, controls_dims)
                        assert after['docScrollHeight'] <= after['innerHeight'] + 1, (name, after)
                        assert abs(after['bodyTop']) <= 1, (name, after)
                        assert not errors, (name, errors)
                        print(name, before)
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
