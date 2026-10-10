const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../src/assets/family-model.js');
const Projection = require('../src/assets/family-display-projection.js');
const Details = require('../src/assets/relationship-details.js');
const person = (id, relationships = []) => ({ id, name: id, gender: 'M', location: '', position: '', siblingOrder: null, relationships });

async function layoutFor(data) {
  const { createTreeLayout } = await import('../src/assets/family-tree-layout.mjs');
  const graph = Projection.project(Model.build(data));
  const connectedIds = Model.relationshipMemberIds(graph.people);
  const displayShift = Projection.generationOffset(graph);
  return createTreeLayout({
    graph, fullGraph: graph, connectedIds, displayShift,
    intermediatePlans: Projection.intermediatePlans(data, { graph }),
    uncertainGeneration: Math.max(0, ...graph.people.map(p => p.gen)) + displayShift + 1,
    model: Model, orderKey: Model.orderKey
  });
}

for (const kind of Model.KINDS) test(`${kind}: direct grandparent and inverse survive editing and display two generations apart`, () => {
  const data = { schemaVersion: 2, people: [person('G'), person('C', [{ type: 'grandparent', personId: 'G', kind }])] };
  const graph = Projection.project(Model.build(data));
  assert.deepEqual(graph.people.map(p => p.gen), [1, 3]);
  assert.equal(graph.descents[0].generations, 2);
  assert.equal(Details.buildGroups(graph, 'C')[0].id, 'grandparents');
  assert.equal(Details.buildGroups(graph, 'G')[0].id, 'grandchildren');
  if (kind === '契子女') assert.equal(Details.buildGroups(graph, 'C')[0].entries[0].role, '契祖父');
  const inverse = Model.relationshipsFor(data, 'G');
  assert.deepEqual(inverse, [{ type: 'grandchild', personId: 'C', kind }]);
  const edited = Model.replaceMember(data, { ...data.people[0], relationships: inverse });
  assert.equal(edited.people[1].relationships.length, 0);
  assert.deepEqual(Model.build(JSON.parse(JSON.stringify(edited))).descents, graph.descents);
  assert.equal(Model.build(Model.replaceMember(edited, { ...edited.people[0], relationships: [] })).descents.length, 0);
});

test('shared grandparents do not imply siblings or duplicate sibling orders; allow four grandparents', () => {
  const grandparents = ['A', 'B', 'C', 'D'].map(id => person(id));
  const relations = grandparents.map(p => ({ type: 'grandparent', personId: p.id, kind: '親生' }));
  const data = { schemaVersion: 2, people: [...grandparents, { ...person('E', relations), siblingOrder: 1 }, { ...person('F', relations), siblingOrder: 1 }] };
  const groups = Details.buildGroups(Model.build(data), 'E');
  assert.deepEqual(groups.map(g => g.id), ['grandparents']);
  assert.equal(groups[0].entries.length, 4);
});

test('direct grandparent agrees with a two-step path and rejects contradictory directions', () => {
  const data = { schemaVersion: 2, people: [person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]), person('C', [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'grandparent', personId: 'G', kind: '契子女' }])] };
  Model.build(data);
  data.people[2].relationships[1].type = 'grandchild';
  assert.throws(() => Model.build(data), /矛盾/);
  assert.throws(() => Model.validateMember(person('X', [{ type: 'grandparent', personId: 'G' }])), /類型/);
});

test('intermediate grandparent connectors replace unused family origins in both directions', async () => {
  for (const type of ['grandparent', 'grandchild']) for (const count of [1, 2, 4]) {
    const ancestors = Array.from({ length: count }, (_, i) => person('G' + i));
    const child = person('C');
    if (type === 'grandparent') child.relationships = ancestors.map(p => ({ type, personId: p.id, kind: '親生' }));
    else ancestors.forEach(p => p.relationships.push({ type, personId: child.id, kind: '親生' }));
    const data = { schemaVersion: 2, people: [...ancestors, child] };
    const before = JSON.stringify(data);
    const layout = await layoutFor(data);
    assert.equal(layout.unions.length, 0, `${type}: ${count} grandparents must not leave an origin stub`);
    assert.equal(layout.unionById.size, 0);
    assert.equal(layout.originLanes.size, 0);
    assert.equal(layout.descents.length, 0);
    assert.equal(layout.extra.length, count);
    assert(layout.extra.every(edge => edge.planId));
    assert.equal(layout.graph.unions.length, 1, 'the domain relationship remains available');
    assert.equal(JSON.stringify(data), before);
  }
});

test('replacing grandparent descents preserves marriage and other children of the same family', async () => {
  const grandparent = personId => ({ type: 'grandparent', personId, kind: '親生' });
  const married = { schemaVersion: 2, people: [person('G', [{ type: 'spouse', personId: 'H' }]), person('H'), person('C', [grandparent('G'), grandparent('H')])] };
  const marriageLayout = await layoutFor(married);
  assert.equal(marriageLayout.unions.length, 1);
  assert.equal(marriageLayout.unions[0].married, true);
  assert.equal(marriageLayout.descents.length, 0);
  assert.equal(marriageLayout.extra.length, 2);

  const shared = { schemaVersion: 2, people: [person('G'), person('P', [{ type: 'parent', personId: 'G', kind: '親生' }]), person('C', [grandparent('G')])] };
  const sharedLayout = await layoutFor(shared);
  assert.equal(sharedLayout.unions.length, 1);
  assert.deepEqual(sharedLayout.childrenOf(sharedLayout.unions[0]).map(d => d.child), ['P']);
  assert.equal(sharedLayout.extra.length, 1);
});

test('grandparent origins remain when no intermediate connector replaces them', async () => {
  for (const kind of Model.KINDS) {
    const data = { schemaVersion: 2, people: [person('G'), person('C', [{ type: 'grandparent', personId: 'G', kind }])] };
    if (kind === '親生') data.ignoredIntermediatePlans = Model.intermediatePlans(data).map(plan => plan.id);
    const layout = await layoutFor(data);
    assert.equal(layout.unions.length, 1, kind);
    assert.equal(layout.descents.length, 1, kind);
    assert.equal(layout.extra.length, 0, kind);
  }
});
