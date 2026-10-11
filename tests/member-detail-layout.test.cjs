const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../src/assets/member-detail-layout.js');

test('sheet release respects momentum, slow drags and cancellation', () => {
  const release = (height, velocity, extra = {}) => Layout.releaseMode({ height, velocity, viewportHeight: 844, ...extra });
  assert.equal(release(500, 0), 'browse');
  assert.equal(release(500, 1200), 'read');
  assert.equal(release(400, -1200), 'compact');
  assert.equal(release(110, -1200, { cancelled: true, currentMode: 'read' }), 'read');
  assert.equal(release(820, 1200, { cancelled: true }), 'browse');
});

function withInspector(run) {
  const names = ['document', 'matchMedia', 'dispatchEvent', 'addEventListener', 'cancelAnimationFrame'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  class Node {
    constructor() { this.dataset = {}; this.attributes = new Map(); this.listeners = {}; this.style = {}; this.inert = false; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
    focus() { document.activeElement = this; }
  }
  const header = new Node(), tree = new Node(), panel = new Node(), expand = new Node(), path = new Node(), top = new Node();
  let body = new Node(); body.scrollTop = 0;
  tree.inert = true; panel.dataset = { memberId: 'A', collapsed: 'false' }; panel.hidden = false;
  panel.querySelector = selector => selector === '.detail-expand' ? expand : selector === '.relationship-details__body' ? body : top;
  panel.contains = node => node === expand || node === body;
  expand.querySelector = () => path;
  const media = new Map();
  let openDialog = false;
  globalThis.document = { body: { append() {} }, activeElement: null,
    createElement: () => new Node(), querySelectorAll: () => [header, tree], querySelector: () => openDialog ? new Node() : null,
    addEventListener: (name, fn) => top.addEventListener('document:' + name, fn) };
  globalThis.matchMedia = query => {
    if (!media.has(query)) {
      const state = new Node(); state.matches = query === Layout.mobileQuery; media.set(query, state);
    }
    return media.get(query);
  };
  globalThis.dispatchEvent = () => {};
  globalThis.addEventListener = () => {};
  globalThis.cancelAnimationFrame = () => {};
  const controller = Layout.create(panel, { setCollapsed() {} });
  const toggle = () => panel.emit('click', { target: { closest: selector => selector === '.detail-expand' ? expand : null } });
  try {
    run({ controller, panel, expand, header, tree, media, toggle, top, setDialog: value => { openDialog = value; },
      getBody: () => body, redrawBody: () => { body = new Node(); body.scrollTop = 0; } });
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
}

test('reading isolates the background and restores its previous inert state on collapse', () => withInspector(({ controller, panel, expand, header, tree, toggle }) => {
  toggle();
  assert.equal(panel.attributes.get('role'), 'dialog');
  assert.equal(panel.attributes.get('aria-modal'), 'true');
  assert.equal(header.inert, true);
  assert.equal(document.activeElement, expand);
  panel.dataset.collapsed = 'true'; controller.sync();
  assert.equal(panel.dataset.reading, 'false');
  assert.equal(panel.attributes.has('aria-modal'), false);
  assert.equal(header.inert, false);
  assert.equal(tree.inert, true, 'an already inert background must stay inert');
}));

test('desktop transition releases reading and Escape leaves native dialogs in control', () => withInspector(({ panel, header, expand, media, top, toggle, setDialog }) => {
  toggle();
  let prevented = false;
  const key = { key: 'Escape', preventDefault() { prevented = true; }, stopImmediatePropagation() {} };
  setDialog(true); top.emit('document:keydown', key);
  assert.equal(panel.dataset.reading, 'true'); assert.equal(prevented, false);
  setDialog(false); top.emit('document:keydown', key);
  assert.equal(panel.dataset.reading, 'false'); assert.equal(prevented, true);
  assert.equal(document.activeElement, expand);
  toggle();
  const mobile = media.get(Layout.mobileQuery); mobile.matches = false; mobile.emit('change');
  assert.equal(panel.dataset.reading, 'false'); assert.equal(header.inert, false);
}));

test('member scrolling survives redraws and navigation, without sharing offsets between members', () => withInspector(({ controller, panel, getBody, redrawBody }) => {
  controller.afterRender(); getBody().scrollTop = 180; controller.beforeRender();
  redrawBody(); controller.afterRender(); assert.equal(getBody().scrollTop, 180);
  controller.beforeRender(); panel.dataset.memberId = 'B'; redrawBody(); controller.afterRender();
  assert.equal(getBody().scrollTop, 0);
  getBody().scrollTop = 60; controller.beforeRender();
  panel.dataset.memberId = 'A'; redrawBody(); controller.afterRender(); assert.equal(getBody().scrollTop, 180);
}));

test('mobile Back dismisses a native dialog, then reading, then the selected member', async () => {
  const { bindMobileBackNavigation } = await import('../src/assets/family-tree-interaction.mjs');
  const names = ['window', 'document', 'history', 'requestAnimationFrame'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let popstate, reading = true, dismissedMember = 0;
  const dialog = { open: true, dispatchEvent: () => true, close() { this.open = false; } };
  globalThis.window = { matchMedia: () => ({ matches: true }), addEventListener: (_, fn) => { popstate = fn; } };
  globalThis.document = { documentElement: { dataset: {} }, querySelector: () => null, querySelectorAll: () => dialog.open ? [dialog] : [] };
  globalThis.history = { length: 1, state: {}, replaceState(state) { this.state = state; }, pushState(state) { this.state = state; } };
  globalThis.requestAnimationFrame = fn => fn();
  try {
    bindMobileBackNavigation(() => { dismissedMember++; return true; }, () => {
      if (!reading) return false; reading = false; return true;
    });
    popstate(); assert.equal(dialog.open, false); assert.equal(reading, true); assert.equal(dismissedMember, 0);
    popstate(); assert.equal(reading, false); assert.equal(dismissedMember, 0);
    popstate(); assert.equal(dismissedMember, 1);
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
