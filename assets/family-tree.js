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
  window.clearFamilyViewState = clearCanvasViewState;
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
  treeZoom = (() => {
    const MOBILE_QUERY = '(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)';
    const MAX_SCALE = 2;
    const SEMANTIC_PROFILES = {
      desktop: [
        { max: 0.40, mode: 'overview' },
        { max: 0.55, mode: 'compact' },
        { max: 0.70, mode: 'condensed' },
        { max: 0.85, mode: 'medium' },
        { max: 1.10, mode: 'normal' },
        { max: 1.40, mode: 'detail' },
        { max: Infinity, mode: 'inspect' }
      ],
      tablet: [
        { max: 0.45, mode: 'overview' },
        { max: 0.60, mode: 'compact' },
        { max: 0.80, mode: 'condensed' },
        { max: 1.10, mode: 'normal' },
        { max: Infinity, mode: 'detail' }
      ],
      'mobile-portrait': [
        { max: 0.55, mode: 'compact' },
        { max: 0.75, mode: 'condensed' },
        { max: 1.10, mode: 'normal' },
        { max: Infinity, mode: 'detail' }
      ],
      'mobile-landscape': [
        { max: 0.45, mode: 'overview' },
        { max: 0.60, mode: 'compact' },
        { max: 0.80, mode: 'condensed' },
        { max: 1.10, mode: 'normal' },
        { max: Infinity, mode: 'detail' }
      ]
    };
    const PROFILE_MIN_SCALE = { desktop: 0.25, tablet: 0.30, 'mobile-portrait': 0.50, 'mobile-landscape': 0.40 };
    const STEP = 0.1;
    const SEMANTIC_COMMIT_DELAY = 140;
    const SEMANTIC_LABELS = { overview:'總覽', compact:'姓名', condensed:'精簡', medium:'簡要', normal:'完整', detail:'詳細', inspect:'檢視' };
    let scale = Number(initialViewState?.scale) || 1;
    let naturalWidth = 0;
    let naturalHeight = 0;
    let rendering = false;
    let generationLabelFrame = 0;
    let semanticMode = null;
    let semanticProfile = null;
    let semanticTimer = 0;
    let pendingSemanticRestore = null;
    let semanticGestureActive = false;
    let stableViewportAnchor = null;
    let stableAnchorFrame = 0;
    let semanticHudTimer = 0;
    let wheelGestureTimer = 0;

    const viewport = () => document.querySelector('.tree');
    const canvas = () => document.getElementById('tree-canvas');
    const spacer = () => document.getElementById('tree-zoom-spacer');
    const isMobileLayout = () => matchMedia(MOBILE_QUERY).matches;
    function semanticProfileForViewport() {
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const coarse = matchMedia('(pointer:coarse)').matches;
      if (coarse && width <= 950 && height <= 520) return 'mobile-landscape';
      if (coarse && width <= 700) return 'mobile-portrait';
      if ((coarse && width < 1366) || width < 1100) return 'tablet';
      return 'desktop';
    }
    const minScale = () => PROFILE_MIN_SCALE[semanticProfileForViewport()] || 0.25;
    const roundScale = value => Math.round(value * 1000) / 1000;
    const clampScale = value => Math.max(minScale(), Math.min(MAX_SCALE, roundScale(value)));

    function semanticDisplay(value = scale) {
      const state = semanticStateForScale(value);
      return { ...state, label: SEMANTIC_LABELS[state.mode] || state.mode, percent: Math.round(value * 100) };
    }

    function showSemanticHud() {
      const hud = document.getElementById('tree-semantic-zoom-hud');
      if (!hud || !isMobileLayout()) return;
      const display = semanticDisplay();
      hud.textContent = `${display.percent}% · ${display.label}`;
      hud.classList.add('is-visible');
      clearTimeout(semanticHudTimer);
      semanticHudTimer = setTimeout(() => hud.classList.remove('is-visible'), 950);
    }

    function updateControls({ transient = false } = {}) {
      const value = document.getElementById('tree-zoom-value');
      const out = document.getElementById('tree-zoom-out');
      const plus = document.getElementById('tree-zoom-in');
      const display = semanticDisplay();
      if (value) {
        value.textContent = `${display.percent}%`;
        value.dataset.semanticLabel = display.label;
        value.setAttribute('aria-label', `目前族譜縮放 ${display.percent}%，${display.label}資訊；按下可重設為 100%`);
        value.title = `目前 ${display.percent}% · ${display.label}；按下重設為 100%`;
      }
      if (out) out.disabled = scale <= minScale() + .001;
      if (plus) plus.disabled = scale >= MAX_SCALE - .001;
      if (transient) showSemanticHud();
    }

    function updateSpacer() {
      const view = viewport(), root = canvas(), space = spacer();
      if (!view || !root || !space) return;
      naturalWidth = Math.max(root.offsetWidth, root.scrollWidth);
      naturalHeight = Math.max(root.offsetHeight, root.scrollHeight);
      space.style.width = Math.max(view.clientWidth, Math.ceil(naturalWidth * scale)) + 'px';
      space.style.height = Math.max(view.clientHeight, Math.ceil(naturalHeight * scale)) + 'px';
    }

    function updateGenerationLabelPosition() {
      const view = viewport(), root = canvas();
      if (!view || !root) return;
      const screenInset = 0;
      const labelWidth = isMobileLayout() ? 34 : 48;
      const width = naturalWidth || Math.max(root.offsetWidth, root.scrollWidth);
      const safeScale = Math.max(.001, scale);
      const logicalInset = screenInset / safeScale;
      const requested = (view.scrollLeft + screenInset) / safeScale;
      const maxLeft = Math.max(logicalInset, width - labelWidth - logicalInset);
      const left = Math.max(logicalInset, Math.min(maxLeft, requested));
      root.style.setProperty('--generation-label-left', `${left}px`);
    }

    function scheduleGenerationLabelPosition() {
      if (generationLabelFrame) return;
      generationLabelFrame = requestAnimationFrame(() => {
        generationLabelFrame = 0;
        updateGenerationLabelPosition();
      });
    }

    function semanticStateForScale(value = scale) {
      const profile = semanticProfileForViewport();
      const levels = SEMANTIC_PROFILES[profile] || SEMANTIC_PROFILES.desktop;
      const level = levels.find(item => value <= item.max + .001) || levels[levels.length - 1];
      return { profile, mode: level.mode };
    }

    function semanticModeForScale(value = scale) {
      return semanticStateForScale(value).mode;
    }

    function applySemanticMode(mode, profile) {
      const root = canvas();
      if (!root) return;
      const state = mode && profile ? { mode, profile } : semanticStateForScale(scale);
      semanticMode = state.mode;
      semanticProfile = state.profile;
      root.dataset.zoomLevel = state.mode;
      root.dataset.zoomProfile = state.profile;
      root.classList.remove('is-desktop-name-only');
    }

    function clearSemanticTimer() {
      if (!semanticTimer) return;
      clearTimeout(semanticTimer);
      semanticTimer = 0;
    }

    function armSemanticCommit() {
      clearSemanticTimer();
      if (semanticGestureActive || !pendingSemanticRestore) return;
      semanticTimer = setTimeout(() => {
        semanticTimer = 0;
        const pending = pendingSemanticRestore;
        const current = semanticStateForScale(scale);
        if (!pending || semanticGestureActive || pending.mode !== current.mode || pending.profile !== current.profile || (pending.mode === semanticMode && pending.profile === semanticProfile)) return;
        semanticMode = pending.mode;
        semanticProfile = pending.profile;
        render();
      }, SEMANTIC_COMMIT_DELAY);
    }

    function scheduleSemanticCommit(logical, anchor) {
      const target = semanticStateForScale(scale);
      if (target.mode === semanticMode && target.profile === semanticProfile) {
        clearSemanticTimer();
        pendingSemanticRestore = null;
        return;
      }
      const width = Math.max(1, naturalWidth);
      const height = Math.max(1, naturalHeight);
      pendingSemanticRestore = {
        mode: target.mode,
        profile: target.profile,
        ratioX: Math.max(0, Math.min(1, logical.x / width)),
        ratioY: Math.max(0, Math.min(1, logical.y / height)),
        anchor: { x: anchor.x, y: anchor.y }
      };
      armSemanticCommit();
    }

    function beginSemanticGesture() {
      semanticGestureActive = true;
      clearSemanticTimer();
    }

    function endSemanticGesture() {
      semanticGestureActive = false;
      armSemanticCommit();
    }

    function applyScale() {
      const root = canvas();
      if (!root) return;
      root.style.transform = `scale(${scale})`;
      updateSpacer();
      updateGenerationLabelPosition();
    }

    function positionLogicalAtAnchor(logical, anchor) {
      const view = viewport();
      if (!view) return;
      view.scrollLeft = Math.max(0, logical.x * scale - anchor.x);
      view.scrollTop = Math.max(0, logical.y * scale - anchor.y);
    }

    function setScaleAroundLogical(next, logical, anchor) {
      const view = viewport();
      if (!view) return scale;
      next = clampScale(next);
      scale = next;
      applyScale();
      positionLogicalAtAnchor(logical, anchor);
      updateGenerationLabelPosition();
      updateControls({ transient: isMobileLayout() });
      memberTooltip.hide(null, true);
      scheduleSemanticCommit(logical, anchor);
      scheduleCanvasViewStateSave();
      return scale;
    }

    function setScale(next, anchor) {
      const view = viewport();
      if (!view) return scale;
      next = clampScale(next);
      const anchorX = anchor?.x ?? view.clientWidth / 2;
      const anchorY = anchor?.y ?? view.clientHeight / 2;
      if (Math.abs(next - scale) < .001) return scale;
      const logical = {
        x: (view.scrollLeft + anchorX) / scale,
        y: (view.scrollTop + anchorY) / scale
      };
      return setScaleAroundLogical(next, logical, { x: anchorX, y: anchorY });
    }

    function fitWidth() {
      const view = viewport(), root = canvas();
      if (!view || !root) return;
      const width = naturalWidth || Math.max(root.offsetWidth, root.scrollWidth);
      if (!width) return;
      const target = Math.min(1, Math.max(minScale(), (view.clientWidth - 24) / width));
      setScale(target, { x: view.clientWidth / 2, y: 0 });
      view.scrollLeft = Math.max(0, (width * scale - view.clientWidth) / 2);
      view.scrollTop = 0;
      updateGenerationLabelPosition();
    }

    function fitView() {
      const view = viewport(), root = canvas();
      if (!view || !root) return;
      const width = naturalWidth || Math.max(root.offsetWidth, root.scrollWidth);
      const height = naturalHeight || Math.max(root.offsetHeight, root.scrollHeight);
      if (!width || !height) return;
      const availableWidth = Math.max(1, view.clientWidth - 24);
      const availableHeight = Math.max(1, view.clientHeight - 24);
      const target = Math.min(1, Math.max(minScale(), Math.min(availableWidth / width, availableHeight / height)));
      setScale(target, { x: view.clientWidth / 2, y: 0 });
      view.scrollLeft = Math.max(0, (width * scale - view.clientWidth) / 2);
      view.scrollTop = 0;
      updateGenerationLabelPosition();
    }

    function beforeRender() {
      const root = canvas();
      rendering = true;
      const current = semanticStateForScale(scale);
      if (!semanticMode || semanticProfile !== current.profile || semanticMode !== current.mode) {
        semanticMode = current.mode;
        semanticProfile = current.profile;
      }
      if (root) {
        applySemanticMode(semanticMode, semanticProfile);
        root.style.transform = 'none';
      }
    }

    function afterRender() {
      rendering = false;
      const root = canvas();
      if (!root) return;
      scale = clampScale(scale);
      naturalWidth = Math.max(root.offsetWidth, root.scrollWidth);
      naturalHeight = Math.max(root.offsetHeight, root.scrollHeight);
      applyScale();
      if (pendingSemanticRestore && pendingSemanticRestore.mode === semanticMode && pendingSemanticRestore.profile === semanticProfile) {
        const pending = pendingSemanticRestore;
        pendingSemanticRestore = null;
        const logical = { x: naturalWidth * pending.ratioX, y: naturalHeight * pending.ratioY };
        positionLogicalAtAnchor(logical, pending.anchor);
        updateGenerationLabelPosition();
        scheduleCanvasViewStateSave();
      }
      updateControls();
      rememberViewportAnchor();
    }

    function captureViewportAnchor() {
      const view = viewport(), root = canvas();
      if (!view || !root) return null;
      const viewRect = view.getBoundingClientRect();
      const selected = selectedId ? root.querySelector(`.person[data-person-id="${CSS.escape(selectedId)}"]`) : null;
      if (selected) {
        const rect = selected.getBoundingClientRect();
        const fx = view.clientWidth ? (rect.left + rect.width / 2 - viewRect.left) / view.clientWidth : .5;
        const fy = view.clientHeight ? (rect.top + rect.height / 2 - viewRect.top) / view.clientHeight : .5;
        return { type: 'person', personId: selectedId, fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)) };
      }
      const width = Math.max(1, naturalWidth || root.offsetWidth || root.scrollWidth);
      const height = Math.max(1, naturalHeight || root.offsetHeight || root.scrollHeight);
      const logicalX = (view.scrollLeft + view.clientWidth / 2) / Math.max(.001, scale);
      const logicalY = (view.scrollTop + view.clientHeight / 2) / Math.max(.001, scale);
      return {
        type: 'ratio',
        ratioX: Math.max(0, Math.min(1, logicalX / width)),
        ratioY: Math.max(0, Math.min(1, logicalY / height))
      };
    }

    function restoreViewportAnchor(anchor) {
      const view = viewport(), root = canvas();
      if (!anchor || !view || !root) return;
      if (anchor.type === 'person' && anchor.personId) {
        const selected = root.querySelector(`.person[data-person-id="${CSS.escape(anchor.personId)}"]`);
        if (selected) {
          const viewRect = view.getBoundingClientRect();
          const rect = selected.getBoundingClientRect();
          const targetX = viewRect.left + view.clientWidth * (Number.isFinite(anchor.fx) ? anchor.fx : .5);
          const targetY = viewRect.top + view.clientHeight * (Number.isFinite(anchor.fy) ? anchor.fy : .5);
          view.scrollLeft += rect.left + rect.width / 2 - targetX;
          view.scrollTop += rect.top + rect.height / 2 - targetY;
          updateGenerationLabelPosition();
          scheduleCanvasViewStateSave();
          rememberViewportAnchor();
          return;
        }
      }
      const logical = {
        x: Math.max(1, naturalWidth) * (Number.isFinite(anchor.ratioX) ? anchor.ratioX : .5),
        y: Math.max(1, naturalHeight) * (Number.isFinite(anchor.ratioY) ? anchor.ratioY : .5)
      };
      positionLogicalAtAnchor(logical, { x: view.clientWidth / 2, y: view.clientHeight / 2 });
      updateGenerationLabelPosition();
      scheduleCanvasViewStateSave();
      rememberViewportAnchor();
    }

    function rememberViewportAnchor() {
      if (stableAnchorFrame) return;
      stableAnchorFrame = requestAnimationFrame(() => {
        stableAnchorFrame = 0;
        stableViewportAnchor = captureViewportAnchor();
      });
    }

    function getStableViewportAnchor() {
      const source = stableViewportAnchor || captureViewportAnchor();
      return source ? { ...source } : null;
    }

    function bind() {
      const out = document.getElementById('tree-zoom-out');
      const plus = document.getElementById('tree-zoom-in');
      const value = document.getElementById('tree-zoom-value');
      const fit = document.getElementById('tree-zoom-fit');
      const mobileFit = document.getElementById('mobile-tree-fit');
      if (!out || out.dataset.bound) return;
      out.addEventListener('click', () => setScale(scale - STEP));
      plus?.addEventListener('click', () => setScale(scale + STEP));
      value?.addEventListener('click', () => setScale(1));
      fit?.addEventListener('click', fitWidth);
      mobileFit?.addEventListener('click', fitView);
      const view = viewport();
      view?.addEventListener('wheel', event => {
        if (isMobileLayout() || (!event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        const rect = view.getBoundingClientRect();
        const anchor = {
          x: Math.max(0, Math.min(view.clientWidth, event.clientX - rect.left)),
          y: Math.max(0, Math.min(view.clientHeight, event.clientY - rect.top))
        };
        const logical = {
          x: (view.scrollLeft + anchor.x) / Math.max(.001, scale),
          y: (view.scrollTop + anchor.y) / Math.max(.001, scale)
        };
        const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? 180 : 1;
        const factor = Math.max(.82, Math.min(1.22, Math.exp(-event.deltaY * unit * .0024)));
        beginSemanticGesture();
        setScaleAroundLogical(scale * factor, logical, anchor);
        clearTimeout(wheelGestureTimer);
        wheelGestureTimer = setTimeout(endSemanticGesture, 150);
      }, { passive:false });
      view?.addEventListener('scroll', scheduleGenerationLabelPosition, { passive: true });
      view?.addEventListener('scroll', scheduleCanvasViewStateSave, { passive: true });
      view?.addEventListener('scroll', rememberViewportAnchor, { passive: true });
      out.dataset.bound = 'true';
      updateControls();
      updateGenerationLabelPosition();
    }

    bind();
    return {
      beforeRender,
      afterRender,
      setScale,
      setScaleAroundLogical,
      fitWidth,
      fitView,
      getScale: () => scale,
      getSemanticMode: () => semanticMode || semanticModeForScale(scale),
      getSemanticProfile: () => semanticProfile || semanticProfileForViewport(),
      beginSemanticGesture,
      endSemanticGesture,
      isMobileLayout,
      getMinScale: minScale,
      getMaxScale: () => MAX_SCALE,
      captureViewportAnchor,
      getStableViewportAnchor,
      rememberViewportAnchor,
      restoreViewportAnchor,
      isRendering: () => rendering
    };
  })();

  let suppressClick = false;
  const memberTooltip = (() => {
    const tooltip = document.getElementById('member-tooltip');
    const name = document.getElementById('member-tooltip-name');
    const body = document.getElementById('member-tooltip-body');
    const SHOW_DELAY = 320;
    const HIDE_DELAY = 80;
    const GAP = 12;
    const VIEWPORT_MARGIN = 12;
    let showTimer = 0;
    let hideTimer = 0;
    let anchor = null;
    let activePerson = null;
    let positionFrame = 0;

    function clearTimers() {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      showTimer = 0;
      hideTimer = 0;
    }

    function choosePlacement(rect, width, height) {
      const spaces = {
        top: rect.top - VIEWPORT_MARGIN,
        bottom: window.innerHeight - rect.bottom - VIEWPORT_MARGIN,
        left: rect.left - VIEWPORT_MARGIN,
        right: window.innerWidth - rect.right - VIEWPORT_MARGIN
      };
      const required = { top: height + GAP, bottom: height + GAP, left: width + GAP, right: width + GAP };
      const preferred = ['top', 'bottom', 'right', 'left'];
      return preferred.find(side => spaces[side] >= required[side])
        || preferred.reduce((best, side) => spaces[side] / required[side] > spaces[best] / required[best] ? side : best, preferred[0]);
    }

    function position() {
      positionFrame = 0;
      if (!tooltip || tooltip.hidden || !anchor?.isConnected) return;
      const rect = anchor.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const placement = choosePlacement(rect, tip.width, tip.height);
      let left;
      let top;
      if (placement === 'top' || placement === 'bottom') {
        left = rect.left + rect.width / 2 - tip.width / 2;
        top = placement === 'top' ? rect.top - tip.height - GAP : rect.bottom + GAP;
      } else {
        left = placement === 'left' ? rect.left - tip.width - GAP : rect.right + GAP;
        top = rect.top + rect.height / 2 - tip.height / 2;
      }
      left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - tip.width - VIEWPORT_MARGIN));
      top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - tip.height - VIEWPORT_MARGIN));
      tooltip.dataset.placement = placement;
      tooltip.style.left = Math.round(left) + 'px';
      tooltip.style.top = Math.round(top) + 'px';
      if (placement === 'top' || placement === 'bottom') {
        const arrowX = Math.max(18, Math.min(rect.left + rect.width / 2 - left, tip.width - 18));
        tooltip.style.setProperty('--tooltip-arrow-x', Math.round(arrowX) + 'px');
      } else {
        const arrowY = Math.max(18, Math.min(rect.top + rect.height / 2 - top, tip.height - 18));
        tooltip.style.setProperty('--tooltip-arrow-y', Math.round(arrowY) + 'px');
      }
    }

    function schedulePosition() {
      if (!positionFrame && anchor && !tooltip.hidden) positionFrame = requestAnimationFrame(position);
    }

    function show(node, person, immediate = false) {
      if (!tooltip || !person.notes) return;
      clearTimeout(hideTimer);
      clearTimeout(showTimer);
      anchor = node;
      activePerson = person;
      const reveal = () => {
        showTimer = 0;
        if (anchor !== node || !node.isConnected) return;
        name.textContent = hideCanvasNames ? 'OOO' : person.name;
        body.textContent = person.notes;
        tooltip.classList.remove('is-visible');
        tooltip.hidden = false;
        node.setAttribute('aria-describedby', 'member-tooltip');
        position();
        requestAnimationFrame(() => { if (anchor === node && !tooltip.hidden) tooltip.classList.add('is-visible'); });
      };
      if (immediate) reveal();
      else showTimer = setTimeout(reveal, SHOW_DELAY);
    }

    function hide(node, immediate = false) {
      clearTimeout(showTimer);
      showTimer = 0;
      if (node && anchor && anchor !== node) return;
      const conceal = () => {
        hideTimer = 0;
        if (anchor) anchor.removeAttribute('aria-describedby');
        anchor = null;
        activePerson = null;
        tooltip.classList.remove('is-visible');
        if (immediate) tooltip.hidden = true;
        else setTimeout(() => { if (!anchor && !tooltip.classList.contains('is-visible')) tooltip.hidden = true; }, 150);
      };
      clearTimeout(hideTimer);
      if (immediate) conceal();
      else hideTimer = setTimeout(conceal, HIDE_DELAY);
    }

    function refreshName() {
      if (!tooltip.hidden && activePerson) {
        name.textContent = hideCanvasNames ? 'OOO' : activePerson.name;
        schedulePosition();
      }
    }

    function bind(node, person) {
      if (!person.notes) return;
      node.dataset.hasNote = 'true';
      node.addEventListener('mouseenter', () => show(node, person));
      node.addEventListener('mouseleave', () => hide(node));
      node.addEventListener('focus', () => show(node, person, true));
      node.addEventListener('blur', () => hide(node));
    }

    window.addEventListener('resize', schedulePosition);
    document.getElementById('tree-canvas')?.parentElement?.addEventListener('scroll', schedulePosition, { passive: true });
    return { bind, hide, refreshName, schedulePosition };
  })();
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
  function applyResponsiveDefaults() {
    const legend = document.querySelector('.legend-panel');
    if (!legend || legend.dataset.responsiveDefaultApplied) return;
    legend.dataset.responsiveDefaultApplied = 'true';
    if (typeof initialViewState?.legendOpen === 'boolean') legend.open = initialViewState.legendOpen;
    else if (window.matchMedia?.('(max-width:700px), (max-width:950px) and (max-height:520px) and (pointer:coarse)').matches) legend.open = false;
    legend.addEventListener('toggle', scheduleCanvasViewStateSave);
  }
  function bindMobileOverlayAvoidance() {
    if (document.documentElement.dataset.familyOverlayAvoidanceBound) return;
    const workspace = document.querySelector('.workspace');
    const details = document.getElementById('relationship-details');
    if (!workspace || !details) return;
    document.documentElement.dataset.familyOverlayAvoidanceBound = 'true';
    const portrait = matchMedia('(max-width:700px) and (orientation:portrait)');
    let frame = 0;
    function update() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!portrait.matches || details.hidden) {
          workspace.style.removeProperty('--mobile-overlay-bottom');
          return;
        }
        const workspaceRect = workspace.getBoundingClientRect();
        const detailsRect = details.getBoundingClientRect();
        if (!detailsRect.height || detailsRect.bottom <= workspaceRect.top || detailsRect.top >= workspaceRect.bottom) {
          workspace.style.removeProperty('--mobile-overlay-bottom');
          return;
        }
        // Reserve everything from the top edge of the bottom sheet/peek to the
        // workspace bottom, then leave an additional 8px breathing room.
        const inset = Math.max(0, Math.ceil(workspaceRect.bottom - detailsRect.top + 8));
        workspace.style.setProperty('--mobile-overlay-bottom', `${inset}px`);
      });
    }
    new MutationObserver(update).observe(details, { attributes: true, childList: true, subtree: true, attributeFilter: ['hidden', 'data-collapsed', 'style', 'class'] });
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(update);
      observer.observe(details); observer.observe(workspace);
    }
    portrait.addEventListener?.('change', update);
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  function closeSelectedDetails({ focusCanvas = false } = {}) {
    if (!selectedId) return false;
    selectedId = null;
    render();
    if (focusCanvas) requestAnimationFrame(() => document.querySelector('.tree')?.focus({ preventScroll: true }));
    return true;
  }

  function hasOpenPopover() {
    try { return !!document.querySelector(':popover-open'); } catch (_) { return false; }
  }

  function bindGlobalDismiss() {
    if (document.documentElement.dataset.familyDismissBound) return;
    document.documentElement.dataset.familyDismissBound = 'true';
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const openDialogs = [...document.querySelectorAll('dialog[open]')];
      const hasModal = openDialogs.some(dialog => {
        try { return dialog.matches(':modal'); } catch (_) { return false; }
      });
      // Native dialog cancellation owns Escape while any modal is in the top layer.
      if (hasModal) return;
      const resultSheet = document.getElementById('relationship-result-sheet');
      if (resultSheet?.open) {
        event.preventDefault();
        document.getElementById('relationship-result-sheet-close')?.click();
        return;
      }
      if (openDialogs.length || hasOpenPopover()) return;
      if (closeSelectedDetails({ focusCanvas: true })) event.preventDefault();
    });
  }

  function closeTopUiForMobileBack() {
    let popover = null;
    try { popover = document.querySelector(':popover-open'); } catch (_) {}
    if (popover) {
      try { popover.hidePopover(); } catch (_) {}
      return true;
    }
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    if (openDialogs.length) {
      const dialog = openDialogs[openDialogs.length - 1];
      const cancel = new Event('cancel', { cancelable: true });
      const shouldClose = dialog.dispatchEvent(cancel);
      if (shouldClose && dialog.open) dialog.close();
      return true;
    }
    return closeSelectedDetails({ focusCanvas: true });
  }

  function bindMobileBackNavigation() {
    if (document.documentElement.dataset.familyMobileBackBound) return;
    document.documentElement.dataset.familyMobileBackBound = 'true';
    const mobile = window.matchMedia?.('(max-width:950px) and (pointer:coarse)');
    if (!mobile) return;
    const ROOT = '__familyTreeMobileRoot';
    const GUARD = '__familyTreeMobileGuard';
    const hadPreviousEntry = history.length > 1;
    let leaving = false;

    function arm() {
      if (!mobile.matches || leaving) return;
      const state = history.state || {};
      if (state[GUARD]) return;
      if (!state[ROOT]) history.replaceState({ ...state, [ROOT]: true }, '');
      history.pushState({ ...(history.state || {}), [GUARD]: true }, '');
    }

    window.addEventListener('popstate', () => {
      if (!mobile.matches || leaving) return;
      if (closeTopUiForMobileBack()) {
        requestAnimationFrame(() => arm());
        return;
      }
      // The guard entry has already been consumed by this Back action. With no
      // in-page UI left to dismiss, continue to the actual previous page when
      // one existed before the guard was installed. A directly-opened tab has
      // nowhere to go, so restore the guard instead of disabling future Back UX.
      if (hadPreviousEntry) {
        leaving = true;
        history.back();
      } else requestAnimationFrame(() => arm());
    });
    arm();
  }

  function bindPanning(viewport) {
    if (viewport.dataset.panBound) return;
    viewport.dataset.panBound = 'true';

    let mouseDrag = null;
    const touchPointers = new Map();
    let singleTouch = null;
    let pinch = null;
    let inertiaFrame = 0;
    let proximityDispatching = false;
    const MIN_SCREEN_TOUCH_TARGET = 44;

    const now = () => performance.now();
    const stopInertia = () => {
      if (inertiaFrame) cancelAnimationFrame(inertiaFrame);
      inertiaFrame = 0;
    };
    const capture = id => {
      try { if (!viewport.hasPointerCapture(id)) viewport.setPointerCapture(id); } catch (_) {}
    };
    const release = id => {
      try { if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id); } catch (_) {}
    };
    const localPoint = point => {
      const box = viewport.getBoundingClientRect();
      return { x: point.x - box.left, y: point.y - box.top };
    };
    const pointerPair = () => [...touchPointers.values()].slice(0, 2);

    function proximityTouchTarget(clientX, clientY) {
      if (!treeZoom.isMobileLayout()) return null;
      let best = null;
      viewport.querySelectorAll('.person,.intermediate-node').forEach(node => {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const expandX = Math.max(0, (MIN_SCREEN_TOUCH_TARGET - rect.width) / 2);
        const expandY = Math.max(0, (MIN_SCREEN_TOUCH_TARGET - rect.height) / 2);
        if (!expandX && !expandY) return;
        if (clientX < rect.left - expandX || clientX > rect.right + expandX || clientY < rect.top - expandY || clientY > rect.bottom + expandY) return;
        const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
        const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
        const centerDistance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
        const score = Math.hypot(dx, dy) * 1000 + centerDistance;
        if (!best || score < best.score) best = { node, score };
      });
      return best?.node || null;
    }

    function beginSingle(point, alreadyMoved = false) {
      singleTouch = {
        id: point.id,
        x: point.x,
        y: point.y,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        moved: alreadyMoved,
        lastTime: point.time,
        lastLeft: viewport.scrollLeft,
        lastTop: viewport.scrollTop,
        vx: 0,
        vy: 0
      };
      if (alreadyMoved) {
        capture(point.id);
        viewport.classList.add('is-dragging');
      }
    }

    function beginPinch() {
      const pair = pointerPair();
      if (pair.length < 2) return;
      const [a, b] = pair;
      const mid = localPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const scale = treeZoom.getScale();
      treeZoom.beginSemanticGesture();
      pinch = {
        ids: [a.id, b.id],
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale,
        logical: {
          x: (viewport.scrollLeft + mid.x) / scale,
          y: (viewport.scrollTop + mid.y) / scale
        }
      };
      singleTouch = null;
      suppressClick = true;
      capture(a.id);
      capture(b.id);
      viewport.classList.add('is-dragging');
    }

    function updatePinch(event) {
      if (!pinch) return;
      const a = touchPointers.get(pinch.ids[0]);
      const b = touchPointers.get(pinch.ids[1]);
      if (!a || !b) {
        if (touchPointers.size >= 2) beginPinch();
        return;
      }
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const mid = localPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      treeZoom.setScaleAroundLogical(pinch.scale * (distance / pinch.distance), pinch.logical, mid);
      suppressClick = true;
      event.preventDefault();
    }

    function startInertia(vx, vy) {
      stopInertia();
      if (Math.hypot(vx, vy) < .04) return;
      let last = now();
      function frame(time) {
        const dt = Math.min(32, Math.max(1, time - last));
        last = time;
        const oldLeft = viewport.scrollLeft;
        const oldTop = viewport.scrollTop;
        viewport.scrollLeft += vx * dt;
        viewport.scrollTop += vy * dt;
        if (Math.abs(viewport.scrollLeft - oldLeft) < .1) vx = 0;
        if (Math.abs(viewport.scrollTop - oldTop) < .1) vy = 0;
        const decay = Math.pow(.92, dt / 16.67);
        vx *= decay;
        vy *= decay;
        if (Math.hypot(vx, vy) < .025) { inertiaFrame = 0; return; }
        inertiaFrame = requestAnimationFrame(frame);
      }
      inertiaFrame = requestAnimationFrame(frame);
    }

    viewport.addEventListener('pointerdown', event => {
      if (treeZoom.isMobileLayout() && event.pointerType !== 'mouse') {
        stopInertia();
        if (touchPointers.size === 0) suppressClick = false;
        touchPointers.set(event.pointerId, { id: event.pointerId, x: event.clientX, y: event.clientY, time: now() });
        if (touchPointers.size === 1) beginSingle(touchPointers.get(event.pointerId));
        else if (touchPointers.size === 2) beginPinch();
        return;
      }

      if (event.pointerType && event.pointerType !== 'mouse') return;
      if (!event.isPrimary || event.button !== 0) return;
      const box = viewport.getBoundingClientRect();
      if (event.clientX >= box.left + viewport.clientWidth || event.clientY >= box.top + viewport.clientHeight) return;
      suppressClick = false;
      mouseDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false };
    });

    viewport.addEventListener('pointermove', event => {
      if (treeZoom.isMobileLayout() && event.pointerType !== 'mouse') {
        const point = touchPointers.get(event.pointerId);
        if (!point) return;
        point.x = event.clientX;
        point.y = event.clientY;
        point.time = now();
        if (touchPointers.size >= 2) {
          updatePinch(event);
          return;
        }
        if (!singleTouch || event.pointerId !== singleTouch.id) return;
        const dx = event.clientX - singleTouch.x;
        const dy = event.clientY - singleTouch.y;
        if (!singleTouch.moved && Math.hypot(dx, dy) < 6) return;
        if (!singleTouch.moved) {
          singleTouch.moved = true;
          suppressClick = true;
          capture(event.pointerId);
          viewport.classList.add('is-dragging');
        }
        viewport.scrollLeft = singleTouch.left - dx;
        viewport.scrollTop = singleTouch.top - dy;
        const time = now();
        const dt = Math.max(1, time - singleTouch.lastTime);
        const instantVx = (viewport.scrollLeft - singleTouch.lastLeft) / dt;
        const instantVy = (viewport.scrollTop - singleTouch.lastTop) / dt;
        singleTouch.vx = singleTouch.vx * .55 + instantVx * .45;
        singleTouch.vy = singleTouch.vy * .55 + instantVy * .45;
        singleTouch.lastTime = time;
        singleTouch.lastLeft = viewport.scrollLeft;
        singleTouch.lastTop = viewport.scrollTop;
        event.preventDefault();
        return;
      }

      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      const dx = event.clientX - mouseDrag.x, dy = event.clientY - mouseDrag.y;
      if (!mouseDrag.moved && Math.hypot(dx, dy) < 6) return;
      mouseDrag.moved = true;
      suppressClick = true;
      capture(event.pointerId);
      viewport.classList.add('is-dragging');
      viewport.scrollLeft = mouseDrag.left - dx;
      viewport.scrollTop = mouseDrag.top - dy;
      event.preventDefault();
    });

    function finishTouch(event, cancelled = false) {
      const point = touchPointers.get(event.pointerId);
      if (!point) return;
      const endedSingle = singleTouch && singleTouch.id === event.pointerId ? singleTouch : null;
      touchPointers.delete(event.pointerId);
      release(event.pointerId);

      if (touchPointers.size >= 2) {
        beginPinch();
        return;
      }
      if (touchPointers.size === 1) {
        const remaining = [...touchPointers.values()][0];
        beginSingle(remaining, !!pinch || !!endedSingle?.moved);
        pinch = null;
        return;
      }

      pinch = null;
      singleTouch = null;
      viewport.classList.remove('is-dragging');
      treeZoom.endSemanticGesture();
      if (!cancelled && endedSingle?.moved) startInertia(endedSingle.vx, endedSingle.vy);
    }

    function finish(event, cancelled = false) {
      if (treeZoom.isMobileLayout() && event.pointerType !== 'mouse') {
        finishTouch(event, cancelled);
        return;
      }
      if (!mouseDrag || event.pointerId !== mouseDrag.id) return;
      release(mouseDrag.id);
      mouseDrag = null;
      viewport.classList.remove('is-dragging');
    }

    viewport.addEventListener('pointerup', event => finish(event, false));
    viewport.addEventListener('pointercancel', event => finish(event, true));
    viewport.addEventListener('lostpointercapture', event => {
      if (event.pointerType === 'mouse') finish(event, true);
    });
    viewport.addEventListener('click', event => {
      if (proximityDispatching) return;
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; return; }
      if (!treeZoom.isMobileLayout() || event.target.closest?.('.person,.intermediate-node')) return;
      const target = proximityTouchTarget(event.clientX, event.clientY);
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      proximityDispatching = true;
      try { target.click(); } finally { proximityDispatching = false; }
    }, true);
    viewport.addEventListener('click', event => {
      if (!selectedId || event.defaultPrevented) return;
      if (event.target.closest?.('.person,.intermediate-node')) return;
      closeSelectedDetails();
    });
    viewport.addEventListener('dragstart', event => event.preventDefault());
  }
  function renderTree() {
    const canvas = document.getElementById('tree-canvas');
    if (!canvas) return;
    buildLegend();
    applyResponsiveDefaults();
    bindPanning(canvas.parentElement);
    bindGlobalDismiss();
    bindMobileBackNavigation();
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
    const intermediatePlans = FamilyModel.intermediatePlans(FAMILY).filter(p => visibleIds.has(p.near) && visibleIds.has(p.other) && visibleEdges.has(p.edgeKey));
    const displayShift = Math.max(0, 1 - Math.min(1, ...intermediatePlans.map(p => p.generation)));
    const uncertainGeneration = Math.max(0, ...FAMILY.people.filter(p => connectedIds.has(p.id)).map(p => p.gen)) + displayShift + 1;
    const people = graph.people.filter(p => !focusedIds || focusedIds.has(p.id))
      .map(p => ({ ...p, gen: connectedIds.has(p.id) ? p.gen + displayShift : uncertainGeneration }));
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
    const sharing = FamilyModel.connectorGroups(graph, extra);
    extra.forEach((r, i) => {
      if (sharing[i].root === r.to) [r.from, r.to] = [r.to, r.from];
    });
    const occupiedGenerations = people.filter(p => connectedIds.has(p.id)).map(p => p.gen).concat(intermediatePlans.map(p => p.generation + displayShift));
    const firstGeneration = Math.min(...occupiedGenerations), lastGeneration = Math.max(...occupiedGenerations);
    const generations = occupiedGenerations.length ? Array.from({ length: lastGeneration - firstGeneration + 1 }, (_, i) => firstGeneration + i) : [];
    if (people.some(p => !connectedIds.has(p.id))) generations.push(uncertainGeneration);
    // Lanes belong to a generation gutter, not to the entire family graph.
    // Reuse their numbers in other generations instead of inflating every row.
    const originCounts = new Map(), childCounts = new Map();
    const originLanes = new Map(), childLanes = new Map();
    unions.forEach(u => {
      const gen = Math.max(...u.partners.map(id => byId.get(id).gen));
      originLanes.set(u.id, originCounts.get(gen) || 0);
      originCounts.set(gen, (originCounts.get(gen) || 0) + 1);
      for (const childGen of new Set(childrenOf(u).map(d => byId.get(d.child).gen))) {
        childLanes.set(`${u.id}:${childGen}`, childCounts.get(childGen) || 0);
        childCounts.set(childGen, (childCounts.get(childGen) || 0) + 1);
      }
    });
    const auxiliaryCounts = new Map();
    const groupLanes = new Map();
    const auxiliaryLanes = extra.map((r, index) => {
      if (groupLanes.has(sharing[index].group)) return groupLanes.get(sharing[index].group);
      const members = extra.filter((_, i) => sharing[i].group === sharing[index].group);
      const memberPlans = members.map(edge => intermediatePlans.filter(p => edge.planId ? p.id === edge.planId : p.edgeKey === FamilyModel.intermediateKey(edge.kind, [edge.from, edge.to])));
      const count = Math.max(...memberPlans.map(plans => plans.length));
      const gens = [...new Set([...members.flatMap(edge => [byId.get(edge.from).gen, byId.get(edge.to).gen]), ...memberPlans.flat().map(p => p.generation + displayShift)])];
      const lane = Math.max(0, ...gens.map(gen => auxiliaryCounts.get(gen) || 0));
      gens.forEach(gen => auxiliaryCounts.set(gen, lane + count + 1));
      groupLanes.set(sharing[index].group, lane); return lane;
    });
    const auxiliaryLaneStep = 18;
    const auxiliaryExtent = gen => auxiliaryCounts.has(gen) ? 24 + Math.max(0, auxiliaryCounts.get(gen) - 1) * auxiliaryLaneStep : 0;
    const upperLanes = gen => Math.max(58 + Math.max(0, (childCounts.get(gen) || 0) - 1) * 18, auxiliaryExtent(gen) + 16, 64);
    const lowerLanes = gen => Math.max(22 + Math.max(0, (originCounts.get(gen) || 0) - 1) * 18, auxiliaryExtent(gen), 40);
    const rowGap = gen => Math.max(144, lowerLanes(gen) + upperLanes(gen + 1) + 24);
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
          if (queryView.active && p.id === queryView.aId) node.classList.add('pair-a');
          if (queryView.active && p.id === queryView.bId) node.classList.add('pair-b');
          node.dataset.personId = p.id;
          node.setAttribute('aria-pressed', String(selectedId === p.id));
          const nameNode = element('span', 'person__name', hideCanvasNames ? 'OOO' : p.name);
          nameNode.dataset.compactName = hideCanvasNames ? 'OOO' : p.name;
          node.appendChild(nameNode);
          node.appendChild(element('span', 'person__location', '所在地：' + (p.location || '未填寫')));
          node.appendChild(element('span', 'person__position', '職位：' + (p.position || '未填寫')));
          node.appendChild(element('span', 'person__order', FamilyModel.knownOrder(p) ? '手足序：' + p.siblingOrder : '手足序：未填寫'));
          if (FamilyModel.knownDiscipleOrder(p)) node.appendChild(element('span', 'person__order', '師門序：' + p.discipleOrder));
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
      button.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') { suppressClick = false; event.stopPropagation(); } });
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
        onSelect: id => window.selectFamilyMember(id, { preserveDetailsState: true }),
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
    if (viewStateReady || !window.FAMILY?.people) return;
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
  window.renderFamilyTree = render;
  bindMobileOverlayAvoidance();
  window.selectFamilyMember = (id, { preserveDetailsState = false, expandDetails = false } = {}) => {
    selectedId = id;
    if (id && !preserveDetailsState) {
      const collapse = expandDetails ? false : matchMedia('(max-width:700px) and (orientation:portrait)').matches;
      relationshipDetails.setCollapsed(document.getElementById('relationship-details'), collapse);
    }
    render();
    const node = [...document.querySelectorAll('.person')].find(n => n.dataset.personId === id);
    node?.scrollIntoView({ block: 'center', inline: 'center' });
    if (id) window.dispatchEvent(new CustomEvent('familymemberviewed', { detail: { id } }));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
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
  document.fonts?.ready.then(() => { if (typeof FAMILY !== 'undefined') render(); });
})();
