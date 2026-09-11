"""Browser regression using the actual local API and an isolated JSON copy.
Run with python tests/family-ui.py; requires the existing Playwright/Chromium test environment.
The browser's local navigation is restricted here, so HTML and scripts are loaded
from disk and fetch is bridged to the real Node server through Python.
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
ASSETS = ['family-model.js', 'relationship-details.js', 'generation-bands.js', 'kinship.js', 'relationship-search.js', 'connector-routing.js', 'label-layout.js', 'family-tree.js', 'family-storage.js', 'family-repository.js', 'member-form.js', 'member-tools.js']

with tempfile.TemporaryDirectory(prefix='family-ui-') as temp:
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
            try:
                with urllib.request.urlopen(req, timeout=10) as response:
                    return {'status': response.status, 'payload': json.loads(response.read())}
            except urllib.error.HTTPError as error:
                return {'status': error.code, 'payload': json.loads(error.read())}

        def bridge(_, options):
            return request(options['url'], options.get('method', 'GET'), json.loads(options['body']) if options.get('body') else None)

        def load_page(browser, viewport):
            page = browser.new_page(viewport=viewport, device_scale_factor=1)
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
            return page, errors

        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
            try:
                for device, viewport in [('desktop', {'width':1440,'height':900}), ('mobile', {'width':390,'height':844})]:
                    page, errors = load_page(browser, viewport)
                    initial = request('/api/family')['payload']['data'].get('familyName', '陳氏家族')
                    assert page.locator('#family-title').inner_text() == initial + '族譜圖'
                    assert page.title() == '族譜圖 — ' + initial
                    if device == 'mobile':
                        page.wait_for_function("document.querySelector('#kinship-status').textContent === ''")
                        page.locator('#mobile-search-open').click()
                        relation_ids = page.locator('#relationship-a option').evaluate_all("els => els.map(o => o.value).filter(Boolean).slice(0, 2)")
                        assert len(relation_ids) == 2
                        for selector, value in [('#relationship-a', relation_ids[0]), ('#relationship-b', relation_ids[1])]:
                            page.locator(selector).evaluate("(el, value) => { el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); }", value)
                        page.locator('#relationship-search [type=submit]').click(force=True)
                        page.wait_for_function("!document.querySelector('#relationship-summary').hidden")
                        assert page.locator('#relationship-summary').evaluate("el => getComputedStyle(el).display") != 'none'
                        page.locator('.relationship-result-end').click()
                        page.wait_for_function("document.querySelector('#relationship-summary').hidden")
                        assert page.locator('#relationship-summary').evaluate("el => getComputedStyle(el).display") == 'none'
                        assert page.locator('#relationship-summary').get_attribute('class') == 'relationship-summary'
                    page.locator('#edit-family-name').click()
                    assert page.locator('#family-name-input').input_value() == initial
                    new_name = '林氏宗親' if device == 'desktop' else '王氏家族'
                    page.locator('#family-name-input').fill('  ' + new_name + '  ')
                    page.locator('#save-family-name').click()
                    page.wait_for_function('(name) => document.querySelector("#family-title").textContent === name + "族譜圖"', arg=new_name)
                    assert page.title() == '族譜圖 — ' + new_name
                    assert json.loads(data_file.read_text())['familyName'] == new_name
                    assert json.loads(data_file.read_text())['people'] == DEMO['people']
                    # A stale save must preserve the user's draft and allow a deliberate refresh.
                    page.locator('#edit-family-name').click()
                    page.locator('#family-name-input').fill('保留輸入')
                    current = request('/api/family')['payload']
                    external = request('/api/family/name', 'PUT', {'familyName':'外部更新','version':current['version']})
                    assert external['status'] == 200
                    page.locator('#save-family-name').click()
                    assert page.locator('#family-name-dialog').is_visible()
                    assert page.locator('#family-name-input').input_value() == '保留輸入'
                    page.wait_for_function('document.querySelector("#family-name-error").textContent.includes("更新")')
                    page.locator('#refresh-family-name').click()
                    page.wait_for_function('document.querySelector("#family-title").textContent === "外部更新族譜圖"')
                    assert page.locator('#family-name-input').input_value() == '保留輸入'
                    page.locator('#save-family-name').click()
                    page.wait_for_function('document.querySelector("#family-title").textContent === "保留輸入族譜圖"')
                    page.locator('#edit-family-name').click()
                    page.locator('#family-name-input').fill('不應儲存')
                    page.locator('#cancel-family-name').click()
                    assert json.loads(data_file.read_text())['familyName'] == '保留輸入'
                    # Select a member, retain its relationship disclosures and minimize the drawer.
                    page.evaluate("window.selectFamilyMember('p11')")
                    panel = page.locator('#relationship-details')
                    assert panel.is_visible()
                    if panel.get_attribute('data-collapsed') == 'true':
                        panel.locator('.relationship-details__tab').click()
                    assert panel.locator('.relationship-details__header .edit-member svg').count() == 1
                    siblings = panel.locator('details[data-group="siblings"]')
                    siblings.locator('summary').click()
                    assert siblings.locator('.relationship-entry__role').all_text_contents() == ['二妹','三弟','契手足']
                    page.locator('.details-collapse').focus()
                    page.keyboard.press('Enter')
                    assert panel.get_attribute('data-collapsed') == 'true'
                    assert panel.locator('.relationship-details__content').is_hidden()
                    assert panel.locator('.relationship-details__content').evaluate('(el) => el.inert === true')
                    tab = panel.locator('.relationship-details__tab')
                    assert tab.is_visible()
                    assert tab.get_attribute('aria-expanded') == 'false'
                    metrics = panel.evaluate('el => { const r=el.getBoundingClientRect(), w=el.closest(".workspace").getBoundingClientRect(); return {width:r.width,right:r.right,workspaceRight:w.right,workspaceWidth:w.width}; }')
                    if device == 'mobile':
                        assert abs(metrics['width'] - (metrics['workspaceWidth'] - 16)) < 2, metrics
                        assert abs(metrics['right'] - (metrics['workspaceRight'] - 8)) < 2, metrics
                    else:
                        assert metrics['width'] <= 49, metrics
                        assert abs(metrics['right'] - metrics['workspaceRight']) < 1, metrics
                    assert page.locator('.person[aria-pressed="true"]').get_attribute('data-person-id') == 'p11'
                    page.evaluate('window.renderFamilyTree()')
                    assert panel.get_attribute('data-collapsed') == 'true'
                    page.locator('.tree').evaluate('(el) => { el.scrollLeft=650; el.scrollTop=400; }')
                    page.wait_for_timeout(80)
                    assert panel.get_attribute('data-collapsed') == 'true'
                    assert panel.locator('.relationship-details__tab').is_visible()
                    page.locator('.relationship-details__tab').focus()
                    page.keyboard.press('Space')
                    assert panel.get_attribute('data-collapsed') == 'false'
                    assert siblings.is_visible()
                    assert siblings.locator('.relationship-entry__role').all_text_contents() == ['二妹','三弟','契手足']
                    assert page.locator('.details-collapse').evaluate('(el) => el === document.activeElement')
                    page.locator('.details-collapse').click()
                    page.evaluate('window.renderFamilyTree()')
                    assert panel.get_attribute('data-collapsed') == 'true'
                    page.evaluate("window.selectFamilyMember('p17')")
                    if device == 'mobile':
                        assert panel.get_attribute('data-collapsed') == 'true'
                        panel.locator('.relationship-details__tab').click()
                    else:
                        assert panel.get_attribute('data-collapsed') == 'false'
                    assert '陳志偉' in panel.locator('h2').inner_text()
                    panel.locator('.edit-member').click()
                    assert page.locator('#member-dialog').is_visible()
                    page.locator('#cancel-member').click()
                    page.locator('.details-close').click()
                    assert panel.is_hidden()
                    # Loading a new page must read the persisted title, not the initial HTML constant.
                    reloaded, reload_errors = load_page(browser, viewport)
                    assert reloaded.locator('#family-title').inner_text() == '保留輸入族譜圖'
                    assert not reload_errors, reload_errors
                    reloaded.close()
                    assert not errors, errors
                    print(device, 'PASS: name persistence/conflicts, drawer, keyboard, redraw, edit, close')
                    page.close()
            finally:
                browser.close()
    finally:
        server.terminate()
        try: server.communicate(timeout=5)
        except subprocess.TimeoutExpired: server.kill(); server.communicate()
print('PASS: isolated browser/API integration; production data unchanged')
