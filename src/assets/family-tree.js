/* Relationship graph: shared parent/sibling connectors and directed mentorships. */
import { STYLES, element, svgElement, addMarkers, applyStyle, buildLegend } from './family-tree-renderer.mjs';
import { createTreeLayout } from './family-tree-layout.mjs';
import { createViewportController } from './family-tree-viewport.mjs';
import {
  createMemberTooltip,
  bindMobileOverlayAvoidance,
  bindGlobalDismiss,
  bindMobileBackNavigation,
  bindPanning
} from './family-tree-interaction.mjs';

const {
  FamilyModel,
  FamilyDisplayProjection,
  FamilyRelationshipDetails,
  FamilyRelationshipSearch,
  FamilyGenerationBands,
  FamilyConnectorRouting,
  FamilyLabelLayout,
  FamilyApp
} = globalThis;

let FAMILY = FamilyApp?.graph?.() || null;
  const relationshipDetails = FamilyRelationshipDetails.createController();
  let treeZoom;
  const relationshipSearch = FamilyRelationshipSearch.createController({ onChange: options => {
    const anchor = options?.preserveViewport && treeZoom ? treeZoom.getStableViewportAnchor() : null;
    if (!options?.preserveSelection) selectedId = null;
    render();
    if (anchor) requestAnimationFrame(() => treeZoom.restoreViewportAnchor(anchor));
  } });
  const orderKey = FamilyModel.orderKey;
  let selectedId = null;
  const VIEW_STATE_KEY = 'family-tree:canvas-view:v1:' + location.pathname;
  let initialViewState = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch (_) { return null; }
  })();
  let viewStateReady = false, viewStateRestoring = false, viewStateTimer = 0;
  function saveCanvasViewState() {
    clearTimeout(viewStateTimer);
    if (!viewStateReady || viewStateRestoring) return;
    const view = document.querySelector('.tree');
    if (!view || typeof treeZoom === 'undefined') return;
    const querySummary = document.getElementById('relationship-summary');
    if (querySummary && !querySummary.hidden) return;
    try {
      sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
        scale: treeZoom.getScale(), scrollLeft: view.scrollLeft, scrollTop: view.scrollTop,
        filter: document.getElementById('family-filter')?.value || '',
        hideCanvasNames, legendOpen: document.querySelector('.legend-panel')?.open ?? true, savedAt: Date.now()
      }));
    } catch (_) {}
  }
  function scheduleCanvasViewStateSave() {
    if (!viewStateReady || viewStateRestoring) return;
    clearTimeout(viewStateTimer);
    viewStateTimer = setTimeout(saveCanvasViewState, 120);
  }
  function clearCanvasViewState({ reset = true } = {}) {
    clearTimeout(viewStateTimer);
    try { sessionStorage.removeItem(VIEW_STATE_KEY); } catch (_) {}
    initialViewState = null;
    if (reset) {
      viewStateRestoring = true;
      try {
        const view = document.querySelector('.tree');
        if (typeof treeZoom !== 'undefined') treeZoom.setScale(1);
        if (view) { view.scrollLeft = 0; view.scrollTop = 0; }
      } catch (_) {}
      finally { viewStateRestoring = false; }
    }
  }
  let hideCanvasNames = initialViewState?.hideCanvasNames === true;
  const nameToggle = document.getElementById('toggle-canvas-names');
  function syncNameToggle() {
    nameToggle.setAttribute('aria-pressed', String(hideCanvasNames));
    const label = hideCanvasNames ? '顯示族譜姓名' : '隱藏族譜姓名';
    nameToggle.setAttribute('aria-label', label); nameToggle.title = label;
  }
  syncNameToggle();
  nameToggle.addEventListener('click', () => {
    hideCanvasNames = !hideCanvasNames;
    syncNameToggle();
    render();
    scheduleCanvasViewStateSave();
  });
  const memberTooltip = createMemberTooltip({ getHideNames: () => hideCanvasNames });
  treeZoom = createViewportController({
    initialState: initialViewState,
    onSemanticRender: () => render(),
    getSelectedId: () => selectedId,
    hideTooltip: () => memberTooltip.hide(null, true),
    onViewStateChange: () => scheduleCanvasViewStateSave()
  });

  function applyResponsiveDefaults() {
    const legend = document.querySelector('.legend-panel');
    if (!legend || legend.dataset.responsiveDefaultApplied) return;
    legend.dataset.responsiveDefaultApplied = 'true';
    if (typeof initialViewState?.legendOpen === 'boolean') legend.open = initialViewState.legendOpen;
    else if (window.matchMedia?.('(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)').matches) legend.open = false;
    legend.addEventListener('toggle', scheduleCanvasViewStateSave);
  }
  function closeSelectedDetails({ focusCanvas = false } = {}) {
    if (!selectedId) return false;
    selectedId = null;
    render();
    if (focusCanvas) requestAnimationFrame(() => document.querySelector('.tree')?.focus({ preventScroll: true }));
    return true;
  }

  function renderTree() {
    const canvas = document.getElementById('tree-canvas');
    if (!canvas) return;
    buildLegend();
    applyResponsiveDefaults();
    bindPanning(canvas.parentElement, { viewportController: treeZoom, getSelectedId: () => selectedId, closeSelectedDetails });
    bindGlobalDismiss(closeSelectedDetails);
    bindMobileBackNavigation(closeSelectedDetails);
    memberTooltip.hide(null, true);
    canvas.replaceChildren();
    canvas.style.paddingBottom = '';
    if (typeof FAMILY === 'undefined' || !Array.isArray(FAMILY.people)) {
      canvas.appendChild(element('p', 'tree__error', '正在載入族譜…'));
      return;
    }
    const queryView = relationshipSearch.update(FAMILY);
    const graph = queryView.graph;
    const familySelect = document.getElementById('family-filter');
    if (familySelect) {
      const previous = !viewStateReady && initialViewState?.filter ? initialViewState.filter : familySelect.value;
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
        familySelect.addEventListener('change', () => { selectedId = null; render(); scheduleCanvasViewStateSave(); });
        familySelect.dataset.bound = 'true';
      }
    }
    const focus = !queryView.active && (graph.unions || []).find(u => u.id === familySelect?.value);
    const focusedIds = focus ? new Set(focus.partners.concat((graph.descents || []).filter(d => d.union === focus.id).map(d => d.child))) : null;
    // Inspect the full dataset, including inverse relationships. A member does
    // not become "unconnected" merely because a filter hides their relatives.
    const connectedIds = FamilyModel.relationshipMemberIds(FAMILY.people);
    const visibleIds = new Set(graph.people.filter(p => !focusedIds || focusedIds.has(p.id)).map(p => p.id));
    const visibleEdges = new Set((graph.bonds || []).map(b => FamilyModel.intermediateKey(b.kind, b.members)));
    for (const d of graph.descents || []) if (d.kind === '親生' && d.generations === 2) {
      const union = graph.unions.find(u => u.id === d.union);
      union?.partners.forEach(id => visibleEdges.add(FamilyModel.intermediateKey('親生祖孫', [id, d.child])));
    }
    const intermediatePlans = FamilyDisplayProjection.intermediatePlans(FAMILY, { graph: FAMILY }).filter(p => visibleIds.has(p.near) && visibleIds.has(p.other) && visibleEdges.has(p.edgeKey));
    const displayShift = Math.max(0, 1 - Math.min(1, ...intermediatePlans.map(p => p.generation)));
    const uncertainGeneration = Math.max(0, ...FAMILY.people.filter(p => connectedIds.has(p.id)).map(p => p.gen)) + displayShift + 1;
    const layout = createTreeLayout({
      graph,
      fullGraph: FAMILY,
      focus,
      focusedIds,
      connectedIds,
      intermediatePlans,
      displayShift,
      uncertainGeneration,
      model: FamilyModel,
      orderKey
    });
    const {
      people, byId, unions, unionById, descents, childrenOf, completedCousins,
      extra, sharing, generations, firstGeneration, lastGeneration,
      originLanes, childLanes, auxiliaryLanes, auxiliaryLaneStep,
      auxiliaryExtent, upperLanes, lowerLanes, rowGap, generationBlocks
    } = layout;
    if (!people.length) {
      const emptyState = element('section', 'tree-empty-state');
      emptyState.setAttribute('aria-label', '尚未有族譜資料');
      emptyState.appendChild(element('h2', '', '尚未有族譜資料'));
      emptyState.appendChild(element('p', '', '您可以從同一個 Google 帳號同步既有族譜，或從這台裝置開始建立／匯入族譜。'));
      const actions = element('div', 'tree-empty-actions');
      const cloud = element('button', 'primary-button', '從 Google Drive 同步'); cloud.type = 'button';
      cloud.addEventListener('click', async () => {
        if (window.FamilyGoogleDriveSync?.syncNow) {
          const result = await window.FamilyGoogleDriveSync.syncNow({ interactive: true });
          if (result?.outcome === 'error') document.getElementById('cloud-sync')?.click();
        } else document.getElementById('cloud-sync')?.click();
      });
      const add = element('button', 'plain-button', '新增第一位成員'); add.type = 'button';
      add.addEventListener('click', () => document.getElementById('add-member')?.click());
      const importButton = element('button', 'plain-button', '匯入族譜'); importButton.type = 'button';
      importButton.addEventListener('click', () => document.getElementById('import-json')?.click());
      actions.append(cloud, add, importButton);
      emptyState.appendChild(actions);
      canvas.appendChild(emptyState);
      document.getElementById('relationship-details').hidden = true;
      return;
    }
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
          node.setAttribute('aria-pressed', String(selectedId === p.id));
          const nameNode = element('span', 'person__name', hideCanvasNames ? 'OOO' : p.name);
          nameNode.dataset.compactName = hideCanvasNames ? 'OOO' : p.name;
          node.appendChild(nameNode);
          node.appendChild(element('span', 'person__location', '所在地：' + (p.location || '未填寫')));
          node.appendChild(element('span', 'person__position', '職位：' + (p.position || '未填寫')));
          const rankGroups = (graph.rankGroups || []).filter(g => g.members.some(m => m.personId === p.id));
          if (!rankGroups.some(g => g.type === 'sibling')) node.appendChild(element('span', 'person__order', FamilyModel.knownOrder(p) ? '手足序：' + p.siblingOrder : '手足序：未填寫'));
          if (FamilyModel.knownDiscipleOrder(p) && !rankGroups.some(g => g.type === 'fellowDisciple')) node.appendChild(element('span', 'person__order', '師門序：' + p.discipleOrder));
          if (rankGroups.length) {
            const first = rankGroups[0], member = first.members.find(m => m.personId === p.id);
            node.appendChild(element('span', 'person__order', first.name + '：' + (member.order ?? '未填寫') + (rankGroups.length > 1 ? '（另 ' + (rankGroups.length - 1) + ' 組）' : '')));
          }
          memberTooltip.bind(node, p);
          node.addEventListener('click', () => { memberTooltip.hide(node, true); selectedId = selectedId === p.id ? null : p.id; if (selectedId) relationshipDetails.setCollapsed(document.getElementById('relationship-details'), matchMedia('(max-width:700px) and (orientation:portrait)').matches); showDetails(); });
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
    if (queryView.active) {
      const resultSummary = document.getElementById('relationship-summary');
      const mobileResultLayout = matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)').matches;
      if (mobileResultLayout) {
        // Mobile uses a compact floating result bar. Reserve only its fixed top zone
        // in landscape; portrait's normal routing gutter already clears the bar.
        const landscapeResultLayout = matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)').matches;
        if (landscapeResultLayout) {
          const resultTop = parseFloat(getComputedStyle(resultSummary).top) || 0;
          canvasPaddingTop = Math.max(canvasPaddingTop, resultTop + 62);
        }
      } else canvasPaddingTop += resultSummary.offsetHeight;
    }
    canvas.style.paddingTop = canvasPaddingTop + 'px';
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
    function path(points, kind, ids, role, union, group, crossingSegments) {
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
      el.dataset.points = logicalPoints.map(p => p.join(',')).join(' ');
      if (bridgePoints.length) el.dataset.bridges = bridgePoints.map(p => `${p.x},${p.y}`).join(' ');
      if (union) el.dataset.union = union;
      svg.appendChild(el);
      if (STYLES[kind].double) {
        const inner = svgElement('path', { d, fill: 'none', stroke: '#fbf8f3', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' });
        inner.dataset.people = ids.join(' ');
        inner.dataset.group = connectorGroup;
        svg.appendChild(inner);
        pathDecorations.set(el, inner);
      }
      connectorSegments.push(...FamilyConnectorRouting.segments(logicalPoints, { group: connectorGroup, role, kind }));
      return el;
    }
    const lineLabels = [];
    function label(x, y, text, kind, ids) {
      const el = svgElement('text', { x, y, class: 'relation-label', fill: (STYLES[kind] || STYLES.unknown).color });
      el.textContent = text;
      el.dataset.people = ids.join(' ');
      svg.appendChild(el);
      lineLabels.push(el);
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
        label(anchor + 8, marriageY - 8, u.married ? '婚姻' : kids.every(d => d.generations === 2) ? '共同祖父母' : '共同父母', u.married ? 'spouse' : 'family', familyIds);
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
          label(portX + 10, c.top - 14, d.kind + (d.generations === 2 ? '（祖孫）' : ''), d.kind, familyIds);
          junction(portX, barY, familyIds);
        });
      });
    });
    extra.forEach((r, index) => {
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
          path(points, r.kind, ids, 'auxiliary', null, groupKey);
        }
        const last = chain.at(-1);
        label(last.x + 12, last.top - 12, r.planId ? '親生（補中間一代）' : r.kind + '（補親生父母）', r.kind, ids);
        return;
      }
      const offset = 24 + auxiliaryLanes[index] * auxiliaryLaneStep;
      const fromY = a.top - offset, toY = b.top - offset;
      const groupKey = sharing[index].group;
      const fromX = memberPort(from, 'top', groupKey, -42), toX = memberPort(to, 'top', groupKey, -42);
      const points = [[fromX, a.top], ...route([fromX, fromY], [toX, toY], groupKey), [toX, b.top]];
      const routeIds = [...new Set([r.from, r.to, from, to])];
      path(points, r.kind, routeIds, 'auxiliary', null, groupKey);
      label(b.x - 135, toY - (plans.length ? 24 : 8), r.kind === '師徒' ? '師父 → 徒弟' : from !== r.from || to !== r.to ? r.kind + '（補親生父母）' : r.kind, r.kind, routeIds);
    });
    // Replace overlapping strokes with disjoint intervals, retaining exactly the
    // people represented by each interval for selection highlighting.
    for (const group of new Set(sharing.filter(s => s.root).map(s => s.group))) {
      const precedingSegments = connectorSegments.slice(0, connectorSegments.findIndex(s => s.group === group));
      const originals = [...svg.querySelectorAll('path[data-points]')].filter(el => el.dataset.group === group);
      const records = originals.map(el => ({ points: el.dataset.points.split(' ').map(p => p.split(',').map(Number)), people: el.dataset.people.split(' ') }));
      const markers = new Map();
      originals.forEach((el, i) => {
        const points = records[i].points;
        for (const [attribute, point, neighbor] of [['marker-start', points[0], points[1]], ['marker-end', points.at(-1), points.at(-2)]]) {
          if (el.hasAttribute(attribute)) {
            const key = `${point}:${Math.sign(point[0] - neighbor[0])},${Math.sign(point[1] - neighbor[1])}`;
            const prior = markers.get(key);
            markers.set(key, { point, neighbor, marker: el.getAttribute(attribute), people: [...new Set([...(prior?.people || []), ...records[i].people])] });
          }
        }
      });
      const kind = originals[0]?.dataset.kind;
      originals.forEach(el => el.remove());
      FamilyConnectorRouting.sharedSegments(records).forEach(segment => {
        const el = path(segment.points, kind, segment.people, 'auxiliary', null, group, precedingSegments);
        el.removeAttribute('marker-start'); el.removeAttribute('marker-end');
      });
      // Endpoint symbols belong to relationship endpoints, never split intervals.
      for (const { point, neighbor, marker, people } of markers.values()) {
        const dx = point[0] - neighbor[0], dy = point[1] - neighbor[1], length = Math.hypot(dx, dy);
        if (!length) continue;
        const el = svgElement('path', { d: `M ${point[0] - dx / length * .1} ${point[1] - dy / length * .1} L ${point[0]} ${point[1]}`, stroke: STYLES[kind].color, 'marker-end': marker, 'vector-effect': 'non-scaling-stroke' });
        el.dataset.people = people.join(' '); el.dataset.group = group;
        svg.appendChild(el);
      }
    }
    canvas.append(...intermediateButtons);
    // Measure actual glyph bounds (including a margin for the text outline), then
    // position all labels together so later connectors cannot paint over them.
    const measuredLabels = lineLabels.map(el => {
      const b = el.getBBox();
      return { x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6 };
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
    const bridgeRecords = [...svg.querySelectorAll('path[data-points]')].map(el => ({
      el, original: el.getAttribute('d'), group: el.dataset.group,
      people: el.dataset.people.split(' '),
      points: el.dataset.points.split(' ').map(p => p.split(',').map(Number)),
      bridges: (el.dataset.bridges || '').split(' ').filter(Boolean).map(p => { const [x, y] = p.split(',').map(Number); return { x, y }; })
    }));
    function showDetails() {
      const panel = document.getElementById('relationship-details');
      const visibleId = selectedId && byId.has(selectedId) ? selectedId : null;
      nodes.forEach((node, id) => node.setAttribute('aria-pressed', String(id === visibleId)));
      svg.querySelectorAll('[data-people]').forEach(line => {
        line.style.opacity = visibleId && !line.dataset.people.split(' ').includes(visibleId) ? '0.12' : '1';
      });
      const visibleSegments = visibleId ? bridgeRecords.filter(r => r.people.includes(visibleId))
        .flatMap(r => FamilyConnectorRouting.segments(r.points, { group: r.group })) : [];
      bridgeRecords.forEach(record => {
        let d = record.original;
        if (visibleId && record.people.includes(visibleId) && record.bridges.length) {
          const crossings = FamilyConnectorRouting.crossings(record.points, visibleSegments.filter(s => s.group !== record.group), 2.5);
          const bridges = record.bridges.filter(p => crossings.some(c => Math.abs(c.x - p.x) < .1 && Math.abs(c.y - p.y) < .1));
          d = FamilyConnectorRouting.bridgePath(record.points, bridges, 7);
        }
        record.el.setAttribute('d', d);
        pathDecorations.get(record.el)?.setAttribute('d', d);
      });
      relationshipDetails.render(panel, FAMILY, visibleId, {
        onEdit: id => window.editFamilyMember(id),
        onSelect: id => selectFamilyMember(id, { preserveDetailsState: true }),
        onQuery: id => relationshipSearch.startWithMember(id),
        onLocate: id => {
          const node = nodes.get(id);
          node?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
          node?.focus({ preventScroll: true });
        },
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
      viewport.scrollTop = firstRealGeneration > firstGeneration ? Math.max(0, Math.min(...topPeople.map(p => p.top)) - 32) : 0;
      viewport.dataset.scope = scope;
    }
  }
  function restoreCanvasViewStateOnce() {
    if (viewStateReady || !FAMILY?.people) return;
    const state = initialViewState;
    requestAnimationFrame(() => {
      if (viewStateReady) return;
      viewStateRestoring = true;
      try {
        const view = document.querySelector('.tree');
        if (state && view && typeof state.scrollLeft === 'number' && typeof state.scrollTop === 'number') {
          if (typeof state.scale === 'number' && Number.isFinite(state.scale)) treeZoom.setScale(state.scale);
          view.scrollLeft = Math.max(0, state.scrollLeft);
          view.scrollTop = Math.max(0, state.scrollTop);
        }
      } finally {
        viewStateRestoring = false;
        viewStateReady = true;
      }
    });
  }
  function render() {
    treeZoom.beforeRender();
    try {
      return renderTree();
    } finally {
      treeZoom.afterRender();
      restoreCanvasViewStateOnce();
    }
  }
  function selectFamilyMember(id, { preserveDetailsState = false, expandDetails = false } = {}) {
    selectedId = id;
    if (id && !preserveDetailsState) {
      const collapse = expandDetails ? false : matchMedia('(max-width:700px) and (orientation:portrait)').matches;
      relationshipDetails.setCollapsed(document.getElementById('relationship-details'), collapse);
    }
    render();
    const node = [...document.querySelectorAll('.person')].find(item => item.dataset.personId === id);
    node?.scrollIntoView({ block: 'center', inline: 'center' });
    if (id) window.dispatchEvent(new CustomEvent('familymemberviewed', { detail: { id } }));
  }

  bindMobileOverlayAvoidance();
  window.addEventListener('familytreeselect', event => {
    const { id = null, options = {} } = event.detail || {};
    selectFamilyMember(id, options);
  });
  window.addEventListener('familytreeclearview', () => clearCanvasViewState());
  window.addEventListener('familyappchange', event => {
    FAMILY = event.detail?.graph || FamilyApp?.graph?.() || null;
    render();
  });

  const startTree = () => {
    FAMILY = FamilyApp?.graph?.() || FAMILY;
    render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startTree, { once: true });
  else startTree();

  let resizeTimer, pendingResizeAnchor = null;
  let lastViewportShape = { width: window.innerWidth, height: window.innerHeight, landscape: window.innerWidth > window.innerHeight };
  window.addEventListener('resize', () => {
    const nextShape = { width: window.innerWidth, height: window.innerHeight, landscape: window.innerWidth > window.innerHeight };
    const orientationChanged = nextShape.landscape !== lastViewportShape.landscape;
    const widthChanged = Math.abs(nextShape.width - lastViewportShape.width) > 4;
    // A virtual keyboard mostly changes height. Do not rebuild the tree for that;
    // VisualViewport handling keeps modal forms usable without disturbing canvas position.
    if (!orientationChanged && !widthChanged && document.querySelector('dialog[open]')) {
      lastViewportShape = nextShape;
      return;
    }
    if (!pendingResizeAnchor) pendingResizeAnchor = treeZoom.getStableViewportAnchor();
    lastViewportShape = nextShape;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const anchor = pendingResizeAnchor;
      pendingResizeAnchor = null;
      render();
      requestAnimationFrame(() => treeZoom.restoreViewportAnchor(anchor));
    }, 150);
  });
  window.addEventListener('pagehide', saveCanvasViewState);
  document.fonts?.ready.then(() => { if (FAMILY?.people) render(); });
