(function () {
  'use strict';
  const root = document.documentElement;
  // Default to immediate interaction until a real pointer gesture occurs.
  root.dataset.motionInput = 'keyboard';
  document.addEventListener('pointerdown', () => { root.dataset.motionInput = 'pointer'; }, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) root.dataset.motionInput = 'keyboard';
  }, { capture: true });
  document.addEventListener('click', event => {
    // Assistive activation has no pointerdown. Ignore scripted clicks used by
    // toolbar shortcuts so they retain the original gesture's input modality.
    if (event.isTrusted && event.detail === 0) root.dataset.motionInput = 'keyboard';
  }, { capture: true });

  const reveals = new WeakMap();
  window.FamilyMotion = {
    canAnimate: () => root.dataset.motionInput === 'pointer' && CSS.supports('transition-behavior', 'allow-discrete'),
    shouldScrollSmooth: () => root.dataset.motionInput === 'pointer' && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    reveal(element, className = 'motion-details-reveal') {
      reveals.get(element)?.();
      if (!window.FamilyMotion.canAnimate()) return;
      // The newly unhidden content gets @starting-style; its layout and focus
      // are already final. No animation timer controls application state.
      element.classList.add(className);
      const cleanup = () => {
        if (reveals.get(element) !== cleanup) return;
        cancelAnimationFrame(frame);
        element.classList.remove(className);
        reveals.delete(element);
      };
      const frame = requestAnimationFrame(() => {
        // Read the real transitions after styles are applied. Completion also
        // handles reduced motion, interruption and keyboard cancellation.
        const transitions = element.getAnimations().filter(animation => animation.effect?.target === element);
        Promise.allSettled(transitions.map(animation => animation.finished)).then(cleanup);
      });
      reveals.set(element, cleanup);
    }
  };
})();
