/* Relationship graph: shared parent/sibling connectors and directed mentorships. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
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
  const relationshipDetails = FamilyRelationshipDetails.createController();
  const orderKey = FamilyModel.orderKey;
  let selectedId = null;
  let suppressClick = false;
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
      const valid = Array.isArray(u.partners) && u.partners.length >= 1 && u.partners.length <= 4 && new Set(u.partners).size === u.partners.length && u.partners.every(id => byId.has(id));
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
    const occupiedGenerations = people.map(p => p.gen);
    const firstGeneration = Math.min(...occupiedGenerations), lastGeneration = Math.max(...occupiedGenerations);
    const generations = people.length ? Array.from({ length: lastGeneration - firstGeneration + 1 }, (_, i) => firstGeneration + i) : [];
    // A skipped generation can contain cards directly under the ancestor anchor.
    // Give each such family its own lane outside every generation's card area.
    const crossGenerationUnions = unions.filter(u => childrenOf(u).some(d => byId.get(d.child).gen - byId.get(u.partners[0]).gen > 1));
    const lowerLanes = 22 + Math.max(0, unions.length - 1) * 16;
    const upperLanes = Math.max(58 + Math.max(0, unions.length - 1) * 18, 32 + Math.max(0, extra.length - 1) * 22);
    const rowGap = Math.max(140 + unions.length * 30 + extra.length * 8, lowerLanes + upperLanes + 48);
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
      if (!blocks.length) row.style.minHeight = '120px';
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
          node.addEventListener('click', () => { selectedId = selectedId === p.id ? null : p.id; if (selectedId) relationshipDetails.setCollapsed(document.getElementById('relationship-details'), false); showDetails(); });
          nodes.set(p.id, node);
          group.appendChild(node);
        });
        row.appendChild(group);
      });
      row.style.marginBottom = rowGap + 'px';
      rows.appendChild(row);
    });
    // Reserve a label rail without changing the existing relationship gutters.
    const generationGutter = 80;
    canvas.style.paddingLeft = (generationGutter + 48 + (extra.length + crossGenerationUnions.length) * 18) + 'px';
    canvas.style.paddingTop = (64 + extra.length * 22) + 'px';
    canvas.appendChild(rows);
    const generationLayers = FamilyGenerationBands.render(canvas, [...rows.children]);
    canvas.prepend(generationLayers.backgrounds);
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
      const origins = u.partners.map(box), a = origins[0];
      const marriageY = Math.max(...origins.map(p => p.bottom)) + 22 + index * 16;
      const anchor = (Math.min(...origins.map(p => p.x)) + Math.max(...origins.map(p => p.x))) / 2;
      const kids = childrenOf(u);
      const familyIds = u.partners.concat(kids.map(d => d.child));
      // Join both parents below their cards; the child stem starts ON this line.
      if (u.partners.length === 1) {
        path([[a.x, a.bottom], [a.x, marriageY]], 'family', familyIds, 'parent-origin', u.id);
      } else {
        const originXs = origins.map(p => p.x);
        path([[Math.min(...originXs), marriageY], [Math.max(...originXs), marriageY]], u.married ? 'spouse' : 'family', familyIds, 'marriage', u.id);
        origins.forEach(p => path([[p.x, p.bottom], [p.x, marriageY]], u.married ? 'spouse' : 'family', familyIds, 'parent-origin', u.id));
        label(anchor + 8, marriageY - 8, u.married ? '婚姻' : kids.every(d => d.generations === 2) ? '共同祖父母' : '共同父母', u.married ? 'spouse' : 'family', familyIds);
      }
      if (kids.length) junction(anchor, marriageY, familyIds);
      [...new Set(kids.map(d => byId.get(d.child).gen))].forEach(gen => {
        const group = kids.filter(d => byId.get(d.child).gen === gen);
        const boxes = group.map(d => box(d.child));
        const barY = Math.min(...boxes.map(c => c.top)) - 58 - index * 18;
        const crossesGeneration = gen - byId.get(u.partners[0]).gen > 1;
        const stemX = crossesGeneration ? generationGutter + 18 + (extra.length + crossGenerationUnions.indexOf(u)) * 18 : anchor;
        const xs = boxes.map(c => c.x).concat(stemX);
        const stem = crossesGeneration
          ? [[anchor, marriageY], [stemX, marriageY], [stemX, barY]]
          : [[anchor, marriageY], [anchor, barY]];
        path(stem, 'family', familyIds, 'parent-stem', u.id);
        path([[Math.min(...xs), barY], [Math.max(...xs), barY]], 'family', familyIds, 'sibling-bar', u.id);
        junction(stemX, barY, familyIds);
        group.forEach(d => {
          const c = box(d.child);
          path([[c.x, barY], [c.x, c.top]], d.kind, familyIds, 'child', u.id);
          label(c.x + 10, c.top - 14, d.kind + (d.generations === 2 ? '（祖孫）' : ''), d.kind, familyIds);
          junction(c.x, barY, familyIds);
        });
      });
    });
    extra.forEach((r, index) => {
      const a = box(r.from), b = box(r.to), gutter = generationGutter + 18 + index * 18;
      const fromY = a.top - 32 - index * 22, toY = b.top - 32 - index * 22;
      const points = Math.abs(a.top - b.top) < 1
        ? [[a.x - 42, a.top], [a.x - 42, fromY], [b.x - 42, toY], [b.x - 42, b.top]]
        : [[a.x - 42, a.top], [a.x - 42, fromY], [gutter, fromY], [gutter, toY], [b.x - 42, toY], [b.x - 42, b.top]];
      path(points, r.kind, [r.from, r.to], 'auxiliary');
      label(b.x - 135, toY - 8, r.kind === '師徒' ? '師父 → 徒弟' : r.kind, r.kind, [r.from, r.to]);
    });
    // Keep the pale generation labels above connector lines, but non-interactive.
    canvas.appendChild(generationLayers.labels);
    function showDetails() {
      const panel = document.getElementById('relationship-details');
      const visibleId = selectedId && byId.has(selectedId) ? selectedId : null;
      nodes.forEach((node, id) => node.setAttribute('aria-pressed', String(id === visibleId)));
      svg.querySelectorAll('[data-people]').forEach(line => {
        line.style.opacity = visibleId && !line.dataset.people.split(' ').includes(visibleId) ? '0.12' : '1';
      });
      relationshipDetails.render(panel, FAMILY, visibleId, {
        onEdit: id => window.editFamilyMember(id),
        onClose: () => {
          const id = selectedId;
          selectedId = null;
          showDetails();
          nodes.get(id)?.focus({ preventScroll: true });
        }
      });
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
    if (id) relationshipDetails.setCollapsed(document.getElementById('relationship-details'), false);
    render();
    const node = [...document.querySelectorAll('.person')].find(n => n.dataset.personId === id);
    node?.scrollIntoView({ block: 'center', inline: 'center' });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
})();
