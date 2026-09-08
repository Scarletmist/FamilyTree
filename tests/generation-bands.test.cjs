const test = require('node:test');
const assert = require('node:assert/strict');
const Bands = require('../assets/generation-bands.js');
const Model = require('../assets/family-model.js');
const demo = require('../data/family.json');

test('generation bands fill the canvas and split connector gaps at their midpoints', () => {
  assert.deepEqual(Bands.calculate([], 500), []);
  assert.deepEqual(Bands.calculate([{ gen: 3, top: 80, bottom: 180 }], 500), [
    { gen: 3, top: 0, height: 500 }
  ]);
  assert.deepEqual(Bands.calculate([
    { gen: 1, top: 60, bottom: 160 },
    { gen: 2, top: 300, bottom: 440 },
    { gen: 4, top: 580, bottom: 680 }
  ], 900), [
    { gen: 1, top: 0, height: 230 },
    { gen: 2, top: 230, height: 280 },
    { gen: 4, top: 510, height: 390 }
  ]);
});

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.style = {}; this.textContent = ''; }
  appendChild(node) { this.children.push(node); return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getBoundingClientRect() { return this.rect; }
}

test('backgrounds and vertical labels use the actual generation number without altering data', () => {
  const previous = global.document;
  global.document = { createElement: tag => new FakeElement(tag) };
  try {
    const canvas = new FakeElement('div');
    canvas.rect = { top: 100, bottom: 700, height: 600 };
    const row = (gen, top, bottom) => {
      const element = new FakeElement('div');
      element.dataset.gen = String(gen);
      element.rect = { top, bottom };
      return element;
    };
    const before = JSON.stringify(demo);
    const result = Bands.render(canvas, [row(2, 160, 260), row(4, 440, 540)]);
    assert.deepEqual(result.bands, [
      { gen: 2, top: 0, height: 250 },
      { gen: 4, top: 250, height: 350 }
    ]);
    assert.equal(result.backgrounds.attributes['aria-hidden'], 'true');
    assert.equal(result.labels.attributes['aria-hidden'], 'true');
    assert.deepEqual(result.backgrounds.children.map(e => e.dataset.tone), ['2', '4']);
    assert.deepEqual(result.labels.children.map(e => e.children[0].textContent), ['第2代', '第4代']);
    assert.equal(result.labels.children[1].style.top, '250px');
    assert.equal(result.labels.children[1].style.height, '350px');
    assert.equal(JSON.stringify(demo), before);
    assert.equal(Model.build(demo).people.length, demo.people.length);
  } finally { global.document = previous; }
});

test('server serves the generation module and its script is loaded before the graph', async () => {
  const { createFamilyServer } = require('../server.cjs');
  const server = createFamilyServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/assets/generation-bands.js');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.match(await response.text(), /FamilyGenerationBands/);
    const html = await (await fetch(base + '/')).text();
    assert(html.indexOf('assets/generation-bands.js') < html.indexOf('assets/family-tree.js'));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
