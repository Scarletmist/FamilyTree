export function createViewportController({
  initialState = null,
  onSemanticRender = () => {},
  getSelectedId = () => null,
  hideTooltip = () => {},
  onViewStateChange = () => {}
} = {}) {
  const MOBILE_QUERY = '(max-width:700px), (max-width:950px) and (max-height:520px)';
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
  let offsetX = 0, offsetY = 0;
  let queryExtentX = 0, queryExtentY = 0;
  let preservedInspectorExtentX = 0;
  let renderedScene = null, renderedScope = null;
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
  let focusFrame = 0;
  let focusTarget = null;
  let pendingCloseScroll = null;

  const viewport = () => document.querySelector('.tree');
  const canvas = () => document.getElementById('tree-canvas');
  const spacer = () => document.getElementById('tree-zoom-spacer');
  const isMobileLayout = () => matchMedia(MOBILE_QUERY).matches;

  function cancelMemberFocus() {
    cancelAnimationFrame(focusFrame);
    focusFrame = 0;
    focusTarget = null;
  }

  function restoreScrollPosition(position) {
    const view = viewport();
    if (!view) return;
    cancelMemberFocus();
    pendingCloseScroll = null; // Explicit restoration wins over a queued dock close.
    const left = Math.max(0, Math.min(Number(position.left) || 0, naturalWidth * scale + offsetX));
    const top = Math.max(0, Number(position.top) || 0);
    // Include the reserved scrollbar gutter when retaining an exact view.
    preservedInspectorExtentX = Math.max(preservedInspectorExtentX, left + view.offsetWidth);
    applyScale();
    view.scrollTo({ left, top, behavior:'instant' });
    updateGenerationLabelPosition(); rememberViewportAnchor(); onViewStateChange();
    // Keep this exact restoration authoritative through the next layout
    // observer delivery, just as member navigation owns its focus frames.
    focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => { focusFrame = 0; rememberViewportAnchor(); });
    });
    // Keep this exact restoration authoritative through the next layout
    // observer delivery, just as member navigation owns its focus frames.
    focusFrame = requestAnimationFrame(() => {
      focusFrame = requestAnimationFrame(() => { focusFrame = 0; rememberViewportAnchor(); });
    });
  }

  // Scroll the viewport itself; scrollIntoView can also move page/dialog
  // ancestors and cannot account for the portrait inspector covering the tree.
  function focusMember(id) {
    cancelMemberFocus();
    const view = viewport();
    const node = canvas()?.querySelector(`.person[data-person-id="${CSS.escape(id)}"]`);
    if (!view || !node) return;
    view.dispatchEvent(new Event('familycanvasfocus'));
    hideTooltip();
    const animate = globalThis.FamilyMotion?.shouldScrollSmooth() || false;
    focusFrame = requestAnimationFrame(time => {
      if (!node.isConnected) { cancelMemberFocus(); return; }
      const rect = view.getBoundingClientRect(), member = node.getBoundingClientRect();
      let top = rect.top + view.clientTop, bottom = top + view.clientHeight;
      if (isMobileLayout()) {
        const details = document.getElementById('relationship-details');
        if (details && !details.hidden) {
          const panel = details.getBoundingClientRect();
          if (panel.top > top && panel.top < bottom && panel.width > view.clientWidth / 2) bottom = panel.top - 12;
        }
        const summary = document.getElementById('relationship-summary');
        if (summary && !summary.hidden) top = Math.min(bottom, Math.max(top, summary.getBoundingClientRect().bottom + 12));
      }
      const start = { left:view.scrollLeft, top:view.scrollTop };
      focusTarget = {
        left:Math.max(0, Math.min(view.scrollWidth - view.clientWidth,
          start.left + member.left + member.width / 2 - (rect.left + view.clientLeft + view.clientWidth / 2))),
        top:Math.max(0, Math.min(view.scrollHeight - view.clientHeight,
          start.top + member.top + member.height / 2 - (top + bottom) / 2))
      };
      const target = focusTarget;
      const apply = progress => view.scrollTo({
        left:start.left + (target.left - start.left) * progress,
        top:start.top + (target.top - start.top) * progress,
        behavior:'instant'
      });
      if (!animate || Math.hypot(target.left - start.left, target.top - start.top) < 2) {
        apply(1);
        // Keep ownership through this frame's inspector ResizeObserver delivery.
        focusFrame = requestAnimationFrame(() => { cancelMemberFocus(); rememberViewportAnchor(); });
        return;
      }
      // Use the same strong ease-out token as the rest of the UI. Scrolling
      // needs rAF so a drag/zoom/new selection can take over at its current point.
      const curve = getComputedStyle(document.documentElement).getPropertyValue('--ease-out').match(/[\d.]+/g)?.map(Number) || [.23,1,.32,1];
      const coordinate = (t, a, b) => 3 * (1-t) ** 2 * t * a + 3 * (1-t) * t ** 2 * b + t ** 3;
      const ease = progress => {
        let low = 0, high = 1;
        for (let i = 0; i < 16; i++) {
          const t = (low + high) / 2;
          if (coordinate(t, curve[0], curve[2]) < progress) low = t; else high = t;
        }
        return coordinate((low + high) / 2, curve[1], curve[3]);
      };
      const step = now => {
        const progress = Math.min(1, (now - time) / 240);
        apply(progress === 1 ? 1 : ease(progress));
        if (progress < 1) focusFrame = requestAnimationFrame(step);
        else { cancelMemberFocus(); rememberViewportAnchor(); onViewStateChange(); }
      };
      focusFrame = requestAnimationFrame(step);
    });
  }

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
    let bottomClearance = 0;
    const details = document.getElementById('relationship-details');
    if (isMobileLayout() && details && !details.hidden) {
      const viewRect = view.getBoundingClientRect(), panel = details.getBoundingClientRect();
      if (panel.top > viewRect.top && panel.top < viewRect.bottom && panel.width > view.clientWidth / 2) {
        bottomClearance = viewRect.bottom - panel.top + 12;
      }
    }
    space.style.width = Math.max(view.clientWidth, queryExtentX, preservedInspectorExtentX, Math.ceil(naturalWidth * scale + offsetX)) + 'px';
    space.style.height = Math.max(view.clientHeight, queryExtentY, Math.ceil(naturalHeight * scale + offsetY + bottomClearance)) + 'px';
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
    root.style.left = `${offsetX}px`;
    root.style.top = `${offsetY}px`;
    updateSpacer();
    updateGenerationLabelPosition();
  }

  function positionLogicalAtAnchor(logical, anchor) {
    const view = viewport();
    if (!view) return;
    view.scrollLeft = Math.max(0, logical.x * scale + offsetX - anchor.x);
    view.scrollTop = Math.max(0, logical.y * scale + offsetY - anchor.y);
  }

  function setScaleAroundLogical(next, logical, anchor) {
    cancelMemberFocus();
    preservedInspectorExtentX = 0;
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
      x: (view.scrollLeft + anchorX - offsetX) / scale,
      y: (view.scrollTop + anchorY - offsetY) / scale
    };
    return setScaleAroundLogical(next, logical, { x: anchorX, y: anchorY });
  }

  function fitWidth() {
    if (isQueryVisible()) return fitQuery();
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
    if (isQueryVisible()) return fitQuery();
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

  function logicalAtAnchor(anchor) {
    const view = viewport();
    return { x: (view.scrollLeft + anchor.x - offsetX) / scale,
      y: (view.scrollTop + anchor.y - offsetY) / scale };
  }

  // Scope changes are synchronous: discard an old semantic-zoom timer before
  // measuring the new graph, rather than allowing it to restore an old anchor.
  function prepareScale(value) {
    preservedInspectorExtentX = 0;
    clearSemanticTimer();
    pendingSemanticRestore = null;
    offsetX = offsetY = 0;
    queryExtentX = queryExtentY = 0;
    scale = clampScale(value);
    applySemanticMode();
    const root = canvas();
    if (root) { root.style.left = '0px'; root.style.top = '0px'; }
  }

  function queryGeometry() {
    const view = viewport(), root = canvas();
    if (!view || !root) return null;
    const nodes = [...root.querySelectorAll('.person, .intermediate-add')];
    if (!nodes.length) return null;
    const origin = root.getBoundingClientRect();
    const rects = nodes.map(node => node.getBoundingClientRect());
    const left = (Math.min(...rects.map(r => r.left)) - origin.left) / scale;
    const right = (Math.max(...rects.map(r => r.right)) - origin.left) / scale;
    const top = (Math.min(...rects.map(r => r.top)) - origin.top) / scale;
    const bottom = (Math.max(...rects.map(r => r.bottom)) - origin.top) / scale;
    const viewRect = view.getBoundingClientRect();
    let insetTop = 16;
    for (const selector of ['.page-header', '#relationship-summary']) {
      const overlay = document.querySelector(selector);
      if (!overlay || overlay.hidden) continue;
      const rect = overlay.getBoundingClientRect();
      if (rect.bottom > viewRect.top && rect.top < viewRect.bottom) {
        insetTop = Math.max(insetTop, rect.bottom - viewRect.top + 16);
      }
    }
    return { left, right, top, bottom, insetTop,
      width: Math.max(1, view.clientWidth - 32),
      height: Math.max(1, view.clientHeight - insetTop - 56) };
  }

  function prepareQueryFit() {
    const geometry = queryGeometry();
    if (!geometry) return;
    const { left, right, top, bottom, width, height } = geometry;
    // Keep longer paths readable and pannable instead of shrinking indefinitely.
    prepareScale(Math.max(.65, Math.min(1, width / (right - left + 32), height / (bottom - top + 32))));
  }

  const isQueryVisible = () => document.getElementById('relationship-summary')?.hidden === false;
  function fitQuery() {
    prepareQueryFit();
    onSemanticRender();
    centerQuery();
  }

  function centerQuery() {
    const view = viewport(), geometry = queryGeometry();
    if (!view || !geometry) return;
    const { left, right, top, bottom, insetTop, width, height } = geometry;
    const x = (left + right) / 2 * scale;
    const y = (top + bottom) / 2 * scale;
    const anchorX = 16 + width / 2;
    // Long paths start at the first member; short paths are centered below the result.
    const anchorY = insetTop + height / 2;
    const targetY = (bottom - top) * scale > height ? top * scale + height / 2 : y;
    offsetX = Math.max(0, anchorX - x);
    offsetY = Math.max(0, anchorY - targetY);
    // Even a narrow canvas needs trailing space to allow the requested pan.
    queryExtentX = Math.max(0, x - anchorX) + view.clientWidth;
    queryExtentY = Math.max(0, targetY - anchorY) + view.clientHeight;
    applyScale();
    view.scrollLeft = Math.max(0, x - anchorX);
    view.scrollTop = Math.max(0, targetY - anchorY);
    updateGenerationLabelPosition();
    rememberViewportAnchor();
  }

  function beforeRender({ scene = null, scope = null } = {}) {
    cancelMemberFocus();
    if (scene !== renderedScene || scope !== renderedScope) preservedInspectorExtentX = 0;
    renderedScene = scene; renderedScope = scope;
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
    const logicalX = (view.scrollLeft + view.clientWidth / 2 - offsetX) / Math.max(.001, scale);
    const logicalY = (view.scrollTop + view.clientHeight / 2 - offsetY) / Math.max(.001, scale);
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
    document.addEventListener('pointerdown', cancelMemberFocus, { capture:true, passive:true });
    document.addEventListener('keydown', cancelMemberFocus, { capture:true });
    view?.addEventListener('wheel', cancelMemberFocus, { capture:true, passive:true });
    window.addEventListener('resize', cancelMemberFocus, { passive:true });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      if (focusTarget && viewport()) viewport().scrollTo({ ...focusTarget, behavior:'instant' });
      cancelMemberFocus();
    });
    view?.addEventListener('wheel', event => {
      if (isMobileLayout() || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const rect = view.getBoundingClientRect();
      const anchor = {
        x: Math.max(0, Math.min(view.clientWidth, event.clientX - rect.left)),
        y: Math.max(0, Math.min(view.clientHeight, event.clientY - rect.top))
      };
      const logical = {
        x: (view.scrollLeft + anchor.x - offsetX) / Math.max(.001, scale),
        y: (view.scrollTop + anchor.y - offsetY) / Math.max(.001, scale)
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
    // Opening/collapsing the desktop inspector changes the canvas width without
    // a window resize. Keep the current anchor, and fit queries to the new space.
    if (view && typeof ResizeObserver === 'function') {
      let size = { width: view.clientWidth, windowWidth: innerWidth, windowHeight: innerHeight };
      let collapsedInspectorAnchor = null;
      let pendingInspectorAnchor = null;
      window.addEventListener('familydetailslayoutbefore', event => {
        if (isMobileLayout()) return;
        if (event.detail?.preserveScroll) {
          cancelMemberFocus();
          pendingCloseScroll = { left:view.scrollLeft, top:view.scrollTop };
        } else { pendingCloseScroll = null; pendingInspectorAnchor = captureViewportAnchor(); }
      });
      new ResizeObserver(() => {
        const next = { width: view.clientWidth, windowWidth: innerWidth, windowHeight: innerHeight };
        const changed = Math.abs(next.width - size.width) > 1;
        const widening = next.width > size.width;
        const windowChanged = next.windowWidth !== size.windowWidth || next.windowHeight !== size.windowHeight;
        size = next;
        // Window resizing and virtual keyboards remain handled by the coordinator.
        if (!changed || windowChanged || isMobileLayout() || rendering || !naturalWidth) {
          pendingInspectorAnchor = null; pendingCloseScroll = null; return;
        }
        if (pendingCloseScroll) {
          const position = pendingCloseScroll;
          pendingCloseScroll = null; pendingInspectorAnchor = null; collapsedInspectorAnchor = null;
          // Closing reveals more canvas to the right; keep existing content at
          // its screen position instead of recentering it in the wider viewport.
          // Reserve enough scroll range even at the old right-hand boundary.
          restoreScrollPosition(position);
          return;
        }
        if (isQueryVisible() && !focusFrame) { collapsedInspectorAnchor = null; fitQuery(); return; }
        const selectedId = getSelectedId();
        const stable = getStableViewportAnchor();
        let anchor = pendingInspectorAnchor || (selectedId && stable?.personId !== selectedId ? captureViewportAnchor() : stable);
        pendingInspectorAnchor = null;
        // A small graph may hit a scroll boundary in the wider, collapsed view.
        // Preserve the original docked anchor so expanding is still reversible.
        if (!widening && selectedId && collapsedInspectorAnchor?.personId === selectedId) anchor = collapsedInspectorAnchor;
        if (widening && selectedId) collapsedInspectorAnchor = anchor;
        else collapsedInspectorAnchor = null;
        applyScale();
        if (focusFrame) return; // Member navigation owns the new inspector width.
        restoreViewportAnchor(anchor);
      }).observe(view);
    }
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
    logicalAtAnchor,
    fitWidth,
    fitView,
    prepareScale,
    prepareQueryFit,
    centerQuery,
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
    focusMember,
    refreshLayout: updateSpacer,
    restoreScrollPosition,
    isRendering: () => rendering
  };
}
