"""P0 mobile UX regressions: screen-space hit targets, overlay avoidance,
orientation anchoring and VisualViewport-aware landscape forms.
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

with tempfile.TemporaryDirectory(prefix='family-p0-mobile-') as temp:
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
            page.wait_for_function("document.querySelectorAll('.person').length > 0")
            return context, page, errors

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                # Portrait: bottom overlays must stack above the relationship peek.
                context, page, errors = load_page(browser, {'width':390, 'height':844})
                try:
                    person = page.locator('.person').first
                    person_id = person.get_attribute('data-person-id')
                    person.click()
                    page.wait_for_timeout(120)
                    page.evaluate("document.getElementById('save-status').textContent='已儲存，可復原上一項修改。'")
                    page.wait_for_timeout(80)
                    overlay = page.evaluate("""() => {
                        const box = el => { const r=el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
                        const details=document.getElementById('relationship-details');
                        return {details:box(details), fit:box(document.getElementById('mobile-tree-fit')), status:box(document.getElementById('save-status')), collapsed:details.dataset.collapsed};
                    }""")
                    assert overlay['collapsed'] == 'true', overlay
                    assert overlay['fit']['bottom'] <= overlay['details']['top'] - 6, overlay
                    assert overlay['status']['bottom'] <= overlay['details']['top'] - 6, overlay
                    assert overlay['status']['right'] <= overlay['fit']['left'] - 6, overlay

                    # Selected-member anchor remains visible and near the same relative viewport point on rotation.
                    page.evaluate("document.getElementById('save-status').textContent=''")
                    page.evaluate('(id) => window.selectFamilyMember(id)', person_id)
                    page.wait_for_timeout(100)
                    def selected_position():
                        return page.evaluate("""id => {
                            const view=document.querySelector('.tree').getBoundingClientRect();
                            const el=[...document.querySelectorAll('.person')].find(node => node.dataset.personId === id);
                            if (!el) return null;
                            const node=el.getBoundingClientRect();
                            return {x:(node.left+node.width/2-view.left)/view.width,y:(node.top+node.height/2-view.top)/view.height,
                                pressed:el.getAttribute('aria-pressed'),
                                visible:node.right>view.left&&node.left<view.right&&node.bottom>view.top&&node.top<view.bottom};
                        }""", person_id)
                    before = selected_position()
                    page.set_viewport_size({'width':844, 'height':390})
                    page.wait_for_timeout(420)
                    after = selected_position()
                    assert before['visible'] and after['visible'], (before, after)
                    assert abs(before['x'] - after['x']) < .20 and abs(before['y'] - after['y']) < .20, (before, after)
                    assert not errors, errors
                    print('portrait overlays', overlay, 'anchor', before, after)
                finally:
                    context.close()

                # Landscape: minimum-scale cards/nodes receive at least a 44px screen-space tap target.
                context, page, errors = load_page(browser, {'width':844, 'height':390})
                try:
                    page.locator('#mobile-tree-fit').click()
                    page.wait_for_timeout(280)
                    hit = page.evaluate("""() => {
                        const tree=document.querySelector('.tree').getBoundingClientRect();
                        const matrix=new DOMMatrix(getComputedStyle(document.getElementById('tree-canvas')).transform);
                        const nodes=[...document.querySelectorAll('.person')];
                        for (const node of nodes) {
                            const r=node.getBoundingClientRect();
                            if (r.height >= 44 || r.bottom <= tree.top+80 || r.top >= tree.bottom-12 || r.right <= tree.left || r.left >= tree.right) continue;
                            const room=(44-r.height)/2;
                            const y=r.top-room+2;
                            const x=r.left+r.width/2;
                            if (y <= tree.top || y >= tree.bottom) continue;
                            const nativeTarget=document.elementFromPoint(x,y);
                            if (!nativeTarget || !nativeTarget.closest('.tree') || nativeTarget.closest('.person,.intermediate-node')) continue;
                            nativeTarget.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:x,clientY:y}));
                            return {id:node.dataset.personId, scale:matrix.a, height:r.height, point:{x,y}};
                        }
                        return null;
                    }""")
                    assert hit and hit['scale'] <= .5 and hit['height'] < 44, hit
                    page.wait_for_timeout(80)
                    selected = page.locator(f'.person[data-person-id="{hit["id"]}"]').get_attribute('aria-pressed')
                    assert selected == 'true', (hit, selected)

                    # VisualViewport math reserves keyboard space and focused controls can be scrolled into view.
                    assert page.evaluate('FamilyMobileGesturePolicy.computeBottomInset(390, 220, 0)') == 170
                    assert page.evaluate('FamilyMobileGesturePolicy.computeBottomInset(390, 220, 20)') == 150
                    page.locator('#add-member').click()
                    page.wait_for_function("document.getElementById('member-dialog').open")
                    page.evaluate("document.documentElement.style.setProperty('--visual-viewport-bottom-inset','120px')")
                    dialog_bottom = page.evaluate("parseFloat(getComputedStyle(document.getElementById('member-dialog')).bottom)")
                    assert abs(dialog_bottom - 120) < 1, dialog_bottom
                    scroll = page.evaluate("""() => {
                        const scroller=document.querySelector('#member-dialog .form-scroll');
                        const target=document.getElementById('add-relation');
                        target.focus({preventScroll:true}); scroller.scrollTop=0;
                        FamilyMobileGesturePolicy.ensureFocusedControlVisible();
                        return {before:0,after:scroller.scrollTop,max:scroller.scrollHeight-scroller.clientHeight};
                    }""")
                    assert scroll['max'] > 0 and scroll['after'] > 0, scroll
                    assert not errors, errors
                    print('landscape hit', hit, 'visual viewport', dialog_bottom, scroll)
                finally:
                    context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
