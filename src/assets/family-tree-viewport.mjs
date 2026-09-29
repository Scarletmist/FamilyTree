export function createViewportController({
  initialState = null,
  onSemanticRender = () => {},
  getSelectedId = () => null,
  hideTooltip = () => {},
  onViewStateChange = () => {}
} = {}) {
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

  let scale = Number(initialState?.scale) || 1;
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
  let zoomControlsAttentionTimer = 0;

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

  function semanticStateForScale(value = scale) {
    const profile = semanticProfileForViewport();
    const levels = SEMANTIC_PROFILES[profile] || SEMANTIC_PROFILES.desktop;
    const level = levels.find(item => value <= item.max + .001) || levels[levels.length - 1];
    return { profile, mode: level.mode };
  }

  function semanticModeForScale(value = scale) {
    return semanticStateForScale(value).mode;
  }

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
      if (!pending || semanticGestureActive || pending.mode !== current.mode || pending.profile !== current.profile
        || (pending.mode === semanticMode && pending.profile === semanticProfile)) return;
      semanticMode = pending.mode;
      semanticProfile = pending.profile;
      onSemanticRender();
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
    hideTooltip();
    scheduleSemanticCommit(logical, anchor);
    onViewStateChange();
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
      onViewStateChange();
    }
    updateControls();
    rememberViewportAnchor();
  }

  function captureViewportAnchor() {
    const view = viewport(), root = canvas();
    if (!view || !root) return null;
    const viewRect = view.getBoundingClientRect();
    const selectedId = getSelectedId();
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
        onViewStateChange();
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
    onViewStateChange();
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

  function bindDesktopZoomControlsAttention(view) {
    const controls = document.getElementById('tree-zoom-controls');
    if (!view || !controls || controls.dataset.attentionBound) return;
    const PROXIMITY = 70;
    const FADE_DELAY = 520;
    const setAttentive = active => {
      clearTimeout(zoomControlsAttentionTimer);
      if (active) {
        controls.classList.add('is-attentive');
        return;
      }
      zoomControlsAttentionTimer = setTimeout(() => {
        if (!controls.matches(':hover, :focus-within')) controls.classList.remove('is-attentive');
      }, FADE_DELAY);
    };
    const isNear = event => {
      if (isMobileLayout() || (event.pointerType && event.pointerType !== 'mouse')) return false;
      const rect = controls.getBoundingClientRect();
      return event.clientX >= rect.left - PROXIMITY && event.clientX <= rect.right + PROXIMITY
        && event.clientY >= rect.top - PROXIMITY && event.clientY <= rect.bottom + PROXIMITY;
    };
    view.addEventListener('pointermove', event => setAttentive(isNear(event)), { passive:true });
    view.addEventListener('pointerleave', () => setAttentive(false), { passive:true });
    controls.addEventListener('pointerenter', () => setAttentive(true), { passive:true });
    controls.addEventListener('pointerleave', () => setAttentive(false), { passive:true });
    controls.addEventListener('focusin', () => setAttentive(true));
    controls.addEventListener('focusout', () => setAttentive(false));
    controls.addEventListener('click', () => {
      setAttentive(true);
      clearTimeout(zoomControlsAttentionTimer);
      zoomControlsAttentionTimer = setTimeout(() => {
        if (!controls.matches(':hover, :focus-within')) controls.classList.remove('is-attentive');
      }, 1200);
    });
    controls.dataset.attentionBound = 'true';
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
    bindDesktopZoomControlsAttention(view);
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
    view?.addEventListener('scroll', onViewStateChange, { passive: true });
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
}
