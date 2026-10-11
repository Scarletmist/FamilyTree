(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyMemberDetailLayout = api;
})(globalThis, function () {
  'use strict';
  const mobileQuery = '(max-width:700px), (max-width:950px) and (max-height:520px)';
  const landscapeQuery = '(max-width:950px) and (max-height:520px) and (orientation:landscape)';
  const expandPath = 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5';
  const restorePath = 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5';

  function releaseMode({ height, velocity, viewportHeight, cancelled = false, currentMode = 'browse' }) {
    if (cancelled) return currentMode;
    const projected = height + Math.max(-180, Math.min(180, velocity * .15));
    return projected < viewportHeight * .32 ? 'compact' : projected > viewportHeight * .79 ? 'read' : 'browse';
  }

  function create(panel, { setCollapsed }) {
    const mobile = matchMedia(mobileQuery), landscape = matchMedia(landscapeQuery);
    const reduced = matchMedia('(prefers-reduced-motion:reduce)');
    const scrim = document.createElement('div');
    scrim.className = 'detail-reading-scrim'; scrim.hidden = true; scrim.setAttribute('aria-hidden', 'true');
    document.body.append(scrim);
    const backgroundStates = new Map(), scrollPositions = new Map();
    let reading = false, frame = 0, drag = null;

    function setReading(value, { focus = false } = {}) {
      const previous = reading;
      reading = Boolean(value) && mobile.matches && !panel.hidden && panel.dataset.collapsed !== 'true';
      panel.dataset.reading = String(reading); scrim.hidden = !reading;
      panel.setAttribute('role', reading ? 'dialog' : 'region');
      if (reading) {
        panel.setAttribute('aria-modal', 'true');
        for (const item of document.querySelectorAll('.page-header,.workspace-toolbar,.workspace > :not(#relationship-details)')) {
          if (!backgroundStates.has(item)) backgroundStates.set(item, item.inert);
          item.inert = true;
        }
      } else {
        panel.removeAttribute('aria-modal');
        for (const [item, inert] of backgroundStates) item.inert = inert;
        backgroundStates.clear();
      }
      const button = panel.querySelector('.detail-expand');
      if (button) {
        const label = reading ? '返回瀏覽面板' : '展開完整閱讀';
        button.setAttribute('aria-label', label); button.title = label;
        button.setAttribute('aria-pressed', String(reading));
        button.querySelector('path').setAttribute('d', reading ? restorePath : expandPath);
        if (focus || (reading && !previous && !panel.contains(document.activeElement))) button.focus({ preventScroll: true });
      }
      if (previous !== reading) dispatchEvent(new CustomEvent('familydetailsreadingchange', { detail: { reading } }));
    }

    function cancelMotion() {
      cancelAnimationFrame(frame); frame = 0;
      const cancelled = drag; drag = null;
      if (cancelled?.top.hasPointerCapture(cancelled.pointerId)) cancelled.top.releasePointerCapture(cancelled.pointerId);
      panel.style.height = '';
    }

    // Height follows the finger so the scroll area grows during the gesture.
    // A critically damped spring carries release velocity into the snap.
    function settle(velocity) {
      cancelAnimationFrame(frame);
      const valueAtRelease = panel.getBoundingClientRect().height;
      panel.style.height = '';
      const target = panel.getBoundingClientRect().height;
      if (reduced.matches) return;
      let value = valueAtRelease, last = performance.now();
      panel.style.height = value + 'px';
      function step(now) {
        const dt = Math.min(.025, (now - last) / 1000); last = now;
        velocity += (420 * (target - value) - 41 * velocity) * dt;
        value += velocity * dt; panel.style.height = value + 'px';
        if (Math.abs(target - value) < .5 && Math.abs(velocity) < 8) {
          frame = 0; panel.style.height = ''; return;
        }
        frame = requestAnimationFrame(step);
      }
      frame = requestAnimationFrame(step);
    }

    function beforeRender() {
      const body = panel.querySelector('.relationship-details__body');
      if (body && panel.dataset.memberId) scrollPositions.set(panel.dataset.memberId, body.scrollTop);
      cancelMotion();
    }

    function afterRender() {
      setReading(reading);
      const body = panel.querySelector('.relationship-details__body');
      if (!body || panel.hidden) return;
      const memberId = panel.dataset.memberId;
      body.scrollTop = scrollPositions.get(memberId) || 0;
      body.addEventListener('scroll', () => scrollPositions.set(memberId, body.scrollTop), { passive: true });
      const top = panel.querySelector('.relationship-details__top');
      top.addEventListener('pointerdown', event => {
        if (!mobile.matches || landscape.matches || event.button !== 0 || drag || event.target.closest('button,summary')) return;
        cancelAnimationFrame(frame); frame = 0;
        drag = { top, pointerId: event.pointerId, start: event.clientY, height: panel.getBoundingClientRect().height,
          samples: [{ y: event.clientY, time: event.timeStamp }], moved: false };
        top.setPointerCapture(event.pointerId);
      });
      top.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = drag.start - event.clientY;
        if (Math.abs(delta) > 6) drag.moved = true;
        if (!drag.moved) return;
        drag.samples.push({ y: event.clientY, time: event.timeStamp });
        drag.samples = drag.samples.filter(sample => event.timeStamp - sample.time <= 100).slice(-6);
        const maximum = parseFloat(getComputedStyle(panel).maxHeight) || innerHeight - 16;
        panel.style.height = Math.min(maximum, Math.max(110, drag.height + delta)) + 'px';
      });
      function endDrag(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const released = drag; drag = null;
        if (top.hasPointerCapture(event.pointerId)) top.releasePointerCapture(event.pointerId);
        if (!released.moved) return;
        const first = released.samples[0], last = released.samples.at(-1);
        const elapsed = last.time - first.time;
        const velocity = elapsed > 0 && event.timeStamp - last.time < 100 ? (first.y - last.y) * 1000 / elapsed : 0;
        const mode = releaseMode({ height: panel.getBoundingClientRect().height, velocity, viewportHeight: innerHeight,
          cancelled: event.type !== 'pointerup', currentMode: reading ? 'read' : 'browse' });
        if (mode === 'compact') {
          panel.style.height = ''; setReading(false); setCollapsed(true, { focus: true });
        } else {
          setReading(mode === 'read'); settle(event.type === 'pointerup' ? velocity : 0);
        }
      }
      top.addEventListener('pointerup', endDrag);
      top.addEventListener('pointercancel', endDrag);
      top.addEventListener('lostpointercapture', endDrag);
    }

    panel.addEventListener('click', event => {
      if (event.target.closest('.detail-expand')) {
        cancelMotion(); setReading(!reading); return;
      }
      const action = event.target.closest('.details-locate,.relationship-details__location,.details-collapse,.details-close,.details-back');
      if (action && (!action.classList.contains('details-back') || action.dataset.returnList === 'true')) {
        cancelMotion(); setReading(false);
      }
      if (event.target.closest('.relationship-details__more-body button')) panel.querySelector('.relationship-details__more').open = false;
    }, true);
    scrim.addEventListener('click', () => { cancelMotion(); setReading(false, { focus: true }); });
    document.addEventListener('keydown', event => {
      if (!reading || document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); cancelMotion(); setReading(false, { focus: true });
      } else if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button,summary,a[href],input,select,textarea,[tabindex="0"]')]
          .filter(item => {
            if (item.disabled || !item.getClientRects().length || item.closest('[hidden],[inert]')) return false;
            // Closed native disclosures can still report rectangles for descendants.
            for (let ancestor = item.parentElement; ancestor && ancestor !== panel; ancestor = ancestor.parentElement) {
              if (ancestor.tagName === 'DETAILS' && !ancestor.open && !(item.tagName === 'SUMMARY' && item.parentElement === ancestor)) return false;
            }
            return true;
          });
        const first = focusable[0], last = focusable.at(-1);
        if (!panel.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        }
      }
    }, true);
    addEventListener('resize', () => { cancelMotion(); setReading(reading); }, { passive: true });
    reduced.addEventListener('change', () => { if (reduced.matches) cancelMotion(); });
    mobile.addEventListener('change', () => { cancelMotion(); setReading(reading); });

    return { beforeRender, afterRender, sync: () => setReading(reading),
      leaveReading: () => { if (!reading) return false; cancelMotion(); setReading(false, { focus: true }); return true; } };
  }
  return { create, releaseMode, mobileQuery, expandPath };
});
