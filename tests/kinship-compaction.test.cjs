const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model');
const config = require('../data/kinship-terms.json');
const { create } = require('../assets/kinship');
function fixture(types, overrides = {}) {
  const people = Array.from({ length: types.length + 1 }, (_, i) => ({
    id: 'p' + i, name: 'p' + i, gender: 'M', location: '', position: '', siblingOrder: null,
    relationships: i === types.length ? [] : [{ type: types[i], personId: 'p' + (i + 1), ...(['parent', 'child', 'grandparent', 'grandchild'].includes(types[i]) ? { kind: '親生' } : {}) }],
    ...overrides[i]
  }));
  return Model.build({ schemaVersion: 2, people });
}
const describe = g => create(config).query(g, g.people.at(-1).id, g.people[0].id).paths[0];
test('social prefix plus three paternal ancestors compacts without losing the spouse or graph nodes', () => {
  const graph = fixture(['fellowDisciple', 'parent', 'parent', 'parent', 'spouse'], { 5: { gender: 'F' } });
  const before = JSON.stringify(graph), path = describe(graph);
  assert.equal(path.title, '師兄弟的曾祖父的妻子');
  assert.equal(path.edges.length, 5);
  assert.equal(create(config).project(graph, path).people.length, 6);
  assert.equal(JSON.stringify(graph), before);
  assert(path.notes.includes(config.notes.fellowOrder));
});
test('embedded uncle and spouse rule uses the local parent branch and retains its unknown age note', () => {
  const path = describe(fixture(['teacher', 'parent', 'sibling', 'spouse'], { 4: { gender: 'F' } }));
  assert.equal(path.title, '師父的伯母／嬸嬸');
  assert(path.notes.includes(config.notes.uncleAge));
});
test('fragment sibling age is relative to the fragment base, not the original query member', () => {
  const path = describe(fixture(['fellowDisciple', 'sibling', 'parent', 'parent'], { 0: { siblingOrder: 1 }, 1: { siblingOrder: 3 }, 2: { siblingOrder: 2 } }));
  assert.equal(path.title, '師兄弟的二兄的祖父');
});
test('uncertain side and intermediate gender notes survive partial reduction', () => {
  const path = describe(fixture(['teacher', 'grandparent'], { 2: { gender: 'U' } }));
  assert(path.notes.includes(config.notes.unknownSide));
  assert(path.notes.includes(config.notes.unknownGender));
});
test('adoption markers and explicit contract parent terms are not lost', () => {
  const graph = fixture(['fellowDisciple', 'parent', 'parent', 'parent']);
  graph.people[1].relationships[0].kind = '養子女';
  let path = describe(graph);
  assert.match(path.title, /曾祖父.*養子女/);
  assert(path.notes.includes(config.notes.nonBiological));
  graph.people[1].relationships[0].kind = '契子女';
  path = describe(graph);
  assert.match(path.title, /契父/);
  assert(!path.title.includes('曾祖父'));
  assert(path.notes.includes(config.notes.nonBiological));
});
test('custom rules apply inside a long path and exact whole-path rules keep priority', () => {
  const custom = structuredClone(config);
  custom.rules.unshift({ patterns: ['parent/parent/parent'], label: '自訂曾祖稱呼' });
  const graph = fixture(['fellowDisciple', 'parent', 'parent', 'parent']);
  assert.equal(create(custom).query(graph, 'p4', 'p0').paths[0].title, '師兄弟的自訂曾祖稱呼');
  custom.rules.unshift({ patterns: ['fellowDisciple/parent/parent/parent'], label: '完整規則優先' });
  assert.equal(create(custom).query(graph, 'p4', 'p0').paths[0].title, '完整規則優先');
});
