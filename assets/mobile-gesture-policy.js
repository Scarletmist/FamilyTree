(() => {
  'use strict';

  const MOBILE_QUERY = '(max-width: 700px), (max-width: 950px) and (max-height: 520px) and (pointer: coarse)';
  const LANDSCAPE_QUERY = '(max-width: 950px) and (max-height: 520px) and (pointer: coarse) and (orientation: landscape)';
  const mobile = () => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
  const landscapeMobile = () => typeof window.matchMedia === 'function' && window.matchMedia(LANDSCAPE_QUERY).matches;

  // Safari exposes non-standard gesture* events for native page pinch zoom.
  // The canvas already owns pinch through Pointer Events + touch-action:none,
  // so only suppress native page pinch when it begins outside the canvas.
  function shouldBlockNativeGesture(event) {
    if (!mobile()) return false;
    const target = event.target instanceof Element ? event.target : null;
    return !target?.closest('.tree');
  }

  function preventNativePageZoom(event) {
    if (!shouldBlockNativeGesture(event)) return;
    if (event.cancelable) event.preventDefault();
  }

  ['gesturestart', 'gesturechange', 'gestureend'].forEach(type => {
    document.addEventListener(type, preventNativePageZoom, { passive: false, capture: true });
  });

  function computeBottomInset(layoutHeight, viewportHeight, offsetTop = 0) {
    const layout = Number(layoutHeight) || 0;
    const visual = Number(viewportHeight) || layout;
    const top = Number(offsetTop) || 0;
    return Math.max(0, Math.round(layout - visual - top));
  }

  // Keep a stable landscape layout height while the software keyboard changes
  // VisualViewport.  iOS can report window.innerHeight at an intermediate value
  // while the keyboard is dismissing; deriving the dialog bottom from that value
  // leaves a stale gap after the keyboard closes.
  let viewportBaseline = 0;
  let viewportOrientation = '';
  let settleTimer = 0;
  const KEYBOARD_THRESHOLD = 80;

  function orientationKey() {
    return `${window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'}:${Math.round(Math.max(window.innerWidth, window.innerHeight))}`;
  }

  function visualViewportState() {
    const vv = window.visualViewport;
    const height = Math.max(0, Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0));
    const top = Math.max(0, Math.round(vv?.offsetTop || 0));
    const candidate = Math.max(
      Number(window.innerHeight) || 0,
      Number(document.documentElement.clientHeight) || 0,
      height + top
    );
    const key = orientationKey();
    if (key !== viewportOrientation) {
      viewportOrientation = key;
      viewportBaseline = candidate;
    } else if (candidate > viewportBaseline || height >= viewportBaseline - KEYBOARD_THRESHOLD) {
      viewportBaseline = Math.max(candidate, height + top);
    }
    if (!viewportBaseline) viewportBaseline = candidate || height;
    const rawInset = computeBottomInset(viewportBaseline, height, top);
    const keyboardInset = rawInset >= KEYBOARD_THRESHOLD ? rawInset : 0;
    return { height, top, baseline: viewportBaseline, inset: keyboardInset };
  }

  let focusFrame = 0;
  function ensureFocusedControlVisible() {
    if (!landscapeMobile()) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const dialog = active.closest('dialog[open]');
    if (!dialog) return;
    const scroller = active.closest('.form-scroll,.dialog-scroll,.member-list-scroll,.relationship-search,.relationship-sheet,.select-options');
    if (!(scroller instanceof HTMLElement)) return;
    const vv = window.visualViewport;
    const visualTop = vv?.offsetTop || 0;
    const visualBottom = visualTop + (vv?.height || window.innerHeight);
    const scrollRect = scroller.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const safeTop = Math.max(scrollRect.top, visualTop) + 12;
    const safeBottom = Math.min(scrollRect.bottom, visualBottom) - 12;
    if (activeRect.top >= safeTop && activeRect.bottom <= safeBottom) return;
    const delta = (activeRect.top + activeRect.bottom) / 2 - (safeTop + safeBottom) / 2;
    scroller.scrollTop += delta;
  }

  function scheduleFocusedControlVisibility() {
    if (focusFrame) cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      ensureFocusedControlVisible();
      setTimeout(ensureFocusedControlVisible, 120);
    });
  }

  function syncVisualViewport() {
    const state = visualViewportState();
    const root = document.documentElement;
    root.style.setProperty('--visual-viewport-height', `${state.height}px`);
    root.style.setProperty('--visual-viewport-top', `${state.top}px`);
    root.style.setProperty('--visual-viewport-bottom-inset', `${state.inset}px`);
    root.dataset.visualKeyboard = String(landscapeMobile() && state.inset >= KEYBOARD_THRESHOLD);
    if (landscapeMobile() && document.querySelector('dialog[open]')) scheduleFocusedControlVisibility();
    return state.inset;
  }

  function settleVisualViewport() {
    syncVisualViewport();
    if (settleTimer) clearTimeout(settleTimer);
    requestAnimationFrame(syncVisualViewport);
    settleTimer = setTimeout(() => {
      settleTimer = 0;
      syncVisualViewport();
    }, 180);
  }

  window.visualViewport?.addEventListener('resize', settleVisualViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', settleVisualViewport, { passive: true });
  window.addEventListener('resize', settleVisualViewport, { passive: true });
  window.addEventListener('orientationchange', () => {
    viewportBaseline = 0;
    viewportOrientation = '';
    settleVisualViewport();
  }, { passive: true });
  document.addEventListener('focusin', event => {
    if (!landscapeMobile() || !event.target.closest?.('dialog[open]')) return;
    scheduleFocusedControlVisibility();
    settleVisualViewport();
  });
  document.addEventListener('focusout', event => {
    if (!landscapeMobile() || !event.target.closest?.('dialog[open]')) return;
    // Safari's final VisualViewport resize can arrive after focus leaves the field.
    // Re-sample again after the dismissal animation so full-height dialogs return
    // all the way to the bottom instead of keeping the keyboard inset.
    settleVisualViewport();
    setTimeout(syncVisualViewport, 320);
  });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('toggle', syncVisualViewport);
    dialog.addEventListener('close', syncVisualViewport);
  });
  syncVisualViewport();

  // Expose read-only hooks for browser regression tests; application logic does
  // not depend on them.
  window.FamilyMobileGesturePolicy = Object.freeze({
    isMobile: mobile,
    isLandscapeMobile: landscapeMobile,
    shouldBlockNativeGesture,
    computeBottomInset,
    visualViewportState,
    syncVisualViewport,
    ensureFocusedControlVisible
  });
})();
