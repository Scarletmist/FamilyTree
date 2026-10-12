/* Shared measured diagram for the live canvas and full-text export. */
import { STYLES, element, svgElement, addMarkers, applyStyle } from './family-tree-renderer.mjs';
export function renderDiagram({canvas,layout,graph,FAMILY,intermediatePlans,displayShift,uncertainGeneration,
  queryView = {active:false},hideCanvasNames = false,selectedId = null,interactive = true,onMemberBind,onMemberSelect}) {
  const {FamilyModel,FamilyGenerationBands,FamilyConnectorRouting,FamilyLabelLayout} = globalThis;
  const {people,byId,unions,unionById,descents,childrenOf,extra,sharing,generations,firstGeneration,
    originLanes,childLanes,auxiliaryLanes,auxiliaryLaneStep,upperLanes,rowGap,generationBlocks} = layout;
    const rows = element('div', 'tree__rows');
    const nodes = new Map();
    const slots = new Map();
    // Spouse blocks stay together. Sibling blocks use parent-pair order, then numeric order.
    generations.forEach(gen => {
      const blocks = generationBlocks(gen);
      const row = element('div', 'generation');
      row.dataset.gen = gen;
      if (gen === uncertainGeneration) row.dataset.uncertain = 'true';
      if (!blocks.length) row.style.minHeight = '120px';
      blocks.forEach(block => {
        const group = element('div', 'couple-group');
        block.forEach(p => {
          const node = element('button', 'person');
          node.type = 'button';
          if (queryView.active && p.id === queryView.aId) node.classList.add('pair-a');
          if (queryView.active && p.id === queryView.bId) node.classList.add('pair-b');
          node.dataset.personId = p.id;
          if (p.archive) { node.dataset.archived = 'true'; node.append(element('span','person__archive','已封存')); }
          node.setAttribute('aria-pressed', String(selectedId === p.id));
          const nameNode = element('span', 'person__name', hideCanvasNames ? 'OOO' : p.name);
          nameNode.dataset.compactName = hideCanvasNames ? 'OOO' : p.name;
          node.appendChild(nameNode);
          if (p.location) node.appendChild(element('span', 'person__location', '所在地：' + p.location));
          if (p.position) node.appendChild(element('span', 'person__position', '職位：' + p.position));
          const rankGroups = (graph.rankGroups || []).filter(g => g.members.some(m => m.personId === p.id));
          if (!rankGroups.some(g => g.type === 'sibling') && FamilyModel.knownOrder(p)) node.appendChild(element('span', 'person__order', '手足序：' + p.siblingOrder));
          if (FamilyModel.knownDiscipleOrder(p) && !rankGroups.some(g => g.type === 'fellowDisciple')) node.appendChild(element('span', 'person__order', '師門序：' + p.discipleOrder));
          if (rankGroups.length) {
            const first = rankGroups[0], member = first.members.find(m => m.personId === p.id);
            node.appendChild(element('span', 'person__order', first.name + '：' + (member.order ?? '未填寫') + (rankGroups.length > 1 ? '（另 ' + (rankGroups.length - 1) + ' 組）' : '')));
          }
          onMemberBind?.(node,p);
          node.addEventListener('click', () => onMemberSelect?.(p.id,node));
          nodes.set(p.id, node);
          group.appendChild(node);
        });
        row.appendChild(group);
      });
      intermediatePlans.filter(p => p.generation + displayShift === gen).forEach(plan => {
        if (slots.has(plan.slotId)) return;
        const slot = element('div', 'intermediate-slot'); slot.dataset.planId = plan.id;
        slot.setAttribute('aria-hidden', 'true');
        row.appendChild(slot); slots.set(plan.slotId, slot);
      });
      row.style.marginBottom = rowGap(gen) + 'px';
      rows.appendChild(row);
    });
    // Reserve a label rail without changing the existing relationship gutters.
    const generationGutter = 80;
    canvas.style.paddingLeft = (generationGutter + 48) + 'px';
    // The first row needs the same upper routing gutter as subsequent rows.
    // Include room for endpoint symbols, crossing bridges and relation labels.
    const baseCanvasPaddingTop = Math.max(80, upperLanes(firstGeneration) + 40);
    let canvasPaddingTop = baseCanvasPaddingTop;
    canvas.style.paddingTop = canvasPaddingTop + 'px';
    canvas.appendChild(rows);
    const generationLayers = FamilyGenerationBands.render(canvas, [...rows.children]);
    canvas.prepend(generationLayers.backgrounds);
    const svg = svgElement('svg', { class: 'tree__connectors', 'aria-hidden': 'true' });
    if (interactive) svg.id = 'tree-connectors';
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
    const connectorSegments = [];
    const portReservations = new Map();
    let connectorSerial = 0;
    const pathDecorations = new Map();
    function reservePort(id, side, group, baseOffset = 0) {
      const key = `${id}:${side}:${baseOffset}`;
      if (!portReservations.has(key)) portReservations.set(key, new Set());
      portReservations.get(key).add(group);
    }
    unions.forEach(u => {
      const group = `union:${u.id}`;
      u.partners.forEach(id => reservePort(id, 'bottom', group));
      childrenOf(u).forEach(d => reservePort(d.child, 'top', group));
    });
    extra.forEach((r, index) => {
      const group = sharing[index].group;
      reservePort(r.from, 'top', group, -42);
      reservePort(r.to, 'top', group, -42);
    });
    function memberPort(id, side, group, baseOffset = 0, preferredSpacing = 18) {
      const key = `${id}:${side}:${baseOffset}`;
      const groups = [...(portReservations.get(key) || new Set([group]))];
      if (!groups.includes(group)) groups.push(group);
      const index = groups.indexOf(group), count = groups.length;
      const node = nodes.get(id);
      const width = node?.getBoundingClientRect().width || 160;
      const limit = Math.max(12, width / 2 - 12);
      if (count <= 1) return box(id).x + Math.max(-limit, Math.min(limit, baseOffset));
      const span = Math.min((count - 1) * preferredSpacing, limit * 2);
      const step = span / (count - 1);
      const desiredStart = baseOffset - span / 2;
      const start = Math.max(-limit, Math.min(limit - span, desiredStart));
      return box(id).x + start + index * step;
    }
    const otherSegments = group => connectorSegments.filter(segment => segment.group !== group);
    const route = (start, end, group) => FamilyConnectorRouting.route(start, end, cardBoxes, otherSegments(group));
    function path(points, kind, ids, role, union, group, crossingSegments, inferred = false) {
      const connectorGroup = group || (union ? `union:${union}` : `edge:${connectorSerial++}`);
      const logicalPoints = FamilyConnectorRouting.simplify(points);
      const bridgePoints = FamilyConnectorRouting.crossings(logicalPoints, crossingSegments || otherSegments(connectorGroup), 2.5);
      const d = FamilyConnectorRouting.bridgePath(logicalPoints, bridgePoints, 7);
      const el = svgElement('path', { d, fill: 'none' });
      if (!Object.hasOwn(STYLES, kind)) kind = 'unknown';
      applyStyle(el, kind, 'edge-');
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      el.dataset.kind = kind;
      el.dataset.people = ids.join(' ');
      el.dataset.role = role;
      el.dataset.group = connectorGroup;
      if (inferred) el.dataset.inferred = 'true';
      el.dataset.points = logicalPoints.map(p => p.join(',')).join(' ');
      if (bridgePoints.length) el.dataset.bridges = bridgePoints.map(p => `${p.x},${p.y}`).join(' ');
      if (union) el.dataset.union = union;
      svg.appendChild(el);
      if (STYLES[kind].double) {
        const inner = svgElement('path', { d, fill: 'none', stroke: '#fbf8f3', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' });
        inner.dataset.people = ids.join(' ');
        inner.dataset.group = connectorGroup;
        if (inferred) inner.dataset.inferred = 'true';
        svg.appendChild(inner);
        pathDecorations.set(el, inner);
      }
      connectorSegments.push(...FamilyConnectorRouting.segments(logicalPoints, { group: connectorGroup, role, kind }));
      return el;
    }
    const lineLabels = [];
    const canvasEvidence = [], labelProofs = new Map();
    const evidenceResolver = interactive ? globalThis.RelationshipEvidence.create(FAMILY) : {between:() => []};
    function label(x, y, text, kind, ids, inferred = false, proofs = []) {
      const el = svgElement('text', { x, y, class: 'relation-label', fill: (STYLES[kind] || STYLES.unknown).color });
      el.textContent = text + (!interactive && inferred ? '（推導）' : '');
      el.dataset.people = ids.join(' ');
      if (inferred) el.dataset.inferred = 'true';
      svg.appendChild(el);
      lineLabels.push(el);
      if (proofs.some(p => p.evidence.records.some(r => r.relation.source || r.relation.note))) labelProofs.set(el,proofs);
    }
    function junction(x, y, ids) {
      const dot = svgElement('circle', { cx: x, cy: y, r: 3, fill: '#8f7b65' });
      dot.dataset.people = ids.join(' ');
      svg.appendChild(dot);
    }
    const intermediateButtons = [];
    const drawnSlots = new Set();
    function intermediateButton(plan, x, y) {
      if (drawnSlots.has(plan.slotId)) return;
      drawnSlots.add(plan.slotId);
      const button = element('button', 'intermediate-node', '+');
      button.type = 'button'; button.dataset.planId = plan.id;
      button.dataset.near = plan.near;
      button.dataset.gen = plan.generation + displayShift;
      button.setAttribute('aria-label', plan.title); button.title = plan.title;
      button.style.left = x + 'px'; button.style.top = y + 'px';
      button.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') event.stopPropagation(); });
      button.addEventListener('click', event => { event.stopPropagation(); window.addIntermediateMember(plan.id); });
      intermediateButtons.push(button);
    }
    unions.forEach((u, index) => {
      const origins = u.partners.map(box), a = origins[0];
      const marriageY = Math.max(...origins.map(p => p.bottom)) + 22 + originLanes.get(u.id) * 18;
      const anchor = (Math.min(...origins.map(p => p.x)) + Math.max(...origins.map(p => p.x))) / 2;
      const kids = childrenOf(u);
      const familyIds = u.partners.concat(kids.map(d => d.child));
      // Join both parents below their cards; the child stem starts ON this line.
      if (u.partners.length === 1) {
        { const groupKey = `union:${u.id}`; const portX = memberPort(u.partners[0], 'bottom', groupKey); const escapeY = Math.min(marriageY, a.bottom + 10); path([[portX, a.bottom], ...route([portX, escapeY], [a.x, marriageY], groupKey)], 'family', familyIds, 'parent-origin', u.id, groupKey); }
      } else {
        const originXs = origins.map(p => p.x);
        path([[Math.min(...originXs), marriageY], [Math.max(...originXs), marriageY]], u.married ? 'spouse' : 'family', familyIds, 'marriage', u.id);
        origins.forEach((p, partnerIndex) => { const groupKey = `union:${u.id}`; const portX = memberPort(u.partners[partnerIndex], 'bottom', groupKey); const escapeY = Math.min(marriageY, p.bottom + 10); path([[portX, p.bottom], ...route([portX, escapeY], [p.x, marriageY], groupKey)], u.married ? 'spouse' : 'family', familyIds, 'parent-origin', u.id, groupKey); });
        const marriageProofs = u.married ? u.partners.flatMap((id,i) => u.partners.slice(i + 1).flatMap(to => evidenceResolver.between(id,to,['spouse']))) : [];
        label(anchor + 8, marriageY - 8, u.married ? '婚姻' : kids.every(d => d.generations === 2) ? '共同祖父母' : '共同父母', u.married ? 'spouse' : 'family', familyIds, false, marriageProofs);
      }
      if (kids.length) junction(anchor, marriageY, familyIds);
      [...new Set(kids.map(d => byId.get(d.child).gen))].forEach(gen => {
        const group = kids.filter(d => byId.get(d.child).gen === gen);
        const boxes = group.map(d => box(d.child));
        const barY = Math.min(...boxes.map(c => c.top)) - 58 - childLanes.get(`${u.id}:${gen}`) * 18;
        const stemX = anchor;
        const groupKey = `union:${u.id}`;
        const childPorts = new Map(group.map(d => {
          const c = box(d.child), width = nodes.get(d.child).getBoundingClientRect().width;
          return [d.child, FamilyConnectorRouting.attachmentX(memberPort(d.child, 'top', groupKey), c.x - width / 2 + 12, c.x + width / 2 - 12, barY, c.top, otherSegments(groupKey))];
        }));
        const xs = [...childPorts.values(), stemX];
        const stem = route([anchor, marriageY], [stemX, barY], groupKey);
        path(stem, 'family', familyIds, 'parent-stem', u.id, groupKey);
        path([[Math.min(...xs), barY], [Math.max(...xs), barY]], 'family', familyIds, 'sibling-bar', u.id);
        junction(stemX, barY, familyIds);
        group.forEach(d => {
          const c = box(d.child);
          const portX = childPorts.get(d.child);
          const escapeY = Math.max(barY, c.top - 10);
          const childPath = [...route([portX, barY], [portX, escapeY], groupKey), [portX, c.top]];
          path(childPath, d.kind, familyIds, 'child', u.id, groupKey);
          const proofs = u.partners.flatMap(id => evidenceResolver.between(d.child,id,[d.generations === 2 ? 'grandparent' : 'parent']).filter(p => p.relation.kind === d.kind));
          label(portX + 10, c.top - 14, d.kind + (d.generations === 2 ? '（祖孫）' : ''), d.kind, familyIds, false, proofs);
          junction(portX, barY, familyIds);
        });
      });
    });
    extra.forEach((r, index) => {
      const evidenceTypes = r.planId ? ['grandchild','grandparent'] : ({'師徒':['student'],'手足':['sibling'],'契手足':['swornSibling'],'堂親':['tangCousin'],'表親':['biaoCousin'],'師兄弟姊妹':['fellowDisciple']})[r.kind] || [];
      const proofs = evidenceResolver.between(r.from,r.to,evidenceTypes);
      const plans = intermediatePlans.filter(p => r.planId ? p.id === r.planId : p.edgeKey === FamilyModel.intermediateKey(r.kind, [r.from, r.to]));
      const from = r.from, to = r.to;
      const a = box(from), b = box(to);
      if (plans.length) {
        const groupKey = sharing[index].group;
        const real = id => ({ ...box(id), x: memberPort(id, 'top', groupKey, -42), gen: byId.get(id).gen, id });
        const virtual = plan => {
          const slot = slots.get(plan.slotId).getBoundingClientRect();
          const row = slots.get(plan.slotId).parentElement.getBoundingClientRect();
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
              escape: upward ? node.top - 24 - lane * auxiliaryLaneStep : node.bottom + 24 + lane * auxiliaryLaneStep };
          };
          const start = endpoint(left, right), end = endpoint(right, left);
          const points = [[start.x, start.y], ...route([start.x, start.escape], [end.x, end.escape], groupKey), [end.x, end.y]];
          path(points, r.kind, ids, 'auxiliary', null, groupKey, undefined, r.inferred);
        }
        const last = chain.at(-1);
        label(last.x + 12, last.top - 12, r.planId ? '親生（補中間一代）' : r.kind + '（補親生父母）', r.kind, ids, r.inferred, proofs);
        return;
      }
      const offset = 24 + auxiliaryLanes[index] * auxiliaryLaneStep;
      const fromY = a.top - offset, toY = b.top - offset;
      const groupKey = sharing[index].group;
      const fromX = memberPort(from, 'top', groupKey, -42), toX = memberPort(to, 'top', groupKey, -42);
      const points = [[fromX, a.top], ...route([fromX, fromY], [toX, toY], groupKey), [toX, b.top]];
      const routeIds = [...new Set([r.from, r.to, from, to])];
      path(points, r.kind, routeIds, 'auxiliary', null, groupKey, undefined, r.inferred);
      label(b.x - 135, toY - (plans.length ? 24 : 8), r.kind === '師徒' ? '師父 → 徒弟' : from !== r.from || to !== r.to ? r.kind + '（補親生父母）' : r.kind, r.kind, routeIds, r.inferred, proofs);
    });
    // Replace overlapping strokes with disjoint intervals, retaining exactly the
    // people represented by each interval for selection highlighting.
    for (const group of new Set(sharing.filter(s => s.root).map(s => s.group))) {
      const precedingSegments = connectorSegments.slice(0, connectorSegments.findIndex(s => s.group === group));
      const originals = [...svg.querySelectorAll('path[data-points]')].filter(el => el.dataset.group === group);
      const records = originals.map(el => ({ points: el.dataset.points.split(' ').map(p => p.split(',').map(Number)), people: el.dataset.people.split(' '), inferred: el.dataset.inferred === 'true' }));
      const markers = new Map();
      originals.forEach((el, i) => {
        const points = records[i].points;
        for (const [attribute, point, neighbor] of [['marker-start', points[0], points[1]], ['marker-end', points.at(-1), points.at(-2)]]) {
          if (el.hasAttribute(attribute)) {
            const key = `${point}:${Math.sign(point[0] - neighbor[0])},${Math.sign(point[1] - neighbor[1])}`;
            const prior = markers.get(key);
            markers.set(key, { point, neighbor, marker: el.getAttribute(attribute), people: [...new Set([...(prior?.people || []), ...records[i].people])], inferred: records[i].inferred && (!prior || prior.inferred) });
          }
        }
      });
      const kind = originals[0]?.dataset.kind;
      originals.forEach(el => el.remove());
      FamilyConnectorRouting.sharedSegments(records).forEach(segment => {
        const el = path(segment.points, kind, segment.people, 'auxiliary', null, group, precedingSegments, segment.inferred);
        el.removeAttribute('marker-start'); el.removeAttribute('marker-end');
      });
      // Endpoint symbols belong to relationship endpoints, never split intervals.
      for (const { point, neighbor, marker, people, inferred } of markers.values()) {
        const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.hypot(dx, dy);
        if (!length) continue;
        const el = svgElement('path', { d: `M ${point[0] - dx / length * .1} ${point[1] - dy / length * .1} L ${point[0]} ${point[1]}`, stroke: STYLES[kind].color, 'marker-end': marker, 'vector-effect': 'non-scaling-stroke' });
        el.dataset.people = people.join(' '); el.dataset.group = group;
        if (inferred) el.dataset.inferred = 'true';
        svg.appendChild(el);
      }
    }
    canvas.append(...intermediateButtons);
    // Measure actual glyph bounds (including a margin for the text outline), then
    // position all labels together so later connectors cannot paint over them.
    const measuredLabels = lineLabels.map(el => {
      const b = el.getBBox();
      return { x: b.x - 3, y: b.y - 3, width: b.width + 6 + (labelProofs.has(el) ? 42 : 0), height:Math.max(b.height + 6,labelProofs.has(el) ? 36 : 0) };
    });
    const labelObstacles = cardBoxes.map(b => ({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }));
    intermediateButtons.forEach(button => {
      const b = button.getBoundingClientRect();
      labelObstacles.push({ x: b.left - rect.left, y: b.top - rect.top, width: b.width, height: b.height });
    });
    if (queryView.active) {
      const b = document.getElementById('relationship-summary').getBoundingClientRect();
      labelObstacles.push({ x: b.left - rect.left, y: b.top - rect.top, width: b.width, height: b.height });
    }
    const positions = FamilyLabelLayout.place(measuredLabels, labelObstacles, { left: generationGutter, right: rect.width - 12, top: 12, bottom: rect.height - 12 });
    positions.forEach((position, i) => {
      const el = lineLabels[i], original = measuredLabels[i];
      el.setAttribute('x', Number(el.getAttribute('x')) + position.x - original.x);
      el.setAttribute('y', Number(el.getAttribute('y')) + position.y - original.y);
      svg.appendChild(el);
      const proofs = labelProofs.get(el);
      if (proofs) {
        const E = globalThis.RelationshipEvidence, V = globalThis.RelationshipEvidenceView;
        const button = element('button','canvas-evidence','i'); button.type = 'button';
        button.dataset.evidenceKey = proofs.map(p => E.canonical(p.from,p.relation).key).sort().join(';');
        button.dataset.people = [...new Set(proofs.flatMap(p => [p.from,p.relation.personId]))].join(' ');
        button.dataset.inferred = String(proofs.every(p => p.evidence.origin === 'inferred'));
        button.setAttribute('aria-label',`查看${proofs.length}筆關係來源與說明：` + proofs.map(p => E.text(p.evidence)).join('；'));
        const description = element('span','canvas-evidence-description',proofs.map(p => (hideCanvasNames ? '這段關係' : V.sentence(FAMILY,p.from,p.relation)) + '，' + E.text(p.evidence) + (hideCanvasNames ? '' : '。' + p.evidence.records.map(r => '來源：' + (r.relation.source || '未填') + (r.relation.note ? '，說明：' + r.relation.note : '')).join('；'))).join('\n'));
        description.id = 'canvas-proof-' + i; button.setAttribute('aria-describedby',description.id);
        button.title = `查看${proofs.length}筆關係來源與說明`;
        button.style.left = (position.x + position.width - 36) + 'px'; button.style.top = (position.y + position.height / 2) + 'px';
        button.addEventListener('pointerdown',event => { if (event.pointerType === 'mouse') event.stopPropagation(); });
        button.addEventListener('click',event => { event.stopPropagation(); V.open(FAMILY,proofs,{opener:button}); });
        canvas.append(button,description); canvasEvidence.push(button);
      }
    });
    const overflow = Math.max(0, ...positions.map(p => p.y + p.height + 12 - rect.height));
    if (overflow > 0) {
      canvas.style.paddingBottom = (parseFloat(getComputedStyle(canvas).paddingBottom) + overflow) + 'px';
      svg.setAttribute('height', canvas.getBoundingClientRect().height);
      generationLayers.backgrounds.remove();
      Object.assign(generationLayers, FamilyGenerationBands.render(canvas, [...rows.children]));
      canvas.prepend(generationLayers.backgrounds);
    }
    // Keep the pale generation labels above connector lines, but non-interactive.
    canvas.appendChild(generationLayers.labels);
    return {nodes,svg,canvasEvidence,pathDecorations,box,bands:generationLayers.bands};
}
