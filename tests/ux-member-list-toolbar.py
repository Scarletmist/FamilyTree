"""Regression for responsive member-list toolbar layout on mobile portrait/landscape."""
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
ASSETS = ['family-model.js', 'relationship-details.js', 'generation-bands.js', 'kinship.js', 'relationship-search.js', 'connector-routing.js', 'label-layout.js', 'family-tree.js', 'family-storage.js', 'family-repository.js', 'member-form.js', 'member-tools.js']

with tempfile.TemporaryDirectory(prefix='family-toolbar-') as temp:
    data_file = Path(temp) / 'family.json'
    data_file.write_text(json.dumps(DEMO, ensure_ascii=False, indent=2) + '\n')
    command = ['node', '-e', "const {createFamilyServer}=require(process.argv[1]);const s=createFamilyServer({dataFile:process.argv[2]});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));", str(ROOT / 'server.cjs'), str(data_file)]
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

        def load_page(browser, viewport):
            context = browser.new_context(viewport=viewport, device_scale_factor=1, is_mobile=True, has_touch=True)
            page = context.new_page()
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
            page.evaluate("() => { const plans=FamilyModel.intermediatePlans(FAMILY,{includeIgnored:true}); FAMILY.ignoredIntermediatePlans=plans.map(plan => plan.id); refreshIgnoredIntermediateButtons(); }")
            return context, page

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                for name, viewport in [('portrait', {'width':390,'height':844}), ('landscape', {'width':844,'height':390})]:
                    context, page = load_page(browser, viewport)
                    try:
                        page.locator('#show-member-list').click()
                        page.wait_for_function("document.querySelector('#member-list-dialog').open")
                        metrics = page.locator('.member-list-toolbar').evaluate("""el => {
                            const r = el.getBoundingClientRect();
                            const s = el.querySelector('.member-list-search-label').getBoundingClientRect();
                            const i = el.querySelector('#member-list-search').getBoundingClientRect();
                            const b = el.querySelector('.member-list-secondary').getBoundingClientRect();
                            const style = getComputedStyle(el);
                            const searchStyle = getComputedStyle(el.querySelector('.member-list-search-label'));
                            return {
                                toolbar:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
                                search:{x:s.x,y:s.y,width:s.width,height:s.height,right:s.right,bottom:s.bottom},
                                input:{x:i.x,y:i.y,width:i.width,height:i.height,right:i.right,bottom:i.bottom},
                                button:{x:b.x,y:b.y,width:b.width,height:b.height,right:b.right,bottom:b.bottom},
                                display:style.display,
                                columns:style.gridTemplateColumns,
                                searchFlexBasis:searchStyle.flexBasis,
                                overflow:el.scrollWidth > el.clientWidth + 1,
                                landscape:matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)').matches
                            };
                        }""")
                        assert metrics['display'] == 'grid', (name, metrics)
                        assert metrics['searchFlexBasis'] == 'auto', (name, metrics)
                        assert metrics['input']['height'] >= 43, (name, metrics)
                        assert metrics['button']['height'] >= 43, (name, metrics)
                        assert not metrics['overflow'], (name, metrics)
                        if name == 'portrait':
                            assert metrics['toolbar']['height'] < 130, metrics
                            assert abs(metrics['search']['width'] - metrics['toolbar']['width']) < 2, metrics
                            assert abs(metrics['button']['width'] - metrics['toolbar']['width']) < 2, metrics
                            assert metrics['button']['y'] >= metrics['search']['bottom'] + 6, metrics
                        else:
                            assert metrics['landscape'], metrics
                            assert metrics['toolbar']['height'] < 80, metrics
                            assert metrics['button']['x'] >= metrics['search']['right'] + 6, metrics
                            assert metrics['button']['right'] <= metrics['toolbar']['right'] + 1, metrics
                        print(name, 'member-list toolbar PASS', metrics)
                    finally:
                        context.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)
