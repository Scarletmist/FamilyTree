(() => {
  'use strict';

  const MOBILE_QUERY = '(max-width: 700px), (max-width: 950px) and (max-height: 520px) and (pointer: coarse)';
  const mobile = () => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;

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

  // Expose a tiny read-only hook for browser regression tests; it is not used by
  // application logic and avoids relying on Safari-only GestureEvent support.
  window.FamilyMobileGesturePolicy = Object.freeze({
    isMobile: mobile,
    shouldBlockNativeGesture
  });
})();
