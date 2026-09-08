/* Relationship graph: shared parent/sibling connectors and directed mentorships. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const CHILD_KINDS = ['親生', '過繼', '養子女'];
  // The legend and graph share the same colors, patterns and endpoint symbols.
  const STYLES = {
    spouse: { color: '#aa3d55', width: 6, double: true, label: '婚姻 · 雙線' },
    family: { color: '#59616c', width: 2, label: '共同父母／手足 · 分叉線' },
    親生: { color: '#347045', width: 2.5, end: 'triangle', label: '親生 · 實線箭頭' },
    過繼: { color: '#b15a15', width: 2.5, dash: '12 5', end: 'diamond', label: '過繼 · 長虛線菱形' },
    養子女: { color: '#2963a3', width: 2.5, dash: '6 4', end: 'circle', label: '養子女 · 短虛線空心圓' },
    義子女: { color: '#854791', width: 2.5, dash: '10 4 2 4', end: 'square', label: '義子女 · 點劃線方形' },
    契子女: { color: '#187e80', width: 3, dash: '1 6', end: 'circle', label: '契子女 · 點線空心圓' },
    手足: { color: '#59616c', width: 2, both: true, end: 'circle', label: '手足 · 雙端空心圓' },
    契手足: { color: '#765138', width: 2.5, dash: '8 4 2 4', end: 'diamond', both: true, label: '契手足 · 雙端菱形' },
    師徒: { color: '#1756b0', width: 3, end: 'arrow', label: '師徒 · 師父 → 徒弟' },
    unknown: { color: '#666666', width: 2, dash: '12 2 2 2', label: '未知關係' }
  };
  let selectedId = null;
  let suppressClick = false;
  function chineseNumber(n) {
    const digits = '零一二三四五六七八九';
    if (n < 10) return digits[n];
    if (n < 100) return (n < 20 ? '' : digits[Math.floor(n / 10)]) + '十' + (n % 10 ? digits[n % 10] : '');
    return String(n);
  }
  const orderKey = p => FamilyModel.orderKey(p);
  const ageOrder = (a, b) => FamilyModel.compareOrder(a, b);
  function siblingRole(sibling, person) {
    const order = ageOrder(sibling, person);
    if (!order) return '手足（長幼待確認）';
    if (!['M', 'F'].includes(sibling.gender)) return order < 0 ? '年長手足' : '年幼手足';
    const prefix = sibling.siblingOrder === 1 ? '長' : chineseNumber(sibling.siblingOrder);
    return prefix + (order < 0 ? (sibling.gender === 'M' ? '兄' : '姊') : (sibling.gender === 'M' ? '弟' : '妹'));
  }
  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function svgElement(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }
  function addMarkers(svg, prefix) {
    const defs = svgElement('defs');
    Object.entries(STYLES).forEach(([kind, style]) => {
      if (!style.end) return;
      const marker = svgElement('marker', { id: prefix + kind, viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
      const shape = style.end === 'circle' ? svgElement('circle', { cx: 6, cy: 6, r: 4, fill: '#fbf8f3', stroke: style.color, 'stroke-width': 2 })
        : svgElement('path', { d: style.end === 'diamond' ? 'M 1 6 L 6 1 L 11 6 L 6 11 Z' : style.end === 'square' ? 'M 2 2 H 10 V 10 H 2 Z' : style.end === 'arrow' ? 'M 1 1 L 11 6 L 1 11 L 4 6 Z' : 'M 1 1 L 11 6 L 1 11 Z', fill: style.color });
      marker.appendChild(shape);
      defs.appendChild(marker);
    });
    svg.appendChild(defs);
  }
  function applyStyle(el, kind, prefix) {
    const style = STYLES[kind];
    el.setAttribute('stroke', style.color);
    el.setAttribute('stroke-width', style.width);
    el.setAttribute('stroke-linecap', 'round');
    if (style.dash) el.setAttribute('stroke-dasharray', style.dash);
    if (style.end) el.setAttribute('marker-end', `url(#${prefix}${kind})`);
    if (style.both) el.setAttribute('marker-start', `url(#${prefix}${kind})`);
  }
  function buildLegend() {
    const legend = document.getElementById('relationship-legend');
    if (!legend || legend.children.length) return;
    Object.entries(STYLES).filter(([kind]) => kind !== 'unknown').forEach(([kind, style], index) => {
      const item = element('span', 'legend__item');
      const svg = svgElement('svg', { viewBox: '0 0 64 24', 'aria-hidden': 'true' });
      const prefix = `legend-${index}-`;
      addMarkers(svg, prefix);
      const line = svgElement('path', { d: kind === 'family' ? 'M 32 2 V 10 M 8 21 V 10 H 56 V 21' : 'M 8 12 H 55', fill: 'none' });
      applyStyle(line, kind, prefix);
      svg.appendChild(line);
      if (style.double) svg.appendChild(svgElement('path', { d: 'M 8 12 H 55', stroke: '#fff', 'stroke-width': 2 }));
      item.append(svg, element('span', '', style.label));
      legend.appendChild(item);
    });
  }
  function bindPanning(viewport) {
    if (viewport.dataset.panBound) return;
    viewport.dataset.panBound = 'true';
    let drag = null;
    viewport.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      // Leave native scrollbar interaction to the browser.
      const box = viewport.getBoundingClientRect();
      if (event.clientX >= box.left + viewport.clientWidth || event.clientY >= box.top + viewport.clientHeight) return;
      suppressClick = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
    });
    viewport.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      suppressClick = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
      viewport.scrollLeft = drag.left - dx;
      viewport.scrollTop = drag.top - dy;
      event.preventDefault();
    });
    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
      drag = null;
      viewport.classList.remove('is-dragging');
    }
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
    viewport.addEventListener('lostpointercapture', finish);
    viewport.addEventListener('click', event => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
    }, true);
    viewport.addEventListener('dragstart', event => event.preventDefault());
  }
  function render() {
    const canvas = document.getElementById('tree-canvas');
    if (!canvas) return;
    buildLegend();
    bindPanning(canvas.parentElement);
    canvas.replaceChildren();
    if (typeof FAMILY === 'undefined' || !Array.isArray(FAMILY.people)) {
      canvas.appendChild(element('p', 'tree__error', '正在載入族譜…'));
      return;
    }
    const familySelect = document.getElementById('family-filter');
    if (familySelect) {
      const previous = familySelect.value;
      familySelect.replaceChildren(element('option', '', '所有關係'));
      familySelect.options[0].value = '';
      (FAMILY.unions || []).forEach(u => {
        const parents = (u.partners || []).map(id => FAMILY.people.find(p => p.id === id));
        if (!parents.length || parents.some(p => !p)) return;
        const option = element('option', '', parents.map(p => p.name).join(' ＋ '));
        option.value = u.id;
        familySelect.appendChild(option);
      });
      familySelect.value = [...familySelect.options].some(o => o.value === previous) ? previous : '';
      if (!familySelect.dataset.bound) {
        familySelect.addEventListener('change', () => { selectedId = null; render(); });
        familySelect.dataset.bound = 'true';
      }
    }
    const focus = (FAMILY.unions || []).find(u => u.id === familySelect?.value);
    const focusedIds = focus ? new Set(focus.partners.concat((FAMILY.descents || []).filter(d => d.union === focus.id).map(d => d.child))) : null;
    const people = FAMILY.people.filter(p => !focusedIds || focusedIds.has(p.id));
    const byId = new Map(people.map(p => [p.id, p]));
    const unions = (FAMILY.unions || []).filter(u => {
      if (focus && u.id !== focus.id) return false;
      const valid = Array.isArray(u.partners) && u.partners.length >= 1 && u.partners.length <= 2 && new Set(u.partners).size === u.partners.length && u.partners.every(id => byId.has(id));
      if (!valid) console.warn('略過無效婚姻', u.id);
      return valid;
    });
    const unionById = new Map(unions.map(u => [u.id, u]));
    const descents = (FAMILY.descents || []).filter(d => {
      if (focus && d.union !== focus.id) return false;
      const valid = byId.has(d.child) && unionById.has(d.union);
      if (!valid) console.warn('略過無效親子關係', d);
      return valid;
    });
    const childrenOf = u => descents.filter(d => d.union === u.id).sort((a, b) => orderKey(byId.get(a.child)) - orderKey(byId.get(b.child)));
    const extra = (FAMILY.bonds || []).map(b => ({ from: b.members?.[0], to: b.members?.[1], kind: b.kind }))
      .concat((FAMILY.mentorships || []).map(m => ({ from: m.teacher, to: m.student, kind: '師徒' })))
      .filter(r => {
        if (focus && (!byId.has(r.from) || !byId.has(r.to))) return false;
        const valid = byId.has(r.from) && byId.has(r.to) && r.from !== r.to;
        if (!valid) console.warn('略過無效關係', r);
        return valid;
      });
    const generations = [...new Set(people.map(p => p.gen))].sort((a, b) => a - b);
    const rows = element('div', 'tree__rows');
    const nodes = new Map();
    // Spouse blocks stay together. Sibling blocks use parent-pair order, then numeric order.
    generations.forEach(gen => {
      const visited = new Set(), blocks = [];
      people.filter(p => p.gen === gen).forEach(p => {
        if (visited.has(p.id)) return;
        const block = [];
        function visit(id) {
          if (visited.has(id) || byId.get(id).gen !== gen) return;
          visited.add(id);
          block.push(byId.get(id));
          unions.forEach(u => { if (u.partners.includes(id)) u.partners.forEach(visit); });
        }
        visit(p.id);
        block.sort((a, b) => people.indexOf(a) - people.indexOf(b));
        blocks.push(block);
      });
      function key(block) {
        const links = descents.filter(d => block.some(p => p.id === d.child));
        links.sort((a, b) => unions.indexOf(unionById.get(a.union)) - unions.indexOf(unionById.get(b.union)));
        if (links.length) return [unions.indexOf(unionById.get(links[0].union)), orderKey(byId.get(links[0].child))];
        // Explicit siblings can be ordered together without inventing missing parent edges.
        for (const bond of FAMILY.bonds || []) {
          if (bond.kind !== '手足' || !bond.members.some(id => block.some(p => p.id === id))) continue;
          const other = bond.members.find(id => !block.some(p => p.id === id));
          const parentLink = descents.find(d => d.child === other);
          if (parentLink) return [unions.indexOf(unionById.get(parentLink.union)), orderKey(block[0])];
        }
        return [Infinity, orderKey(block[0])];
      }
      blocks.sort((a, b) => { const x = key(a), y = key(b); return (x[0] - y[0]) || (x[1] - y[1]) || 0; });
      const row = element('div', 'generation');
      row.dataset.gen = gen;
      blocks.forEach(block => {
        const group = element('div', 'couple-group');
        block.forEach(p => {
          const node = element('button', 'person');
          node.type = 'button';
          node.dataset.personId = p.id;
          node.setAttribute('aria-pressed', String(selectedId === p.id));
          node.appendChild(element('span', 'person__name', p.name));
          node.appendChild(element('span', 'person__location', '所在地：' + (p.location || '未填寫')));
          node.appendChild(element('span', 'person__position', '職位：' + (p.position || '未填寫')));
          node.appendChild(element('span', 'person__order', FamilyModel.knownOrder(p) ? '手足序：' + p.siblingOrder : '手足序：未填寫'));
          node.addEventListener('click', () => { selectedId = selectedId === p.id ? null : p.id; showDetails(); });
          nodes.set(p.id, node);
          group.appendChild(node);
        });
        row.appendChild(group);
      });
      row.style.marginBottom = (140 + unions.length * 30 + extra.length * 8) + 'px';
      rows.appendChild(row);
    });
    canvas.style.paddingLeft = (48 + extra.length * 18) + 'px';
    canvas.style.paddingTop = (64 + extra.length * 22) + 'px';
    canvas.appendChild(rows);
    const svg = svgElement('svg', { class: 'tree__connectors', 'aria-hidden': 'true' });
    svg.id = 'tree-connectors';
    canvas.appendChild(svg);
    const rect = canvas.getBoundingClientRect();
    svg.setAttribute('width', rect.width);
    svg.setAttribute('height', rect.height);
    addMarkers(svg, 'edge-');
    function box(id) {
      const r = nodes.get(id).getBoundingClientRect();
      return { x: r.left - rect.left + r.width / 2, top: r.top - rect.top, bottom: r.bottom - rect.top };
    }
    function path(points, kind, ids, role, union) {
      const el = svgElement('polyline', { points: points.map(p => p.join(',')).join(' '), fill: 'none' });
      if (!Object.hasOwn(STYLES, kind)) kind = 'unknown';
      applyStyle(el, kind, 'edge-');
      el.dataset.kind = kind;
      el.dataset.people = ids.join(' ');
      el.dataset.role = role;
      if (union) el.dataset.union = union;
      svg.appendChild(el);
      if (STYLES[kind].double) {
        const inner = svgElement('polyline', { points: el.getAttribute('points'), fill: 'none', stroke: '#fbf8f3', 'stroke-width': 2 });
        inner.dataset.people = ids.join(' ');
        svg.appendChild(inner);
      }
      return el;
    }
    function label(x, y, text, kind, ids) {
      const el = svgElement('text', { x, y, class: 'relation-label', fill: (STYLES[kind] || STYLES.unknown).color });
      el.textContent = text;
      el.dataset.people = ids.join(' ');
      svg.appendChild(el);
    }
    function junction(x, y, ids) {
      const dot = svgElement('circle', { cx: x, cy: y, r: 3, fill: '#8f7b65' });
      dot.dataset.people = ids.join(' ');
      svg.appendChild(dot);
    }
    unions.forEach((u, index) => {
      const a = box(u.partners[0]), b = u.partners[1] ? box(u.partners[1]) : a;
      const marriageY = Math.max(a.bottom, b.bottom) + 22 + index * 16;
      const anchor = (a.x + b.x) / 2;
      const kids = childrenOf(u);
      const familyIds = u.partners.concat(kids.map(d => d.child));
      // Join both parents below their cards; the child stem starts ON this line.
      if (u.partners.length === 1) {
        path([[a.x, a.bottom], [a.x, marriageY]], 'family', familyIds, 'parent-origin', u.id);
      } else {
        path([[a.x, a.bottom], [a.x, marriageY], [b.x, marriageY], [b.x, b.bottom]], u.married ? 'spouse' : 'family', familyIds, 'marriage', u.id);
        label(anchor + 8, marriageY - 8, u.married ? '婚姻' : '共同父母', u.married ? 'spouse' : 'family', familyIds);
      }
      if (kids.length) junction(anchor, marriageY, familyIds);
      [...new Set(kids.map(d => byId.get(d.child).gen))].forEach(gen => {
        const group = kids.filter(d => byId.get(d.child).gen === gen);
        const boxes = group.map(d => box(d.child));
        const barY = Math.min(...boxes.map(c => c.top)) - 58 - index * 18;
        const xs = boxes.map(c => c.x).concat(anchor);
        path([[anchor, marriageY], [anchor, barY]], 'family', familyIds, 'parent-stem', u.id);
        path([[Math.min(...xs), barY], [Math.max(...xs), barY]], 'family', familyIds, 'sibling-bar', u.id);
        junction(anchor, barY, familyIds);
        group.forEach(d => {
          const c = box(d.child);
          path([[c.x, barY], [c.x, c.top]], d.kind, familyIds, 'child', u.id);
          label(c.x + 10, c.top - 14, d.kind, d.kind, familyIds);
          junction(c.x, barY, familyIds);
        });
      });
    });
    extra.forEach((r, index) => {
      const a = box(r.from), b = box(r.to), gutter = 18 + index * 18;
      const fromY = a.top - 32 - index * 22, toY = b.top - 32 - index * 22;
      const points = Math.abs(a.top - b.top) < 1
        ? [[a.x - 42, a.top], [a.x - 42, fromY], [b.x - 42, toY], [b.x - 42, b.top]]
        : [[a.x - 42, a.top], [a.x - 42, fromY], [gutter, fromY], [gutter, toY], [b.x - 42, toY], [b.x - 42, b.top]];
      path(points, r.kind, [r.from, r.to], 'auxiliary');
      label(b.x - 135, toY - 8, r.kind === '師徒' ? '師父 → 徒弟' : r.kind, r.kind, [r.from, r.to]);
    });
    function showDetails() {
      const panel = document.getElementById('relationship-details');
      panel.replaceChildren();
      panel.hidden = !selectedId || !byId.has(selectedId);
      nodes.forEach((node, id) => node.setAttribute('aria-pressed', String(id === selectedId)));
      svg.querySelectorAll('[data-people]').forEach(line => {
        line.style.opacity = selectedId && !line.dataset.people.split(' ').includes(selectedId) ? '0.12' : '1';
      });
      if (!selectedId || !byId.has(selectedId)) {
        panel.appendChild(element('p', '', '點選成員，查看父母、手足長幼與師徒關係，並突顯相關連線。'));
        return;
      }
      const person = byId.get(selectedId);
      const close = element('button', 'details-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', '關閉關係詳情');
      close.addEventListener('click', () => { const id = selectedId; selectedId = null; showDetails(); nodes.get(id)?.focus({ preventScroll: true }); });
      panel.appendChild(close);
      panel.appendChild(element('h2', '', person.name + '的關係'));
      panel.appendChild(element('p', '', '所在地：' + (person.location || '未填寫')));
      panel.appendChild(element('p', '', '職位：' + (person.position || '未填寫')));
      const edit = element('button', 'plain-button edit-member', '編輯成員與關係');
      edit.type = 'button';
      edit.addEventListener('click', () => window.editFamilyMember(person.id));
      panel.appendChild(edit);
      const list = element('ul');
      const add = text => list.appendChild(element('li', '', text));
      const name = id => byId.get(id).name;
      unions.filter(u => u.partners.includes(selectedId)).forEach(u => {
        if (u.married) add('配偶：' + name(u.partners.find(id => id !== selectedId)));
        childrenOf(u).forEach(d => add(d.kind + '子女：' + name(d.child)));
      });
      descents.filter(d => d.child === selectedId).forEach(d => {
        const u = unionById.get(d.union);
        add(d.kind + '關係的父母：' + u.partners.map(name).join('、'));
        if (!CHILD_KINDS.includes(d.kind)) return;
        const siblings = childrenOf(u).filter(s => CHILD_KINDS.includes(s.kind));
        siblings.filter(s => s.child !== selectedId).forEach(s => {
          const sibling = byId.get(s.child), role = siblingRole(sibling, person);
          add(role + '：' + sibling.name + '（' + s.kind + '；共同父母：' + u.partners.map(name).join('、') + '）');
        });
      });
      extra.forEach(r => {
        if (r.from === selectedId) add((r.kind === '師徒' ? '徒弟' : r.kind === '手足' ? siblingRole(byId.get(r.to), person) : r.kind) + '：' + name(r.to));
        if (r.to === selectedId) add((r.kind === '師徒' ? '師父' : r.kind === '手足' ? siblingRole(byId.get(r.from), person) : r.kind) + '：' + name(r.from));
      });
      if (!list.children.length) add('尚未記錄關係。');
      panel.appendChild(list);
    }
    showDetails();
    // On entry or a new family, start at the parents; resizing preserves the user's pan.
    const viewport = canvas.parentElement;
    const scope = focus ? focus.id : '__all__';
    if (viewport.dataset.scope !== scope && people.length) {
      const topPeople = people.filter(p => p.gen === generations[0]).map(p => box(p.id));
      const center = (Math.min(...topPeople.map(p => p.x)) + Math.max(...topPeople.map(p => p.x))) / 2;
      viewport.scrollLeft = Math.max(0, center - viewport.clientWidth / 2);
      viewport.scrollTop = 0;
      viewport.dataset.scope = scope;
    }
  }
  window.renderFamilyTree = render;
  window.selectFamilyMember = id => {
    selectedId = id;
    render();
    const node = [...document.querySelectorAll('.person')].find(n => n.dataset.personId === id);
    node?.scrollIntoView({ block: 'center', inline: 'center' });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
})();
