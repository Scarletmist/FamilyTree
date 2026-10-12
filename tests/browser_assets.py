"""Shared browser-test asset loader for the browser-first FamilyTree runtime.

The production tree coordinator is an ES module. Tests use set_content(), whose
about:blank base cannot resolve relative module imports, so dependencies are
embedded as data URLs while classic scripts retain production order. Geocoding
uses real script URLs and is covered by the separate static-site browser suites.
"""
import base64
import json
import re
import os
from functools import lru_cache

SCRIPT_RE = re.compile(r'<script\b[^>]*\bsrc="assets/[^"\n]+"[^>]*></script>')


def launch_browser_options():
    if os.environ.get('PLAYWRIGHT_EXECUTABLE'):
        return {'executable_path': os.environ['PLAYWRIGHT_EXECUTABLE']}
    channel = os.environ.get('PLAYWRIGHT_CHANNEL', 'msedge' if os.name == 'nt' else 'chromium')
    return {'channel': channel}


def html_without_asset_scripts(root):
    html = (root / 'src' / 'family-tree.html').read_text(encoding='utf-8')
    dialogs = (root / 'src' / 'templates' / 'dialogs.html').read_text(encoding='utf-8').rstrip()
    html = html.replace('  <!-- @include templates/dialogs.html -->', dialogs)
    html = re.sub(r'<link rel="stylesheet" href="assets/([^"\n]+)"\s*/>',
                  lambda match: '<style>\n' + (root / 'src' / 'assets' / match[1]).read_text(encoding='utf-8') + '</style>', html)
    return SCRIPT_RE.sub('', html)


def family_tree_module_source(root):
    assets = (root / 'src' / 'assets').resolve()
    @lru_cache(maxsize=None)
    def module_source(file):
        file = file.resolve()
        if not file.is_relative_to(assets):
            raise ValueError('Test module dependency outside production assets')
        source = file.read_text(encoding='utf-8')
        def replace(match):
            dependency = (file.parent / match[2]).resolve()
            data = module_source(dependency).encode('utf-8')
            return match[0].replace(match[1] + match[2] + match[1], json.dumps('data:text/javascript;base64,' + base64.b64encode(data).decode()))
        return re.sub(r"from\s*(['\"])(\./[^'\"]+)\1", replace, source)
    return module_source(assets / 'family-tree.js')


def install_family_assets(page, root):
    shell = (root / 'src' / 'family-tree.html').read_text(encoding='utf-8')
    # Follow the real shell's classic-script order, including schema, lifecycle,
    # evidence and detail layout added by phases 1–4.
    for script in SCRIPT_RE.finditer(shell):
        if 'type="module"' in script[0]:
            continue
        asset = re.search(r'src="assets/([^"\n]+)"', script[0])[1]
        if asset == 'member-locations.js':
            continue
        page.add_script_tag(content=(root / 'src' / 'assets' / asset).read_text(encoding='utf-8'))
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


def hidden(locator):
    """Wait for native exit transitions before asserting the final state."""
    locator.wait_for(state='hidden', timeout=5000)
    return locator.is_hidden()
