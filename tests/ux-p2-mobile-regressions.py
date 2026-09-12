"""Mobile regressions for More visibility, member list density, ignored counts and VisualViewport recovery."""
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

with tempfile.TemporaryDirectory(prefix='family-p2-mobile-regressions-') as temp:
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
            with urllib.request.urlopen(req, timeout=10) as response:
                return {'status': response.status, 'payload': json.loads(response.read())}

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
                # Landscape: exactly one More trigger and a denser member-list first screen.
                context, page, errors = load_page(browser, {'width':844, 'height':390})
                try:
                    visible_more = page.locator('.tree-controls button[aria-label="更多功能"]:visible')
                    assert visible_more.count() == 1, page.locator('.tree-controls button[aria-label="更多功能"]').evaluate_all(
                        "els => els.map(el => ({id:el.id,display:getComputedStyle(el).display,rect:el.getBoundingClientRect().toJSON()}))"
                    )
                    assert visible_more.first.get_attribute('id') == 'landscape-more-open'

                    # Zero ignored items: every mobile trigger is hidden.
                    zero = page.evaluate("""() => {
                        FAMILY.ignoredIntermediatePlans=[];
                        refreshIgnoredIntermediateButtons();
                        return [...document.querySelectorAll('.open-ignored-intermediates')].map(el => ({
                            count:el.dataset.ignoredCount, display:getComputedStyle(el).display, text:el.textContent.trim()
                        }));
                    }""")
                    assert zero and all(x['count'] == '0' and x['display'] == 'none' for x in zero), zero

                    page.locator('#show-member-list').click()
                    page.wait_for_function("document.getElementById('member-list-dialog').open")
                    metrics = page.evaluate("""() => {
                        const dialog=document.getElementById('member-list-dialog');
                        const scroll=dialog.querySelector('.member-list-scroll');
                        const sticky=dialog.querySelector('.member-list-sticky');
                        const header=dialog.querySelector('.dialog-header');
                        const dr=dialog.getBoundingClientRect(), sr=scroll.getBoundingClientRect(), tr=sticky.getBoundingClientRect();
                        return {dialog:{top:dr.top,bottom:dr.bottom,height:dr.height},scroll:{height:sr.height},sticky:{height:tr.height},listFirstScreen:sr.height-tr.height,header:header.getBoundingClientRect().height};
                    }""")
                    assert metrics['sticky']['height'] <= 110, metrics
                    assert metrics['listFirstScreen'] >= 215, metrics

                    # Simulate keyboard-shrunk VisualViewport and its restoration. The dialog
                    # follows viewport height directly, so no stale bottom inset can remain.
                    restored = page.evaluate("""() => {
                        const root=document.documentElement;
                        const dialog=document.getElementById('member-list-dialog');
                        root.style.setProperty('--visual-viewport-top','0px');
                        root.style.setProperty('--visual-viewport-height','220px');
                        const small=dialog.getBoundingClientRect();
                        root.style.setProperty('--visual-viewport-height','390px');
                        const full=dialog.getBoundingClientRect();
                        return {small:{top:small.top,bottom:small.bottom,height:small.height},full:{top:full.top,bottom:full.bottom,height:full.height}};
                    }""")
                    assert restored['small']['bottom'] <= 221, restored
                    assert restored['full']['bottom'] >= 389, restored
                    assert restored['full']['height'] > restored['small']['height'] + 160, restored

                    # Non-zero ignored items: every trigger carries the same visible count.
                    counted = page.evaluate("""() => {
                        const plans=FamilyModel.intermediatePlans(FAMILY,{includeIgnored:true});
                        FAMILY.ignoredIntermediatePlans=plans.map(plan => plan.id);
                        const count=refreshIgnoredIntermediateButtons();
                        return {count, items:[...document.querySelectorAll('.open-ignored-intermediates')].map(el => ({
                            count:el.dataset.ignoredCount, text:el.textContent.trim(), aria:el.getAttribute('aria-label'),
                            display:getComputedStyle(el).display, hidden:el.hidden
                        }))};
                    }""")
                    assert counted['count'] > 0, counted
                    assert counted['items'] and all(x['count'] == str(counted['count']) for x in counted['items']), counted
                    assert all(f"（{counted['count']}）" in x['text'] for x in counted['items']), counted
                    assert all(not x['hidden'] and x['display'] != 'none' for x in counted['items']), counted
                    assert not errors, errors
                    print('landscape mobile regressions PASS', metrics, restored, counted['count'])
                finally:
                    context.close()

                # Portrait: only portrait More and zero ignored entry remains hidden.
                context, page, errors = load_page(browser, {'width':390, 'height':844})
                try:
                    visible_more = page.locator('.tree-controls button[aria-label="更多功能"]:visible')
                    assert visible_more.count() == 1
                    assert visible_more.first.get_attribute('id') == 'portrait-more-open'
                    page.locator('#portrait-more-open').click()
                    page.wait_for_function("document.getElementById('landscape-more-sheet').open")
                    zero_display = page.locator('#landscape-more-sheet .open-ignored-intermediates').evaluate("el => getComputedStyle(el).display")
                    assert zero_display == 'none', zero_display
                    assert not errors, errors
                    print('portrait mobile regressions PASS')
                finally:
                    context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
