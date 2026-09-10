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
    師兄弟姊妹: { color: '#247c86', width: 2.5, dash: '5 4', both: true, end: 'square', label: '師兄弟姊妹 · 雙端方形虛線' },
    堂親: { color: '#a06a20', width: 2.5, dash: '10 5', end: 'diamond', both: true, label: '堂親（直接設定）· 雙端菱形長虛線' },
    表親: { color: '#a04476', width: 2.5, dash: '3 5', end: 'diamond', both: true, label: '表親（直接設定）· 雙端菱形短虛線' },
    師徒: { color: '#1756b0', width: 3, end: 'arrow', label: '師徒 · 師父 → 徒弟' },
    unknown: { color: '#666666', width: 2, dash: '12 2 2 2', label: '未知關係' }
  };
  const relationshipDetails = FamilyRelationshipDetails.createController();
  const relationshipSearch = FamilyRelationshipSearch.createController({ onChange: () => { selectedId = null; render(); } });
  const orderKey = FamilyModel.orderKey;
  let selectedId = null;
  let hideCanvasNames = false;
  const nameToggle = document.getElementById('toggle-canvas-names');
  nameToggle.addEventListener('click', () => {
    hideCanvasNames = !hideCanvasNames;
    nameToggle.setAttribute('aria-pressed', String(hideCanvasNames));
    const label = hideCanvasNames ? '顯示族譜姓名' : '隱藏族譜姓名';
    nameToggle.setAttribute('aria-label', label); nameToggle.title = label;
    render();
  });
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
    const queryView = relationshipSearch.update(FAMILY);
    const graph = queryView.graph;
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
    const focus = !queryView.active && (graph.unions || []).find(u => u.id === familySelect?.value);
    const focusedIds = focus ? new Set(focus.partners.concat((graph.descents || []).filter(d => d.union === focus.id).map(d => d.child))) : null;
    // Inspect the full dataset, including inverse relationships. A member does
    // not become "unconnected" merely because a filter hides their relatives.
    const connectedIds = new Set();
    FAMILY.people.forEach(p => p.relationships.forEach(r => { connectedIds.add(p.id); connectedIds.add(r.personId); }));
    const visibleIds = new Set(graph.people.filter(p => !focusedIds || focusedIds.has(p.id)).map(p => p.id));
    const visibleEdges = new Set((graph.bonds || []).map(b => FamilyModel.intermediateKey(b.kind, b.members)));
    for (const d of graph.descents || []) if (d.kind === '親生' && d.generations === 2) {
      const union = graph.unions.find(u => u.id === d.union);
      union?.partners.forEach(id => visibleEdges.add(FamilyModel.intermediateKey('親生祖孫', [id, d.child])));
    }
    const intermediatePlans = FamilyModel.intermediatePlans({ schemaVersion: 2, people: FAMILY.people }).filter(p => visibleIds.has(p.near) && visibleIds.has(p.other) && visibleEdges.has(p.edgeKey));
    const displayShift = Math.max(0, 1 - Math.min(1, ...intermediatePlans.map(p => p.generation)));
    const uncertainGeneration = Math.max(0, ...FAMILY.people.filter(p => connectedIds.has(p.id)).map(p => p.gen)) + displayShift + 1;
    const people = graph.people.filter(p => !focusedIds || focusedIds.has(p.id))
      .map(p => ({ ...p, gen: connectedIds.has(p.id) ? p.gen + displayShift : uncertainGeneration }));
    if (!people.length) {
      canvas.appendChild(element('p', 'tree__error', '尚未新增成員，請點選「新增成員」或匯入族譜 JSON。'));
      document.getElementById('relationship-details').hidden = true;
      return;
    }
    const byId = new Map(people.map(p => [p.id, p]));
    const unions = (graph.unions || []).filter(u => {
      if (focus && u.id !== focus.id) return false;
      const valid = Array.isArray(u.partners) && u.partners.length >= 1 && u.partners.length <= 4 && new Set(u.partners).size === u.partners.length && u.partners.every(id => byId.has(id));
      if (!valid) console.warn('略過無效婚姻', u.id);
      return valid;
    });
    const unionById = new Map(unions.map(u => [u.id, u]));
    const descents = (graph.descents || []).filter(d => {
      if (d.kind === '親生' && d.generations === 2 && intermediatePlans.some(p => p.near === d.child && p.edgeKey.startsWith('親生祖孫|'))) return false;
      if (focus && d.union !== focus.id) return false;
      const valid = byId.has(d.child) && unionById.has(d.union);
      if (!valid) console.warn('略過無效親子關係', d);
      return valid;
    });
    const childrenOf = u => descents.filter(d => d.union === u.id).sort((a, b) => orderKey(byId.get(a.child)) - orderKey(byId.get(b.child)));
    const completedCousins = FamilyModel.completedCousins(graph);
    const extra = (graph.bonds || []).filter(b => !completedCousins.has(FamilyModel.intermediateKey(b.kind, b.members))).map(b => ({ from: b.members?.[0], to: b.members?.[1], kind: b.kind }))
      .concat(intermediatePlans.filter(p => p.edgeKey.startsWith('親生祖孫|')).map(p => ({ from: p.other, to: p.near, kind: '親生', planId: p.id })))
      .concat((graph.mentorships || []).map(m => ({ from: m.teacher, to: m.student, kind: '師徒' })))
      .filter(r => {
        if (focus && (!byId.has(r.from) || !byId.has(r.to))) return false;
        const valid = byId.has(r.from) && byId.has(r.to) && r.from !== r.to;
        if (!valid) console.warn('略過無效關係', r);
        return valid;
      });
    const occupiedGenerations = people.filter(p => connectedIds.has(p.id)).map(p => p.gen).concat(intermediatePlans.map(p => p.generation + displayShift));
    const firstGeneration = Math.min(...occupiedGenerations), lastGeneration = Math.max(...occupiedGenerations);
    const generations = occupiedGenerations.length ? Array.from({ length: lastGeneration - firstGeneration + 1 }, (_, i) => firstGeneration + i) : [];
    if (people.some(p => !connectedIds.has(p.id))) generations.push(uncertainGeneration);
    const lowerLanes = 22 + Math.max(0, unions.length - 1) * 16;
    let auxiliaryCount = 0;
    const auxiliaryLanes = extra.map(r => {
      const count = intermediatePlans.filter(p => r.planId ? p.id === r.planId : p.edgeKey === FamilyModel.intermediateKey(r.kind, [r.from, r.to])).length;
      const lane = auxiliaryCount; auxiliaryCount += count + 1; return lane;
    });
    const upperLanes = Math.max(58 + Math.max(0, unions.length - 1) * 18, 64);
    const rowGap = Math.max(160, Math.max(lowerLanes, 64) + upperLanes + 40);
    const rows = element('div', 'tree__rows');
    const nodes = new Map();
    const slots = new Map();
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
        for (const bond of graph.bonds || []) {
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
      if (gen === uncertainGeneration) row.dataset.uncertain = 'true';
      if (!blocks.length) row.style.minHeight = '120px';
      blocks.forEach(block => {
        const group = element('div', 'couple-group');
        block.forEach(p => {
          const node = element('button', 'person');
          node.type = 'button';
          if (p.notes) node.title = p.notes;
          if (queryView.active && p.id === queryView.aId) node.classList.add('pair-a');
          if (queryView.active && p.id === queryView.bId) node.classList.add('pair-b');
          node.dataset.personId = p.id;
          node.setAttribute('aria-pressed', String(selectedId === p.id));
          node.appendChild(element('span', 'person__name', hideCanvasNames ? 'OOO' : p.name));
          node.appendChild(element('span', 'person__location', '所在地：' + (p.location || '未填寫')));
          node.appendChild(element('span', 'person__position', '職位：' + (p.position || '未填寫')));
          node.appendChild(element('span', 'person__order', FamilyModel.knownOrder(p) ? '手足序：' + p.siblingOrder : '手足序：未填寫'));
          if (FamilyModel.knownDiscipleOrder(p)) node.appendChild(element('span', 'person__order', '師門序：' + p.discipleOrder));
          node.addEventListener('click', () => { selectedId = selectedId === p.id ? null : p.id; if (selectedId) relationshipDetails.setCollapsed(document.getElementById('relationship-details'), false); showDetails(); });
          nodes.set(p.id, node);
          group.appendChild(node);
        });
        row.appendChild(group);
      });
      intermediatePlans.filter(p => p.generation + displayShift === gen).forEach(plan => {
        const slot = element('div', 'intermediate-slot'); slot.dataset.planId = plan.id;
        slot.setAttribute('aria-hidden', 'true');
        row.appendChild(slot); slots.set(plan.id, slot);
      });
      row.style.marginBottom = rowGap + 'px';
      rows.appendChild(row);
    });
    // Reserve a label rail without changing the existing relationship gutters.
    const generationGutter = 80;
    canvas.style.paddingLeft = (generationGutter + 48) + 'px';
    canvas.style.paddingTop = (80 + (queryView.active ? document.getElementById('relationship-summary').offsetHeight : 0)) + 'px';
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
    const cardBoxes = [...nodes.values()].map(node => {
      const r = node.getBoundingClientRect();
      return { left: r.left - rect.left, right: r.right - rect.left, top: r.top - rect.top, bottom: r.bottom - rect.top };
    });
    const route = (start, end) => FamilyConnectorRouting.route(start, end, cardBoxes);
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
    const intermediateButtons = [];
    function intermediateButton(plan, x, y) {
      const button = element('button', 'intermediate-node', '+');
      button.type = 'button'; button.dataset.planId = plan.id;
      button.dataset.near = plan.near;
      button.dataset.gen = plan.generation + displayShift;
      button.setAttribute('aria-label', plan.title); button.title = plan.title;
      button.style.left = x + 'px'; button.style.top = y + 'px';
      button.addEventListener('pointerdown', event => { suppressClick = false; event.stopPropagation(); });
      button.addEventListener('click', event => { event.stopPropagation(); window.addIntermediateMember(plan.id); });
      intermediateButtons.push(button);
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
        const stemX = anchor;
        const xs = boxes.map(c => c.x).concat(stemX);
        const stem = route([anchor, marriageY], [stemX, barY]);
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
      const plans = intermediatePlans.filter(p => r.planId ? p.id === r.planId : p.edgeKey === FamilyModel.intermediateKey(r.kind, [r.from, r.to]));
      const from = r.from, to = r.to;
      const a = box(from), b = box(to);
      if (plans.length) {
        const real = id => ({ ...box(id), x: box(id).x - 42, gen: byId.get(id).gen, id });
        const virtual = plan => {
          const slot = slots.get(plan.id).getBoundingClientRect();
          const row = slots.get(plan.id).parentElement.getBoundingClientRect();
          return { x: slot.left - rect.left + slot.width / 2, y: slot.top - rect.top + slot.height / 2,
            top: row.top - rect.top, bottom: row.bottom - rect.top, gen: plan.generation + displayShift, plan };
        };
        const ordered = r.kind === '手足' || r.planId ? plans : [...plans.filter(p => p.near === r.from), ...plans.filter(p => p.near === r.to)];
        const chain = [real(from), ...ordered.map(virtual), real(to)];
        chain.forEach(node => { if (node.plan) intermediateButton(node.plan, node.x, node.y); });
        const ids = [...new Set([r.from, r.to, from, to])];
        for (let i = 1; i < chain.length; i++) {
          const left = chain[i - 1], right = chain[i], lane = auxiliaryLanes[index] + i - 1;
          const same = left.gen === right.gen;
          const endpoint = (node, other) => {
            const upward = same || node.gen > other.gen;
            return { x: node.x, y: node.plan ? node.y : upward ? node.top : node.bottom,
              escape: upward ? node.top - 24 - (lane % 6) * 6 : node.bottom + 24 + (lane % 6) * 6 };
          };
          const start = endpoint(left, right), end = endpoint(right, left);
          const points = [[start.x, start.y], ...route([start.x, start.escape], [end.x, end.escape]), [end.x, end.y]];
          path(points, r.kind, ids, 'auxiliary');
        }
        const last = chain.at(-1);
        label(last.x + 12, last.top - 12, r.planId ? '親生（補中間一代）' : r.kind + '（補親生父母）', r.kind, ids);
        return;
      }
      const offset = 24 + (auxiliaryLanes[index] % 6) * 6;
      const fromY = a.top - offset, toY = b.top - offset;
      const points = [[a.x - 42, a.top], ...route([a.x - 42, fromY], [b.x - 42, toY]), [b.x - 42, b.top]];
      const routeIds = [...new Set([r.from, r.to, from, to])];
      path(points, r.kind, routeIds, 'auxiliary');
      label(b.x - 135, toY - (plans.length ? 24 : 8), r.kind === '師徒' ? '師父 → 徒弟' : from !== r.from || to !== r.to ? r.kind + '（補親生父母）' : r.kind, r.kind, routeIds);
    });
    canvas.append(...intermediateButtons);
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
    const scope = queryView.active ? 'query:' + queryView.scope : focus ? focus.id : '__all__';
    if (viewport.dataset.scope !== scope && people.length) {
      const firstRealGeneration = Math.min(...people.map(p => p.gen));
      const topPeople = people.filter(p => p.gen === firstRealGeneration).map(p => box(p.id));
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
