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
    const vv = window.visualViewport;
    const layoutHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const inset = vv ? computeBottomInset(layoutHeight, vv.height, vv.offsetTop) : 0;
    document.documentElement.style.setProperty('--visual-viewport-bottom-inset', `${inset}px`);
    document.documentElement.dataset.visualKeyboard = String(landscapeMobile() && inset >= 80);
    if (landscapeMobile() && document.querySelector('dialog[open]')) scheduleFocusedControlVisibility();
    return inset;
  }

  window.visualViewport?.addEventListener('resize', syncVisualViewport, { passive: true });
  window.visualViewport?.addEventListener('scroll', syncVisualViewport, { passive: true });
  window.addEventListener('resize', syncVisualViewport, { passive: true });
  document.addEventListener('focusin', event => {
    if (!landscapeMobile() || !event.target.closest?.('dialog[open]')) return;
    scheduleFocusedControlVisibility();
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
    syncVisualViewport,
    ensureFocusedControlVisible
  });
})();
