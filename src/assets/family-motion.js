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
    reveal(element) {
      clearTimeout(reveals.get(element));
      element.classList.remove('motion-details-reveal');
      if (!window.FamilyMotion.canAnimate()) return;
      // The newly unhidden content gets @starting-style; its layout and focus
      // are already final. No animation timer controls application state.
      element.classList.add('motion-details-reveal');
      reveals.set(element, setTimeout(() => {
        element.classList.remove('motion-details-reveal');
        reveals.delete(element);
      }, 180));
    }
  };
})();
