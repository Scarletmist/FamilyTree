"""Regression for profile-aware Phase 1 semantic zoom.
Zoom gestures remain transform-based while active. After the gesture/debounce commits,
Desktop uses 7 levels, Tablet 5, Mobile Portrait 4 and Mobile Landscape 5.
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

EXPECTED = {
    'overview': {'width': 96, 'label': 22, 'location': False, 'position': False, 'order': False},
    'compact': {'width': 116, 'label': 18, 'location': False, 'position': False, 'order': False},
    'condensed': {'width': 148, 'label': 15, 'location': True, 'position': False, 'order': False},
    'medium': {'width': 164, 'label': 13, 'location': True, 'position': True, 'order': False},
    'normal': {'width': 176, 'label': 12, 'location': True, 'position': True, 'order': True},
    'detail': {'width': 154, 'label': 9.5, 'location': True, 'position': True, 'order': True},
    'inspect': {'width': 126, 'label': 7, 'location': True, 'position': True, 'order': True},
}

PROFILES = [
    ('desktop', {'width': 1440, 'height': 900}, False, [
        (1.00, 'normal'), (0.80, 'medium'), (0.70, 'condensed'), (0.50, 'compact'), (0.40, 'overview'),
        (1.30, 'detail'), (1.50, 'inspect')
    ]),
    ('tablet', {'width': 820, 'height': 1180}, True, [
        (1.00, 'normal'), (0.70, 'condensed'), (0.50, 'compact'), (0.40, 'overview'), (1.20, 'detail')
    ]),
    ('mobile-portrait', {'width': 390, 'height': 844}, True, [
        (1.00, 'normal'), (0.70, 'condensed'), (0.50, 'compact'), (1.20, 'detail')
    ]),
    ('mobile-landscape', {'width': 844, 'height': 390}, True, [
        (1.00, 'normal'), (0.70, 'condensed'), (0.50, 'compact'), (0.40, 'overview'), (1.20, 'detail')
    ]),
]

with tempfile.TemporaryDirectory(prefix='family-semantic-zoom-') as temp:
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
            page.wait_for_function("document.querySelectorAll('.person').length > 0 && document.querySelector('.relation-label')")
            return context, page, errors

        def metrics(page):
            return page.evaluate("""() => {
                const canvas = document.getElementById('tree-canvas');
                const card = canvas.querySelector('.person');
                const label = canvas.querySelector('.relation-label');
                const path = canvas.querySelector('#tree-connectors path[data-points]');
                const style = getComputedStyle(card);
                const matrix = new DOMMatrix(getComputedStyle(canvas).transform);
                const visible = selector => getComputedStyle(card.querySelector(selector)).display !== 'none';
                return {
                    profile: canvas.dataset.zoomProfile,
                    level: canvas.dataset.zoomLevel,
                    transform: getComputedStyle(canvas).transform,
                    scale: matrix.a || 1,
                    width: card.getBoundingClientRect().width / (matrix.a || 1),
                    minHeight: parseFloat(style.minHeight),
                    location: visible('.person__location'),
                    position: visible('.person__position'),
                    order: visible('.person__order'),
                    labelFont: parseFloat(getComputedStyle(label).fontSize),
                    vectorEffect: path?.getAttribute('vector-effect') || getComputedStyle(path).vectorEffect
                };
            }""")

        def zoom_to(page, target):
            page.evaluate("""target => {
                const value = () => Number(document.getElementById('tree-zoom-value').textContent.replace('%','')) / 100;
                const plus = document.getElementById('tree-zoom-in');
                const minus = document.getElementById('tree-zoom-out');
                let guard = 40;
                while (guard-- > 0 && Math.abs(value() - target) > .005) {
                    (value() < target ? plus : minus).click();
                }
            }""", target)
            page.wait_for_timeout(240)

        def assert_level(name, observed, expected_level):
            expected = EXPECTED[expected_level]
            assert observed['profile'] == name, (name, observed)
            assert observed['level'] == expected_level, (name, observed)
            assert abs(observed['width'] - expected['width']) <= 2, (name, expected_level, observed)
            assert abs(observed['labelFont'] - expected['label']) <= 1, (name, expected_level, observed)
            assert observed['location'] == expected['location'], (name, expected_level, observed)
            assert observed['position'] == expected['position'], (name, expected_level, observed)
            assert observed['order'] == expected['order'], (name, expected_level, observed)
            assert observed['vectorEffect'] == 'non-scaling-stroke', (name, expected_level, observed)

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                for name, viewport, mobile, levels in PROFILES:
                    context, page, errors = load_page(browser, viewport, mobile=mobile)
                    try:
                        initial = metrics(page)
                        assert_level(name, initial, 'normal')

                        # Hybrid preview: desktop 100 -> 80 stays Normal until debounce, then commits Medium.
                        if name == 'desktop':
                            page.locator('#tree-zoom-out').click()
                            page.locator('#tree-zoom-out').click()
                            preview = metrics(page)
                            assert preview['level'] == 'normal' and abs(preview['scale'] - .8) < .02, preview
                            page.wait_for_timeout(240)
                            assert_level(name, metrics(page), 'medium')
                            page.locator('#tree-zoom-value').click()
                            page.wait_for_timeout(240)

                        for target, expected_level in levels:
                            zoom_to(page, target)
                            observed = metrics(page)
                            assert_level(name, observed, expected_level)

                        # Mobile portrait: a slow pinch must not semantic-rerender before touchend.
                        if name == 'mobile-portrait':
                            zoom_to(page, 1.0)
                            tree = page.locator('.tree').bounding_box()
                            assert tree
                            cx = tree['x'] + tree['width'] * .5
                            cy = tree['y'] + min(tree['height'] * .5, 240)
                            session = context.new_cdp_session(page)
                            session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[
                                {'x':cx-40,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                                {'x':cx+40,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                            ]})
                            session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[
                                {'x':cx-65,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                                {'x':cx+65,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                            ]})
                            page.wait_for_timeout(220)
                            assert metrics(page)['level'] == 'normal', metrics(page)
                            session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                            page.wait_for_timeout(240)
                            assert metrics(page)['level'] == 'detail', metrics(page)

                            # Orientation/profile changes must recompute semantic density, not keep the old profile.
                            page.evaluate("document.getElementById('tree-zoom-value').click()")
                            page.wait_for_timeout(240)
                            zoom_to(page, 0.8)
                            portrait = metrics(page)
                            assert portrait['profile'] == 'mobile-portrait' and portrait['level'] == 'normal', portrait
                            page.set_viewport_size({'width':844, 'height':390})
                            page.wait_for_timeout(360)
                            landscape = metrics(page)
                            assert landscape['profile'] == 'mobile-landscape' and landscape['level'] == 'condensed', landscape
                            page.set_viewport_size({'width':390, 'height':844})
                            page.wait_for_timeout(360)
                            restored = metrics(page)
                            assert restored['profile'] == 'mobile-portrait' and restored['level'] == 'normal', restored

                        assert not errors, (name, errors)
                        print(name, [(target, expected) for target, expected in levels])
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
