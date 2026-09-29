const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const Model = require('../src/assets/family-model.js');
const Projection = require('../src/assets/family-display-projection.js');
const { createFamilyServer } = require('../dev/server.cjs');
const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/family.json'), 'utf8'));

test('domain graph stays free of display generations and projection supplies them', () => {
  const domain = Model.build(demo);
  assert(domain.people.every(person => !Object.hasOwn(person, 'gen')));
  assert(domain.people.every(person => !Object.hasOwn(person, 'generationKnown')));

  const display = Projection.project(domain);
  assert.equal(display.people.length, domain.people.length);
  assert(display.people.every(person => Number.isFinite(person.gen)));
  assert(display.people.every(person => person.gen >= 1));
});

test('family tree coordinator uses native ES modules without core tree globals', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/assets/family-tree.js'), 'utf8');
  for (const moduleName of [
    'family-tree-renderer.mjs',
    'family-tree-layout.mjs',
    'family-tree-viewport.mjs',
    'family-tree-interaction.mjs'
  ]) assert(source.includes(`from './${moduleName}'`), moduleName);

  for (const legacy of [
    'window.FAMILY',
    'window.renderFamilyTree',
    'window.selectFamilyMember',
    'window.clearFamilyViewState'
  ]) assert.equal(source.includes(legacy), false, legacy);
});

test('production HTML loads the tree coordinator as the final module entry', () => {
  const html = fs.readFileSync(path.join(ROOT, 'src/family-tree.html'), 'utf8');
  assert.match(html, /<script type="module" src="assets\/family-tree\.js"><\/script>/);
  const moduleAt = html.indexOf('<script type="module" src="assets/family-tree.js"></script>');
  const appAt = html.indexOf('<script src="assets/family-app.js"></script>');
  const toolbarAt = html.indexOf('<script src="assets/mobile-landscape-toolbar.js"></script>');
  assert(moduleAt > appAt);
  assert(moduleAt > toolbarAt);
});

test('local dev server serves projection and ES module assets as JavaScript', async () => {
  const server = createFamilyServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const name of [
      'family-display-projection.js',
      'family-tree-renderer.mjs',
      'family-tree-layout.mjs',
      'family-tree-viewport.mjs',
      'family-tree-interaction.mjs'
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}/assets/${name}`);
      assert.equal(response.status, 200, name);
      assert.match(response.headers.get('content-type') || '', /^text\/javascript/, name);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
