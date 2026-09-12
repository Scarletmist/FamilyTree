"""Google Drive token refresh should reuse an existing grant from normal user actions."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SYNC_JS = (ROOT / 'assets/google-drive-sync.js').read_text()

HTML = '''<!doctype html><html><head>
<meta name="google-oauth-client-id" content="123456789-test.apps.googleusercontent.com">
</head><body>
<button id="cloud-sync"><span id="cloud-sync-button-text">雲端</span></button>
<dialog id="cloud-sync-dialog"><button id="close-cloud-sync-dialog"></button><button id="cloud-sync-disconnect"></button><button id="cloud-sync-action"></button><span id="cloud-sync-message"></span><span id="cloud-sync-meta"></span></dialog>
<dialog id="cloud-conflict-dialog"><span id="cloud-conflict-local-summary"></span><span id="cloud-conflict-remote-summary"></span><button id="cloud-conflict-use-local"></button><button id="cloud-conflict-use-remote"></button><button id="cloud-conflict-cancel"></button></dialog>
<button id="add-member">新增</button><button id="save-member">儲存</button>
<button id="edit-family-name">編輯家族名稱</button><button id="save-family-name">儲存名稱</button>
<button id="confirm-import">匯入</button><div id="ignored-intermediate-list"><button>恢復待補</button></div>
</body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'])
    page = browser.new_page(viewport={'width': 1000, 'height': 700})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content(HTML, wait_until='load')
    page.evaluate('''() => {
      window.__syncState = {connected:true, dirty:false, fileId:'file-1', remoteVersion:'1', lastSyncedAt:null};
      window.FamilyRepository = {
        isStatic:true,
        getSyncState: async () => ({...window.__syncState}),
        setSyncState: async patch => {
          window.__syncState = {...window.__syncState, ...patch};
          dispatchEvent(new CustomEvent('familyreposyncstate', {detail:{...window.__syncState}}));
          return {...window.__syncState};
        },
        read: async () => ({data:{schemaVersion:2,familyName:'測試',people:[]}, version:'local-1'}),
        isPristine: () => false,
        markCloudSynced: async (remote) => {
          window.__syncState = {...window.__syncState, fileId:remote.fileId, remoteVersion:remote.remoteVersion, dirty:false, connected:true, lastSyncedAt:Date.now()};
          return {...window.__syncState};
        },
        replaceFromCloud: async () => ({})
      };
      window.FamilyModel = { build: value => value };
      window.__tokenRequests = [];
      window.__tokenConfig = null;
      window.google = {accounts:{oauth2:{initTokenClient: config => {
        window.__tokenConfig = config;
        return {requestAccessToken: override => window.__tokenRequests.push(override || {})};
      }}}};
      window.fetch = async url => {
        if (String(url).includes('/drive/v3/files')) return new Response(JSON.stringify({files:[{id:'file-1',name:'family-tree.json',version:'1',modifiedTime:'2026-09-12T00:00:00Z',size:'100'}]}), {status:200, headers:{'Content-Type':'application/json'}});
        return new Response('{}', {status:200, headers:{'Content-Type':'application/json'}});
      };
    }''')
    page.add_script_tag(content=SYNC_JS)
    page.wait_for_function('window.__tokenConfig !== null')

    # Connected users are pre-warmed, but no OAuth flow starts until a user gesture.
    assert page.evaluate('window.__tokenRequests.length') == 0
    assert page.evaluate('window.__tokenConfig.prompt') == ''

    # A normal app action directly issues requestAccessToken from that click with an empty prompt.
    page.locator('#add-member').click()
    page.wait_for_function('window.__tokenRequests.length === 1')
    assert page.evaluate('window.__tokenRequests[0].prompt') == ''

    # A short-lived token is accepted, persisted, and triggers a background sync.
    page.evaluate("window.__tokenConfig.callback({access_token:'token-1', expires_in:240, scope:'https://www.googleapis.com/auth/drive.appdata', token_type:'Bearer'})")
    page.wait_for_function('window.__syncState.lastSyncedAt !== null')

    # Because only four minutes remain (< five-minute refresh window), the next normal action renews it again.
    page.locator('#save-member').click()
    page.wait_for_function('window.__tokenRequests.length === 2')
    assert page.evaluate('window.__tokenRequests[1].prompt') == ''

    # Closing/cancel-like unrelated controls are not in the allow-list and do not create extra OAuth requests.
    page.evaluate("document.body.insertAdjacentHTML('beforeend','<button id=\"unrelated-close\">關閉</button>')")
    page.locator('#unrelated-close').click()
    assert page.evaluate('window.__tokenRequests.length') == 2
    assert not errors, errors
    browser.close()

print('Google auth opportunistic refresh UX regression passed.')
