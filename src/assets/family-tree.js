/* Relationship graph: shared parent/sibling connectors and directed mentorships. */
import { element, buildLegend } from './family-tree-renderer.mjs';
import { renderDiagram } from './family-tree-diagram.mjs';
import { captureScene } from './family-tree-scene.mjs';
import { createMinimap } from './family-tree-minimap.mjs';
import { createExportController } from './family-tree-output-ui.mjs';
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
  FamilyConnectorRouting,
  FamilyApp
} = globalThis;

let FAMILY = FamilyApp?.graph?.() || null;
  const relationshipDetails = FamilyRelationshipDetails.createController();
  let treeZoom, minimap, diagramContext = null;
  const relationshipSearch = FamilyRelationshipSearch.createController({ onChange: options => {
    const anchor = options?.preserveViewport && treeZoom ? treeZoom.getStableViewportAnchor() : null;
    if (options?.preserveViewport && queryScope !== null) {
      treeZoom.prepareScale(1);
      queryViewportAction = 'fit';
    }
    if (!options?.preserveSelection) selectedId = null;
    render();
    if (anchor && queryScope === null) requestAnimationFrame(() => treeZoom.restoreViewportAnchor(anchor));
  } });
  const orderKey = FamilyModel.orderKey;
  let selectedId = null;
  let updateSelectedDetails = null;
  let queryScope = null, beforeQueryView = null, renderView = null, queryViewportAction = null;
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
        hideCanvasNames, showInferredLines, legendOpen: document.querySelector('.legend-panel')?.open ?? true, savedAt: Date.now()
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
    const icon = nameToggle.querySelector('svg');
    icon.dataset.icon = hideCanvasNames ? 'eye-off' : 'eye';
    icon.innerHTML = hideCanvasNames
      ? '<path d="m3 3 18 18M10.6 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a17.5 17.5 0 0 1-3.2 3.9M6.5 6.5C3.7 8.5 2 12 2 12s4 7 10 7a11 11 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'
      : '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
    nameToggle.querySelector('.canvas-name-label').textContent = hideCanvasNames ? '顯示姓名' : '隱藏姓名';
  }
  syncNameToggle();
  nameToggle.addEventListener('click', () => {
    hideCanvasNames = !hideCanvasNames;
    syncNameToggle();
    render();
    scheduleCanvasViewStateSave();
  });
  let showInferredLines = initialViewState?.showInferredLines === true;
  const inferredToggle = document.getElementById('toggle-inferred-lines');
  function syncInferredToggle() {
    inferredToggle.setAttribute('aria-pressed', String(showInferredLines));
    const label = showInferredLines ? '隱藏自動辨別線段' : '顯示自動辨別線段';
    inferredToggle.setAttribute('aria-label', label);
    inferredToggle.querySelector('[data-label]').textContent = label;
  }
  syncInferredToggle();
  inferredToggle.addEventListener('click', () => {
    showInferredLines = !showInferredLines;
    syncInferredToggle();
    updateSelectedDetails?.();
    scheduleCanvasViewStateSave();
  });
  const memberTooltip = createMemberTooltip({ getHideNames: () => hideCanvasNames });
  treeZoom = createViewportController({
    initialState: initialViewState,
    onSemanticRender: () => render(),
    getSelectedId: () => selectedId,
    hideTooltip: () => memberTooltip.hide(null, true),
    onViewStateChange: () => { scheduleCanvasViewStateSave(); minimap?.refresh(); }
  });

  minimap = createMinimap({camera:treeZoom,getSelectedId:() => selectedId});
  createExportController({getContext:() => diagramContext,getGraph:() => FAMILY});
  const guide = element('details','canvas-guide');
  guide.append(element('summary','','圖譜操作說明'),element('p','','拖曳空白處移動畫面；手機可用雙指縮放。從成員詳情或查詢路徑查看關係依據，＋補登缺少的親屬。'));
  const guideActions = element('div','canvas-guide-actions');
  for (const [label,action] of [['看全圖',() => treeZoom.fitView()],['定位人物',() => document.getElementById('show-member-list').click()],['知道了',() => { guide.open = false; }]]) {
    const button = element('button','plain-button',label); button.type = 'button'; button.addEventListener('click',action); guideActions.append(button);
  }
  guide.append(guideActions); document.querySelector('.workspace').append(guide);
  try { guide.open = !localStorage.getItem('family-tree:canvas-guide:v1'); } catch { guide.open = true; }
  guide.addEventListener('toggle', () => { if (!guide.open) try { localStorage.setItem('family-tree:canvas-guide:v1','seen'); } catch {} });
  function applyResponsiveDefaults() {
    const legend = document.querySelector('.legend-panel');
    if (!legend || legend.dataset.responsiveDefaultApplied) return;
    legend.dataset.responsiveDefaultApplied = 'true';
    if (typeof initialViewState?.legendOpen === 'boolean') legend.open = initialViewState.legendOpen;
    else if (window.matchMedia?.('(max-width:700px), (max-width:950px) and (max-height:520px)').matches) legend.open = false;
    legend.addEventListener('toggle', scheduleCanvasViewStateSave);
  }
  function closeSelectedDetails({ focusCanvas = false } = {}) {
    if (!selectedId) return false;
    selectedId = null;
    if (updateSelectedDetails) updateSelectedDetails(); else render();
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
    bindMobileBackNavigation(closeSelectedDetails, () => relationshipDetails.leaveReading());
    memberTooltip.hide(null, true);
    updateSelectedDetails = null;
    canvas.replaceChildren();
    canvas.style.width = canvas.style.minWidth = '';
    canvas.classList.remove('is-empty');
    minimap.setScene(null); diagramContext = null;
    canvas.style.paddingBottom = '';
    if (!Array.isArray(FAMILY?.people)) {
      canvas.appendChild(element('p', 'tree__error', '正在載入族譜…'));
      return;
    }
    const queryView = relationshipSearch.update(FAMILY);
    const nextQueryScope = queryView.active ? queryView.scope : null;
    if (nextQueryScope !== queryScope) {
      if (nextQueryScope !== null) {
        if (queryScope === null) beforeQueryView = renderView;
        treeZoom.prepareScale(1);
        queryViewportAction = 'fit';
      } else if (beforeQueryView) {
        treeZoom.prepareScale(beforeQueryView.scale);
        document.getElementById('family-filter').value = beforeQueryView.filter;
        queryViewportAction = 'restore';
      }
      queryScope = nextQueryScope;
    }
    const graph = queryView.graph;
    const familySelect = document.getElementById('family-filter');
    if (familySelect) {
      const previous = !viewStateReady && initialViewState?.filter ? initialViewState.filter : familySelect.value;
      familySelect.replaceChildren(element('option', '', '全族譜'));
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
    const connectedIds = FamilyModel.relationshipMemberIds(FAMILY.people, FAMILY.bonds);
    const visibleIds = new Set(graph.people.filter(p => !focusedIds || focusedIds.has(p.id)).map(p => p.id));
    const visibleEdges = new Set((graph.bonds || []).map(b => FamilyModel.intermediateKey(b.kind, b.members)));
    for (const d of graph.descents || []) if (d.kind === '親生' && d.generations === 2) {
      const union = graph.unions.find(u => u.id === d.union);
      union?.partners.forEach(id => visibleEdges.add(FamilyModel.intermediateKey('親生祖孫', [id, d.child])));
    }
    const intermediatePlans = FamilyDisplayProjection.intermediatePlans(FAMILY, { graph: FAMILY }).filter(p => visibleIds.has(p.near) && visibleIds.has(p.other) && visibleEdges.has(p.edgeKey));
    const displayShift = FamilyDisplayProjection.generationOffset(FAMILY);
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
      orderKey,
      selectedId
    });
    const {people,byId,firstGeneration} = layout;
    if (!people.length) {
      const emptyState = element('section', 'tree-empty-state');
      canvas.classList.add('is-empty');
      emptyState.setAttribute('aria-label', '尚未有族譜資料');
      emptyState.appendChild(element('h2', '', '尚未有族譜資料'));
      const cloudAvailable = window.FamilyGoogleDriveSync?.isAvailable?.() === true;
      emptyState.appendChild(element('p', '', cloudAvailable ? '新增第一位成員，或同步／匯入既有族譜。' : '新增第一位成員，或匯入先前備份的族譜。'));
      const actions = element('div', 'tree-empty-actions');
      const cloud = element('button', 'primary-button', '從 Google Drive 同步'); cloud.type = 'button';
      cloud.addEventListener('click', async () => {
        if (window.FamilyGoogleDriveSync?.syncNow) {
          const result = await window.FamilyGoogleDriveSync.syncNow({ interactive: true });
          if (result?.outcome === 'error') document.getElementById('cloud-sync')?.click();
        } else document.getElementById('cloud-sync')?.click();
      });
      const add = element('button', 'plain-button member-add-button'); add.type = 'button';
      add.append(document.querySelector('#add-member .member-add-icon').cloneNode(true), element('span', '', '新增第一位成員'));
      add.addEventListener('click', () => document.getElementById('add-member')?.click());
      const importButton = element('button', 'plain-button', '匯入族譜'); importButton.type = 'button';
      importButton.addEventListener('click', () => document.getElementById('import-json')?.click());
      add.classList.replace('plain-button', 'primary-button');
      actions.append(add, importButton);
      if (cloudAvailable) actions.append(cloud);
      emptyState.appendChild(actions);
      canvas.appendChild(emptyState);
      document.getElementById('relationship-details').hidden = true;
      return;
    }
    const {nodes,svg,canvasEvidence,pathDecorations,box,bands} = renderDiagram({canvas,layout,graph,FAMILY,
      intermediatePlans,displayShift,uncertainGeneration,queryView,hideCanvasNames,selectedId,
      onMemberBind:(node,p) => memberTooltip.bind(node,p),
      onMemberSelect:(id,node) => {
        memberTooltip.hide(node,true); selectedId = selectedId === id ? null : id;
        if (selectedId) relationshipDetails.setCollapsed(document.getElementById('relationship-details'),false);
        showDetails(); if (selectedId && treeZoom.isMobileLayout()) treeZoom.focusMember(selectedId);
      }});
    diagramContext = {graph,queryView,ids:[...nodes.keys()],hideNames:hideCanvasNames,
      scopeLabel:queryView.active ? '比較路徑' : focus ? '目前篩選範圍' : '全圖'};
    minimap.setScene(captureScene(canvas,{bands}),diagramContext.scopeLabel);
    const bridgeRecords = [...svg.querySelectorAll('path[data-points]')].map(el => ({
      el, original: el.getAttribute('d'), group: el.dataset.group,
      people: el.dataset.people.split(' '),
      inferred: el.dataset.inferred === 'true',
      detailsOnly: el.dataset.detailsOnly === 'true',
      points: el.dataset.points.split(' ').map(p => p.split(',').map(Number)),
      bridges: (el.dataset.bridges || '').split(' ').filter(Boolean).map(p => { const [x, y] = p.split(',').map(Number); return { x, y }; })
    }));
    function showDetails() {
      const panel = document.getElementById('relationship-details');
      const visibleId = selectedId && byId.has(selectedId) ? selectedId : null;
      // Selection and relationship queries reveal inferred paths without
      // changing the user's overview preference or rebuilding the canvas.
      const revealInferred = showInferredLines || !!visibleId || queryView.active;
      const revealDetails = !!visibleId || queryView.active;
      const connectorVisible = (inferred, detailsOnly) => (!inferred || revealInferred) && (!detailsOnly || revealDetails);
      nodes.forEach((node, id) => node.setAttribute('aria-pressed', String(id === visibleId)));
      svg.querySelectorAll('[data-people]').forEach(line => {
        line.style.display = connectorVisible(line.dataset.inferred === 'true', line.dataset.detailsOnly === 'true') ? '' : 'none';
        line.style.opacity = visibleId && !line.dataset.people.split(' ').includes(visibleId) ? '0.12' : '1';
      });
      canvasEvidence.forEach(button => {
        const related = Boolean(visibleId && button.dataset.people.split(' ').includes(visibleId));
        button.dataset.selected = String(related);
        button.style.display = connectorVisible(button.dataset.inferred === 'true', button.dataset.detailsOnly === 'true') ? '' : 'none';
        button.style.opacity = visibleId ? related ? '1' : '0.25' : queryView.active ? '1' : '0.65';
      });
      const visibleSegments = bridgeRecords.filter(r => connectorVisible(r.inferred, r.detailsOnly) && (!visibleId || r.people.includes(visibleId)))
        .flatMap(r => FamilyConnectorRouting.segments(r.points, { group: r.group }));
      bridgeRecords.forEach(record => {
        let d = record.original;
        if ((visibleId || !revealInferred || !revealDetails) && connectorVisible(record.inferred, record.detailsOnly) && (!visibleId || record.people.includes(visibleId)) && record.bridges.length) {
          const crossings = FamilyConnectorRouting.crossings(record.points, visibleSegments.filter(s => s.group !== record.group), 2.5);
          const bridges = record.bridges.filter(p => crossings.some(c => Math.abs(c.x - p.x) < .1 && Math.abs(c.y - p.y) < .1));
          d = FamilyConnectorRouting.bridgePath(record.points, bridges, 7);
        }
        record.el.setAttribute('d', d);
        pathDecorations.get(record.el)?.setAttribute('d', d);
      });
      relationshipDetails.render(panel, FAMILY, visibleId, {
        onReturnList: () => window.openFamilyMemberList?.({ restore:true }),
        onEdit: id => window.editFamilyMember(id),
        onSelect: id => selectFamilyMember(id, { preserveDetailsState: true }),
        onQuery: id => relationshipSearch.startWithMember(id),
        onLocate: id => {
          const node = nodes.get(id);
          treeZoom.focusMember(id);
          node?.focus({ preventScroll: true });
        },
        onClose: () => {
          const id = selectedId;
          selectedId = null;
          showDetails();
          nodes.get(id)?.focus({ preventScroll: true });
        }
      });
      treeZoom.refreshLayout();
      minimap.refresh();
    }
    updateSelectedDetails = showDetails;
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
          treeZoom.restoreScrollPosition({ left:state.scrollLeft, top:state.scrollTop });
        }
      } finally {
        viewStateRestoring = false;
        viewStateReady = true;
      }
    });
  }
  function render() {
    const view = document.querySelector('.tree');
    renderView = { scale: treeZoom.getScale(), scrollLeft: view.scrollLeft, scrollTop: view.scrollTop,
      filter: document.getElementById('family-filter').value };
    treeZoom.beforeRender({ scene:FAMILY, scope:document.getElementById('family-filter').value });
    try {
      return renderTree();
    } finally {
      treeZoom.afterRender();
      minimap?.refresh();
      const action = queryViewportAction;
      queryViewportAction = null;
      if (action === 'fit') {
        treeZoom.prepareQueryFit();
        queryViewportAction = 'center';
        // Semantic density changes node geometry. Rebuild once at the chosen
        // scale, then center the measured result instead of the old full tree.
        render();
      } else if (action === 'center') {
        treeZoom.centerQuery();
      } else if (action === 'restore' && beforeQueryView) {
        treeZoom.restoreScrollPosition({ left:beforeQueryView.scrollLeft, top:beforeQueryView.scrollTop });
        beforeQueryView = null;
      }
      restoreCanvasViewStateOnce();
    }
  }
  function selectFamilyMember(id, { preserveDetailsState = false } = {}) {
    selectedId = id;
    if (id && !preserveDetailsState) {
      relationshipDetails.setCollapsed(document.getElementById('relationship-details'), false);
    }
    memberTooltip.hide(null, true);
    if (updateSelectedDetails) updateSelectedDetails(); else render();
    if (id) treeZoom.focusMember(id);
    if (id) window.dispatchEvent(new CustomEvent('familymemberviewed', { detail: { id } }));
  }

  bindMobileOverlayAvoidance();
  window.addEventListener('familydetailsreadingchange', event => {
    if (event.detail?.reading || !selectedId) return;
    requestAnimationFrame(() => {
      const panel = document.getElementById('relationship-details');
      if (!panel.hidden && panel.dataset.collapsed !== 'true' && treeZoom.isMobileLayout()) {
        treeZoom.refreshLayout(); treeZoom.focusMember(selectedId);
      }
    });
  });
  window.addEventListener('familytreeselect', event => {
    const { id = null, options = {} } = event.detail || {};
    // A map/list selection may target someone outside the current query or family.
    // Reveal that member before asking the current diagram to render their details.
    if (id && options.expandDetails && ![...document.querySelectorAll('.person[data-person-id]')].some(node => node.dataset.personId === id)) {
      selectedId = id;
      document.getElementById('family-filter').value = '';
      if (queryScope !== null) document.getElementById('relationship-reset').click();
      else render();
    }
    selectFamilyMember(id, options);
  });
  window.addEventListener('familytreeclearview', () => clearCanvasViewState());
  window.addEventListener('familyappchange', event => {
    FAMILY = event.detail?.graph || FamilyApp?.graph?.() || null;
    if (selectedId && !FAMILY?.people.some(person => person.id === selectedId)) selectedId = null;
    memberTooltip.hide(null,true);
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
      if (queryScope !== null) {
        treeZoom.prepareScale(1);
        queryViewportAction = 'fit';
      }
      render();
      if (queryScope === null) requestAnimationFrame(() => {
        const panel = document.getElementById('relationship-details');
        if (selectedId && !panel.hidden && panel.dataset.collapsed !== 'true' && panel.dataset.reading !== 'true' &&
            treeZoom.isMobileLayout()) treeZoom.focusMember(selectedId);
        else treeZoom.restoreViewportAnchor(anchor);
      });
    }, 150);
  });
  window.addEventListener('pagehide', saveCanvasViewState);
  document.fonts?.ready.then(() => { if (FAMILY?.people) render(); });
