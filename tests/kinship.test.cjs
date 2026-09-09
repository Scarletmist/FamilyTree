const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const { create } = require('../assets/kinship');
const config = require('../data/kinship-terms.json');
const engine = create(config);
const p = (id, gender = 'M', relationships = [], siblingOrder = null) => ({ id, name: id, gender, relationships, siblingOrder, location: '', position: '' });
const r = (type, personId, kind) => ({ type, personId, ...(kind ? { kind } : {}) });
const parent = id => r('parent', id, '親生');
const graph = people => Model.build({ schemaVersion: 2, people });
const cousins = () => graph([p('G'), p('P', 'M', [parent('G')], 1), p('Q', 'M', [parent('G')], 4), p('A', 'M', [parent('P')], 1), p('B', 'F', [parent('Q')], 3), p('X')]);
test('cousins retain fathers and common ancestor, never compare cousin ranks', () => {
  const g = cousins(), before = JSON.stringify(g), path = engine.query(g, 'A', 'B').paths[0];
  assert.equal(path.title, '堂兄弟');
  assert.deepEqual(path.nodes, ['B', 'Q', 'G', 'P', 'A']);
  const focused = engine.project(g, path);
  assert.deepEqual(focused.people.map(p => p.id).sort(), ['A', 'B', 'G', 'P', 'Q']);
  assert.equal(focused.descents.length, 4);
  assert.equal(JSON.stringify(g), before);
  assert.equal(engine.query(g, 'B', 'A').paths[0].title, '堂姊妹');
  g.people.find(p => p.id === 'P').gender = 'F';
  assert.equal(engine.query(g, 'A', 'B').paths[0].title, '表兄弟');
});
test('sibling ranks, uncles, grandparents and nieces are directional', () => {
  const g = cousins();
  assert.equal(engine.query(g, 'P', 'Q').paths[0].title, '長兄');
  assert.equal(engine.query(g, 'Q', 'P').paths[0].title, '四弟');
  assert.equal(engine.query(g, 'P', 'B').paths[0].title, '伯父');
  assert.equal(engine.query(g, 'Q', 'A').paths[0].title, '叔父');
  assert.equal(engine.query(g, 'B', 'P').paths[0].title, '姪女');
  assert.equal(engine.query(g, 'G', 'A').paths[0].title, '祖父');
  g.people.find(p => p.id === 'P').gender = 'F';
  assert.equal(engine.query(g, 'G', 'A').paths[0].title, '外祖父');
});
test('explicit sibling parents also support cousin path without invented ancestors', () => {
  const g = graph([p('P'), p('Q', 'M', [r('sibling', 'P')]), p('A', 'F', [parent('P')]), p('B', 'M', [parent('Q')])]);
  const path = engine.query(g, 'A', 'B').paths[0];
  assert.equal(path.title, '堂姊妹'); assert.equal(path.nodes.length, 4);
});
test('social, absent and self connections', () => {
  const g = graph([p('T'), p('A', 'M', [r('teacher', 'T')]), p('B', 'F', [r('teacher', 'T')]), p('X')]);
  assert.equal(engine.query(g, 'A', 'B').paths[0].title, '同門');
  assert.equal(engine.query(g, 'T', 'B').paths[0].title, '師父');
  assert.equal(engine.query(g, 'B', 'T').paths[0].title, '徒弟');
  assert.equal(engine.query(g, 'X', 'B').status, 'unconnected');
  assert.equal(engine.query(g, 'X', 'X').paths[0].title, '本人');
  assert.equal(engine.query(g, 'missing', 'B').status, 'missing');
});
test('configuration changes alter interpretation; invalid references fail early', () => {
  const custom = structuredClone(config);
  custom.rules.unshift({ id: 'custom', patterns: ['parent/sibling/child'], when: {}, label: '自訂稱謂' });
  assert.equal(create(custom).query(cousins(), 'A', 'B').paths[0].title, '自訂稱謂');
  custom.labels.bad = { ref: 'bad' }; assert.throws(() => create(custom), /循環/);
  assert.throws(() => create({}), /格式/);
});
test('unknown side, non-biological lineage and multiple routes', () => {
  let g = graph([p('G'), p('A', 'M', [r('grandparent', 'G', '親生')])]);
  assert.match(engine.query(g, 'G', 'A').paths[0].title, /外祖父/);
  g = graph([p('P'), p('Q', 'F'), p('A', 'M', [parent('P'), parent('Q')], 1), p('B', 'F', [parent('P'), parent('Q')], 2)]);
  assert.equal(engine.query(g, 'A', 'B').paths.length, 2);
  g.people.find(p => p.id === 'A').relationships[0].kind = '養子女';
  assert.ok(engine.query(g, 'A', 'B').paths.some(p => p.title.includes('含養子女')));
});
