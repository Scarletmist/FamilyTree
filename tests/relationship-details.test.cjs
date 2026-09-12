const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../assets/family-model.js');
const Details = require('../assets/relationship-details.js');
const demo = require('../data/family.json');

const graph = Model.build(demo);
const group = (id, type) => Details.buildGroups(graph, id).find(g => g.id === type);
const entry = (id, type, target) => group(id, type)?.entries.find(e => e.personId === target);

test('groups every relation type without changing the underlying graph', () => {
  const before = JSON.stringify(demo);
  const groups = Details.buildGroups(graph, 'p11');
  assert.deepEqual(groups.map(g => g.id), ['parents', 'spouses', 'children', 'siblings', 'students']);
  assert.deepEqual(groups.map(g => g.entries.length), [2, 1, 6, 3, 1]);
  assert.equal(entry('p17', 'teachers', 'p11').name, '陳建國');
  assert.equal(entry('p11', 'spouses', 'p15').name, '吳雅婷');
  assert.equal(entry('p11', 'children', 'p17').badges.includes('親生'), true);
  assert.equal(JSON.stringify(demo), before);
  assert.deepEqual(Details.buildGroups(graph, 'missing'), []);
});

test('siblings merge into one category, keep numeric rank, and preserve child kinds', () => {
  const siblings = group('p11', 'siblings').entries;
  assert.deepEqual(siblings.map(e => e.personId), ['p7', 'p12', 'p24']);
  assert.deepEqual(siblings.map(e => e.role), ['二妹', '三弟', '契手足']);
  assert(siblings[0].badges.includes('親生'));
  assert(siblings[0].contexts.includes('共同父母：陳文彬、王美雲'));
  assert.equal(entry('p3', 'children', 'p23').badges[0], '契子女');
  assert.equal(entry('p3', 'siblings', 'p24'), undefined);
  assert.equal(Details.siblingRole({ gender: 'M', siblingOrder: 1 }, { siblingOrder: 2 }), '長兄');
  assert.equal(Details.siblingRole({ gender: 'F', siblingOrder: 2 }, { siblingOrder: 3 }), '二姊');
  assert.equal(Details.siblingRole({ gender: 'M', siblingOrder: null }, { siblingOrder: 2 }), '手足（長幼待確認）');
});

test('reverse, explicit, and mixed sibling relations are deduplicated', () => {
  const person = (id, name, gender, siblingOrder, relationships = []) => ({ id, name, gender, siblingOrder, location: '', position: '', relationships });
  const data = { schemaVersion: 2, people: [
    person('P', '父親', 'M', null),
    person('A', '甲', 'M', 2, [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'sibling', personId: 'B' }, { type: 'swornSibling', personId: 'B' }]),
    person('B', '乙', 'F', 1, [{ type: 'parent', personId: 'P', kind: '過繼' }])
  ] };
  const mixed = Details.buildGroups(Model.build(data), 'A').find(g => g.id === 'siblings');
  assert.equal(mixed.entries.length, 1);
  assert.equal(mixed.entries[0].role, '長姊');
  assert.deepEqual(mixed.entries[0].badges, ['過繼', '契手足']);
  assert.deepEqual(mixed.entries[0].contexts, ['共同父母：父親']);
});

test('children and students use their own ranks, keep gaps and put unranked members last', () => {
  const member = (id, gender, siblingOrder, discipleOrder, relationships = []) => ({ id, name: id, gender, siblingOrder, discipleOrder, location: '', position: '', relationships });
  const data = { schemaVersion: 2, people: [member('P', 'M', null, null),
    member('C4', 'F', 4, 1, [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'teacher', personId: 'P' }]),
    member('C1', 'M', 1, 4, [{ type: 'parent', personId: 'P', kind: '養子女' }, { type: 'teacher', personId: 'P' }]),
    member('C2', 'M', 2, 2, [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'teacher', personId: 'P' }]),
    member('C0', 'U', null, null, [{ type: 'parent', personId: 'P', kind: '親生' }, { type: 'teacher', personId: 'P' }])
  ] };
  const before = JSON.stringify(data);
  for (const people of [data.people, data.people.slice().reverse()]) {
    const groups = Details.buildGroups(Model.build({ ...data, people }), 'P');
    const children = groups.find(g => g.id === 'children').entries;
    assert.deepEqual(children.map(e => e.personId), ['C1', 'C2', 'C4', 'C0']);
    assert.deepEqual(children.map(e => e.role), ['長子', '二子', '四女', '子女']);
    assert.deepEqual(children[0].badges, ['養子女']);
    const students = groups.find(g => g.id === 'students').entries;
    assert.deepEqual(students.map(e => e.personId), ['C4', 'C2', 'C1', 'C0']);
    assert.deepEqual(students.map(e => e.role), ['大徒弟', '二徒弟', '四徒弟', '徒弟']);
  }
  assert.equal(JSON.stringify(data), before);
});

class FakeElement {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
    this.listeners = {}; this.open = false; this.hidden = false; this.inert = false;
    this.textContent = ''; this.className = ''; this.parentElement = null;
    this.classList = { contains: name => this.className.split(/\s+/).includes(name) };
  }
  append(...nodes) { nodes.forEach(node => { node.parentElement = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children.forEach(node => { node.parentElement = null; }); this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
  focus() { global.document.activeElement = this; }
  contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
  matches(selector) {
    if (selector === 'details[data-group]') return this.tagName === 'details' && !!this.dataset.group;
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    return this.tagName === selector;
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    const nodes = [];
    const visit = node => { node.children.forEach(child => { if (child.matches(selector)) nodes.push(child); visit(child); }); };
    visit(this); return nodes;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

test('drawer preserves disclosure state and selected member, and restores keyboard focus', () => {
  const previous = global.document;
  global.document = { activeElement: null, createElement: tag => new FakeElement(tag), createElementNS: (_, tag) => new FakeElement(tag) };
  try {
    const controller = Details.createController();
    const panel = new FakeElement('section');
    let edited = null, queried = null, closed = false;
    const options = { onEdit: id => { edited = id; }, onQuery: id => { queried = id; }, onClose: () => { closed = true; } };
    controller.render(panel, graph, 'p11', options);
    const content = panel.querySelector('.relationship-details__content');
    const back = panel.querySelector('.details-back');
    const edit = panel.querySelector('.edit-member');
    const query = panel.querySelector('.query-relationship');
    const collapse = panel.querySelector('.details-collapse');
    const tab = panel.querySelector('.relationship-details__tab');
    assert.equal(edit.tagName, 'button');
    assert.equal(edit.type, 'button');
    const top = content.querySelector('.relationship-details__top');
    const header = content.querySelector('.relationship-details__header');
    const actions = content.querySelector('.relationship-details__actions');
    assert.equal(top.children[0], header, 'The title row is the first details row');
    assert.equal(top.children[1], actions, 'Member actions live in a separate second row on desktop');
    assert.equal(header.children[0], back, 'Back navigation reserves the first header control');
    assert.equal(header.children[1].id, 'relationship-details-title', 'The member title owns the flexible header space');
    assert.equal(actions.children[0], edit, 'Edit is the first contextual action');
    assert.equal(actions.children[1], query, 'Relationship query is the second contextual action');
    assert.equal(actions.children[2].classList.contains('details-locate'), true, 'Locate is the third contextual action');
    assert.equal(edit.querySelector('.details-action__label').textContent, '編輯');
    assert.equal(query.querySelector('.details-action__label').textContent, '查關係');
    assert.equal(back.disabled, true);
    assert.equal(back.classList.contains('details-back--placeholder'), true);
    assert.match(edit.attributes['aria-label'], /編輯陳建國/);
    assert.equal(edit.children[0].tagName, 'svg');
    assert.equal(edit.children[0].attributes['aria-hidden'], 'true');
    edit.click(); assert.equal(edited, 'p11');
    assert.match(query.attributes['aria-label'], /查詢其他成員與陳建國的關係/);
    query.click(); assert.equal(queried, 'p11');
    let groups = panel.querySelectorAll('details[data-group]');
    assert.deepEqual(groups.map(d => d.dataset.group), ['parents', 'spouses', 'children', 'siblings', 'students']);
    assert.equal(groups[0].open, true);
    assert(groups.slice(1).every(d => !d.open));
    groups.find(d => d.dataset.group === 'siblings').open = true;
    groups[0].open = false;
    const siblingList = groups.find(d => d.dataset.group === 'siblings').children[1];
    assert(siblingList.children.some(li => li.querySelector('.relationship-entry__role')?.textContent === '二妹'));
    collapse.click();
    assert.equal(controller.isCollapsed(), true);
    assert.equal(panel.dataset.memberId, 'p11');
    assert.equal(panel.dataset.collapsed, 'true');
    assert.equal(content.hidden, true);
    assert.equal(content.inert, true);
    assert.equal(tab.hidden, false);
    assert.equal(tab.attributes['aria-expanded'], 'false');
    assert.equal(global.document.activeElement, tab);
    controller.render(panel, graph, 'p17', options);
    assert.equal(panel.dataset.collapsed, 'true', 'Changing the displayed member preserves the drawer state');
    assert.equal(panel.querySelector('.relationship-details__tab').attributes['aria-label'].includes('陳志偉'), true);
    controller.render(panel, graph, 'p11', options);
    const restoredTab = panel.querySelector('.relationship-details__tab');
    assert.equal(global.document.activeElement, restoredTab, 'Redraw restores focus to the new tab');
    restoredTab.click();
    assert.equal(controller.isCollapsed(), false);
    assert.equal(panel.querySelector('.relationship-details__content').hidden, false);
    assert.equal(panel.querySelector('.relationship-details__tab').hidden, true);
    assert.equal(global.document.activeElement, panel.querySelector('.details-collapse'));
    groups = panel.querySelectorAll('details[data-group]');
    assert.equal(groups.find(d => d.dataset.group === 'siblings').open, true);
    assert.equal(groups.find(d => d.dataset.group === 'parents').open, false);
    panel.querySelector('.edit-member').focus();
    controller.render(panel, graph, 'p11', options);
    assert.equal(global.document.activeElement, panel.querySelector('.edit-member'));
    panel.querySelector('.details-close').click();
    assert.equal(closed, true);
    controller.render(panel, graph, null, options);
    assert.equal(panel.hidden, true);
    assert.equal(panel.children.length, 0);
  } finally { global.document = previous; }
});

test('drawer keeps a short member navigation history for relative-to-relative browsing', () => {
  const previous = global.document;
  global.document = { activeElement: null, createElement: tag => new FakeElement(tag), createElementNS: (_, tag) => new FakeElement(tag) };
  try {
    const controller = Details.createController();
    const panel = new FakeElement('section');
    let options;
    options = { onSelect: id => controller.render(panel, graph, id, options) };
    controller.render(panel, graph, 'p11', options);
    const relative = panel.querySelector('.relationship-entry__person');
    const target = relative.dataset.personId;
    relative.click();
    assert.equal(panel.dataset.memberId, target);
    const back = panel.querySelector('.details-back');
    assert.equal(back.disabled, false);
    assert.equal(back.classList.contains('details-back--placeholder'), false);
    back.click();
    assert.equal(panel.dataset.memberId, 'p11');
    assert.equal(panel.querySelector('.details-back').disabled, true);
  } finally { global.document = previous; }
});

test('local server serves the new relationship details module', async () => {
  const { createFamilyServer } = require('../server.cjs');
  const server = createFamilyServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/assets/relationship-details.js`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.match(await response.text(), /FamilyRelationshipDetails/);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('unlinked member detail omits relationship query shortcut', () => {
  const previous = global.document;
  global.document = { activeElement: null, createElement: tag => new FakeElement(tag), createElementNS: (_, tag) => new FakeElement(tag) };
  try {
    const controller = Details.createController();
    const panel = new FakeElement('section');
    const data = { schemaVersion: 2, people: [
      { id: 'A', name: '甲', gender: 'M', location: '', position: '', siblingOrder: null, discipleOrder: null, notes: '', relationships: [{ type: 'spouse', personId: 'B' }] },
      { id: 'B', name: '乙', gender: 'F', location: '', position: '', siblingOrder: null, discipleOrder: null, notes: '', relationships: [] },
      { id: 'X', name: '未設定', gender: 'U', location: '', position: '', siblingOrder: null, discipleOrder: null, notes: '', relationships: [] }
    ] };
    const localGraph = Model.build(data);
    controller.render(panel, localGraph, 'X', {});
    assert.equal(panel.querySelector('.query-relationship'), null);
    assert(panel.querySelector('.details-query-placeholder'));
    controller.render(panel, localGraph, 'B', {});
    assert(panel.querySelector('.query-relationship'), 'inverse-only related member still gets the query shortcut');
  } finally { global.document = previous; }
});
