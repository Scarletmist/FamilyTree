"""Shared browser-test asset loader for the browser-first FamilyTree runtime.

The production tree coordinator is an ES module. Tests use set_content(), whose
about:blank base cannot resolve relative module imports, so the four dependency
modules are embedded as data URLs while all classic scripts retain production order.
"""
import base64
import json
import re

CLASSIC_ASSETS = [
    'family-model.js',
    'family-display-projection.js',
    'family-commands.js',
    'relationship-details.js',
    'generation-bands.js',
    'kinship.js',
    'relationship-search.js',
    'connector-routing.js',
    'label-layout.js',
    'family-storage.js',
    'family-repository.js',
    'family-app.js',
    'member-form.js',
    'family-management.js',
    'google-drive-client.js',
    'family-sync-engine.js',
    'google-drive-sync.js',
    'member-tools.js',
    'mobile-gesture-policy.js',
    'mobile-landscape-toolbar.js',
]

MODULE_ASSETS = [
    'family-tree-renderer.mjs',
    'family-tree-layout.mjs',
    'family-tree-viewport.mjs',
    'family-tree-interaction.mjs',
]

SCRIPT_RE = re.compile(r'<script\b[^>]*\bsrc="assets/[^"\n]+"[^>]*></script>')


def html_without_asset_scripts(root):
    html = (root / 'src' / 'family-tree.html').read_text()
    dialogs = (root / 'src' / 'templates' / 'dialogs.html').read_text().rstrip()
    css = (root / 'src' / 'assets' / 'family-tree.css').read_text()
    html = html.replace('  <!-- @include templates/dialogs.html -->', dialogs)
    html = html.replace('  <link rel="stylesheet" href="assets/family-tree.css" />', '<style>\n' + css + '</style>')
    return SCRIPT_RE.sub('', html)


def family_tree_module_source(root):
    source = (root / 'src' / 'assets' / 'family-tree.js').read_text()
    for name in MODULE_ASSETS:
        module_source = (root / 'src' / 'assets' / name).read_text().encode()
        module_url = 'data:text/javascript;base64,' + base64.b64encode(module_source).decode()
        source = source.replace(json.dumps('./' + name), json.dumps(module_url))
        source = source.replace("'" + './' + name + "'", json.dumps(module_url))
    return source


def install_family_assets(page, root):
    for asset in CLASSIC_ASSETS:
        page.add_script_tag(content=(root / 'src' / 'assets' / asset).read_text())
    page.add_script_tag(type='module', content=family_tree_module_source(root))
    # Production intentionally no longer exports the old tree globals. Keep this
    # compatibility surface inside browser tests only while the UX suites migrate
    # to FamilyApp + tree events.
    page.add_script_tag(content=r'''(() => {
      Object.defineProperty(window, 'FAMILY', {
        configurable: true,
        get: () => window.FamilyApp?.graph?.(),
        set: data => {
          if (!data || typeof data !== 'object') return;
          window.FamilyApp?.adopt?.({
            version: window.FamilyApp?.snapshot?.()?.version || 'browser-test',
            data
          }, 'browser-test');
        }
      });
      window.selectFamilyMember = (id, options = {}) => window.dispatchEvent(new CustomEvent('familytreeselect', {
        detail: { id, options }
      }));
      window.renderFamilyTree = () => window.dispatchEvent(new CustomEvent('familyappchange', {
        detail: { graph: window.FamilyApp?.graph?.(), source: 'browser-test-render' }
      }));
      window.clearFamilyViewState = () => window.dispatchEvent(new CustomEvent('familytreeclearview'));
    })();''')
