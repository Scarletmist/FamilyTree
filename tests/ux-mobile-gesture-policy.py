"""Regression for mobile gesture policy.
Canvas owns pinch; toolbar owns horizontal pan; sheets/forms own vertical pan;
Safari native page pinch is suppressed outside the canvas without using user-scalable=no.
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

with tempfile.TemporaryDirectory(prefix='family-mobile-gesture-') as temp:
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

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                for name, viewport in [('portrait', {'width':390, 'height':844}), ('landscape', {'width':844, 'height':390})]:
                    context, page, errors = load_page(browser, viewport)
                    try:
                        page.locator('.person').first.click()
                        page.wait_for_function("document.querySelector('.relationship-details__body') !== null")
                        styles = page.evaluate("""() => ({
                            viewport: document.querySelector('meta[name="viewport"]').content,
                            htmlTextAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust || getComputedStyle(document.documentElement).textSizeAdjust,
                            tree: getComputedStyle(document.querySelector('.tree')).touchAction,
                            toolbar: getComputedStyle(document.querySelector('.tree-controls')).touchAction,
                            header: getComputedStyle(document.querySelector('.page-header__identity')).touchAction,
                            dialogHeader: getComputedStyle(document.querySelector('#member-list-dialog .dialog-header')).touchAction,
                            dialogBody: getComputedStyle(document.querySelector('#member-list-dialog .dialog-scroll')).touchAction,
                            detailsBody: getComputedStyle(document.querySelector('.relationship-details__body')).touchAction
                        })""")
                        assert styles['viewport'] == 'width=device-width, initial-scale=1', (name, styles)
                        assert styles['tree'] == 'none', (name, styles)
                        assert styles['toolbar'] == 'pan-x', (name, styles)
                        assert styles['header'] == 'none', (name, styles)
                        assert styles['dialogHeader'] == 'none', (name, styles)
                        assert styles['dialogBody'] == 'pan-y', (name, styles)
                        assert styles['detailsBody'] == 'pan-y', (name, styles)
                        assert styles['htmlTextAdjust'] in ('100%', 'auto'), (name, styles)
                        assert page.evaluate('window.FamilyMobileGesturePolicy && window.FamilyMobileGesturePolicy.isMobile()') is True
                        page.evaluate("window.selectFamilyMember(null)")
                        page.wait_for_timeout(50)

                        # Safari-like native gesture events are canceled outside Canvas but left alone on Canvas.
                        result = page.evaluate("""() => {
                            const dispatch = target => {
                                const event = new Event('gesturestart', {bubbles:true, cancelable:true});
                                const returned = target.dispatchEvent(event);
                                return {returned, defaultPrevented:event.defaultPrevented};
                            };
                            return {
                                toolbar: dispatch(document.querySelector('.tree-controls')),
                                header: dispatch(document.querySelector('.page-header__identity')),
                                tree: dispatch(document.querySelector('.tree'))
                            };
                        }""")
                        assert result['toolbar']['defaultPrevented'] and not result['toolbar']['returned'], (name, result)
                        assert result['header']['defaultPrevented'] and not result['header']['returned'], (name, result)
                        assert not result['tree']['defaultPrevented'] and result['tree']['returned'], (name, result)

                        # The family canvas must still own a real two-finger pinch.
                        canvas_box = page.locator('.tree').bounding_box()
                        assert canvas_box, name
                        before_transform = page.locator('.tree__canvas').evaluate("el => getComputedStyle(el).transform")
                        session = context.new_cdp_session(page)
                        cx = canvas_box['x'] + canvas_box['width'] * .5
                        cy = canvas_box['y'] + min(canvas_box['height'] * .55, 220)
                        session.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[
                            {'x':cx-35,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                            {'x':cx+35,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                        ]})
                        session.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[
                            {'x':cx-75,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':1},
                            {'x':cx+75,'y':cy,'radiusX':2,'radiusY':2,'force':1,'id':2}
                        ]})
                        session.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
                        page.wait_for_timeout(120)
                        after_transform = page.locator('.tree__canvas').evaluate("el => getComputedStyle(el).transform")
                        assert after_transform != before_transform, (name, before_transform, after_transform)

                        # Opening a modal must retain vertical content scrolling while its chrome stays non-zoomable.
                        page.locator('#show-member-list').click()
                        page.wait_for_function("document.getElementById('member-list-dialog').open")
                        modal_styles = page.evaluate("""() => ({
                            header:getComputedStyle(document.querySelector('#member-list-dialog .dialog-header')).touchAction,
                            body:getComputedStyle(document.querySelector('#member-list-dialog .dialog-scroll')).touchAction,
                            bodyOverflow:getComputedStyle(document.querySelector('#member-list-dialog .dialog-scroll')).overflowY
                        })""")
                        assert modal_styles['header'] == 'none', (name, modal_styles)
                        assert modal_styles['body'] == 'pan-y', (name, modal_styles)
                        assert modal_styles['bodyOverflow'] in ('auto', 'scroll'), (name, modal_styles)
                        assert not errors, (name, errors)
                        print(name, styles)
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
