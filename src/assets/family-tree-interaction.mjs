export function createMemberTooltip({ getHideNames = () => false } = {}) {
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
      name.textContent = getHideNames() ? 'OOO' : person.name;
      body.textContent = person.notes;
      tooltip.classList.remove('is-visible');
      tooltip.hidden = false;
      node.setAttribute('aria-describedby', 'member-tooltip');
      position();
      requestAnimationFrame(() => {
        if (anchor === node && !tooltip.hidden) tooltip.classList.add('is-visible');
      });
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
      else setTimeout(() => {
        if (!anchor && !tooltip.classList.contains('is-visible')) tooltip.hidden = true;
      }, 150);
    };
    clearTimeout(hideTimer);
    if (immediate) conceal();
    else hideTimer = setTimeout(conceal, HIDE_DELAY);
  }

  function refreshName() {
    if (!tooltip?.hidden && activePerson) {
      name.textContent = getHideNames() ? 'OOO' : activePerson.name;
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
}

export function bindMobileOverlayAvoidance() {
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
      const inset = Math.max(0, Math.ceil(workspaceRect.bottom - detailsRect.top + 8));
      workspace.style.setProperty('--mobile-overlay-bottom', `${inset}px`);
    });
  }
  new MutationObserver(update).observe(details, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ['hidden', 'data-collapsed', 'style', 'class']
  });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(update);
    observer.observe(details);
    observer.observe(workspace);
  }
  portrait.addEventListener?.('change', update);
  window.addEventListener('resize', update, { passive: true });
  update();
}

function hasOpenPopover() {
  try { return !!document.querySelector(':popover-open'); } catch (_) { return false; }
}

export function bindGlobalDismiss(closeSelectedDetails) {
  if (document.documentElement.dataset.familyDismissBound) return;
  document.documentElement.dataset.familyDismissBound = 'true';
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    const hasModal = openDialogs.some(dialog => {
      try { return dialog.matches(':modal'); } catch (_) { return false; }
    });
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

export function bindMobileBackNavigation(closeSelectedDetails) {
  if (document.documentElement.dataset.familyMobileBackBound) return;
  document.documentElement.dataset.familyMobileBackBound = 'true';
  const mobile = window.matchMedia?.('(max-width:950px) and (pointer:coarse)');
  if (!mobile) return;
  const ROOT = '__familyTreeMobileRoot';
  const GUARD = '__familyTreeMobileGuard';
  const hadPreviousEntry = history.length > 1;
  let leaving = false;

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
      requestAnimationFrame(arm);
      return;
    }
    if (hadPreviousEntry) {
      leaving = true;
      history.back();
    } else requestAnimationFrame(arm);
  });
  arm();
}

export function bindPanning(viewport, {
  viewportController,
  getSelectedId = () => null,
  closeSelectedDetails = () => false
}) {
  if (viewport.dataset.panBound) return;
  viewport.dataset.panBound = 'true';

  let suppressClick = false;
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
    if (!viewportController.isMobileLayout()) return null;
    let best = null;
    viewport.querySelectorAll('.person,.intermediate-node').forEach(node => {
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const expandX = Math.max(0, (MIN_SCREEN_TOUCH_TARGET - rect.width) / 2);
      const expandY = Math.max(0, (MIN_SCREEN_TOUCH_TARGET - rect.height) / 2);
      if (!expandX && !expandY) return;
      if (clientX < rect.left - expandX || clientX > rect.right + expandX
        || clientY < rect.top - expandY || clientY > rect.bottom + expandY) return;
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
    const scale = viewportController.getScale();
    viewportController.beginSemanticGesture();
    pinch = {
      ids: [a.id, b.id],
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale,
      logical: viewportController.logicalAtAnchor(mid)
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
    viewportController.setScaleAroundLogical(pinch.scale * (distance / pinch.distance), pinch.logical, mid);
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
      if (Math.hypot(vx, vy) < .025) {
        inertiaFrame = 0;
        return;
      }
      inertiaFrame = requestAnimationFrame(frame);
    }
    inertiaFrame = requestAnimationFrame(frame);
  }

  viewport.addEventListener('pointerdown', event => {
    if (viewportController.isMobileLayout() && event.pointerType !== 'mouse') {
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
    mouseDrag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      moved: false
    };
  });

  viewport.addEventListener('pointermove', event => {
    if (viewportController.isMobileLayout() && event.pointerType !== 'mouse') {
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
    const dx = event.clientX - mouseDrag.x;
    const dy = event.clientY - mouseDrag.y;
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
    viewportController.endSemanticGesture();
    if (!cancelled && endedSingle?.moved) startInertia(endedSingle.vx, endedSingle.vy);
  }

  function finish(event, cancelled = false) {
    if (viewportController.isMobileLayout() && event.pointerType !== 'mouse') {
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
    if (suppressClick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick = false;
      return;
    }
    if (!viewportController.isMobileLayout() || event.target.closest?.('.person,.intermediate-node')) return;
    const target = proximityTouchTarget(event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    proximityDispatching = true;
    try { target.click(); } finally { proximityDispatching = false; }
  }, true);
  viewport.addEventListener('click', event => {
    if (!getSelectedId() || event.defaultPrevented) return;
    if (event.target.closest?.('.person,.intermediate-node')) return;
    closeSelectedDetails();
  });
  viewport.addEventListener('dragstart', event => event.preventDefault());
}
