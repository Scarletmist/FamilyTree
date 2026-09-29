const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { build } = require('../dev/build.cjs');
const { createFamilyServer } = require('../dev/server.cjs');
const { renderFamilyTreeHtml } = require('../dev/site-source.cjs');

const ROOT = path.resolve(__dirname, '..');

test('production, dev tooling and fixtures have explicit directory boundaries', () => {
  for (const legacy of ['assets', 'data', 'family-tree.html', 'build.cjs', 'server.cjs']) {
    assert.equal(fs.existsSync(path.join(ROOT, legacy)), false, legacy);
  }
  assert(fs.existsSync(path.join(ROOT, 'src', 'family-tree.html')));
  assert(fs.existsSync(path.join(ROOT, 'src', 'assets', 'family-tree.css')));
  assert(fs.existsSync(path.join(ROOT, 'dev', 'build.cjs')));
  assert(fs.existsSync(path.join(ROOT, 'dev', 'server.cjs')));
  assert(fs.existsSync(path.join(ROOT, 'fixtures', 'family.json')));
  assert(fs.existsSync(path.join(ROOT, 'src', 'data', 'kinship-terms.json')));
});

test('source page keeps CSS and dialogs split while rendered HTML is complete', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'family-tree.html'), 'utf8');
  const sourceLines = source.trimEnd().split(/\r?\n/).length;
  assert(sourceLines < 250, 'family-tree source shell should stay compact');
  assert.doesNotMatch(source, /<style\b/);
  assert.match(source, /<link rel="stylesheet" href="assets\/family-tree\.css" \/>/);
  assert.match(source, /<!-- @include templates\/dialogs\.html -->/);

  const rendered = await renderFamilyTreeHtml();
  assert.doesNotMatch(rendered, /@include/);
  assert.match(rendered, /<dialog id="member-dialog"/);
  assert.match(rendered, /<dialog id="cloud-sync-dialog"/);
  assert.match(rendered, /assets\/family-tree\.css/);
});

test('P2 UX source keeps progressive member flow, compact defaults and identifiable relationship queries', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src', 'family-tree.html'), 'utf8');
  const dialogs = fs.readFileSync(path.join(ROOT, 'src', 'templates', 'dialogs.html'), 'utf8');
  const search = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'relationship-search.js'), 'utf8');
  const mobileToolbar = fs.readFileSync(path.join(ROOT, 'src', 'assets', 'mobile-landscape-toolbar.js'), 'utf8');

  assert.match(shell, /<details class="legend-panel">/);
  assert.doesNotMatch(shell, /<details class="legend-panel" open>/);
  const primary = dialogs.indexOf('member-primary-fields');
  const relations = dialogs.indexOf('member-relations-section');
  const optional = dialogs.indexOf('member-optional-fields');
  assert(primary >= 0 && primary < relations && relations < optional, { primary, relations, optional });
  assert.match(dialogs, /member-ranking-fields/);
  assert.match(search, /第 \$\{person\.gen \+ generationOffset\} 代/);
  assert.match(search, /請先選擇稱呼基準與要查詢的成員/);
  assert.match(mobileToolbar, /data-action="cloud"/);
  assert.match(mobileToolbar, /portrait-more-text/);
});

test('static build publishes only src runtime content, never dev, fixtures or templates', async () => {
  const output = await fsp.mkdtemp(path.join(os.tmpdir(), 'family-p2-build-'));
  try {
    await build(output);
    await fsp.access(path.join(output, 'assets', 'family-tree.css'));
    await fsp.access(path.join(output, 'data', 'kinship-terms.json'));
    await assert.rejects(fsp.access(path.join(output, 'data', 'family.json')));
    await assert.rejects(fsp.access(path.join(output, 'fixtures')));
    await assert.rejects(fsp.access(path.join(output, 'dev')));
    await assert.rejects(fsp.access(path.join(output, 'templates')));
    const html = await fsp.readFile(path.join(output, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /@include/);
    assert.match(html, /<dialog id="member-list-dialog"/);
  } finally {
    await fsp.rm(output, { recursive: true, force: true });
  }
});

test('local dev server composes templates and serves external CSS from src', async () => {
  const server = createFamilyServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const page = await fetch(`http://127.0.0.1:${port}/family-tree.html`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.doesNotMatch(html, /@include/);
    assert.match(html, /<dialog id="member-dialog"/);

    const css = await fetch(`http://127.0.0.1:${port}/assets/family-tree.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') || '', /^text\/css/);
    assert.match(await css.text(), /\.tree__canvas/);

    const fixture = await fetch(`http://127.0.0.1:${port}/fixtures/family.json`);
    assert.equal(fixture.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
