// Three accessible stops, direct pointer tracking and an interruptible critically
// damped settle. No animation library is needed for this one-dimensional gesture.
export function mapSheet({ body, panel, handle, editing, onInset }) {
  const mobile = matchMedia('(max-width:700px) and (orientation:portrait)');
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  let state = 'medium', height = 0, velocity = 0, frame = 0, drag = null;
  const stops = () => {
    const total = body.clientHeight, maximum = Math.max(144, Math.min(total * .78, total - 140));
    return { collapsed:Math.min(maximum, editing() ? 196 : 144), medium:Math.min(maximum, total * (editing() ? .55 : .44)), expanded:maximum };
  };
  function paint(next) {
    height = next;
    if (mobile.matches) { panel.style.height = `${next}px`; onInset(next); }
    else { panel.style.removeProperty('height'); onInset(0); }
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function settle(next, immediate = false) {
    state = next; panel.dataset.sheetState = state; stop();
    const target = stops()[state];
    if (!mobile.matches || immediate || reduce.matches || Math.abs(height - target) < .5) { velocity = 0; paint(target); return; }
    const started = performance.now(), from = height, speed = velocity;
    const omega = 2 * Math.PI / .3; // response .3s, damping ratio 1 (no bounce).
    const offset = from - target, coefficient = speed + omega * offset;
    const tick = now => {
      const elapsed = (now - started) / 1000, decay = Math.exp(-omega * elapsed);
      const nextHeight = target + (offset + coefficient * elapsed) * decay;
      velocity = (coefficient - omega * (offset + coefficient * elapsed)) * decay;
      const limits = stops();
      paint(Math.max(limits.collapsed, Math.min(limits.expanded, nextHeight)));
      if (Math.abs(nextHeight - target) < .5 && Math.abs(velocity) < 5) { velocity = 0; paint(target); frame = 0; }
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  const nearest = next => Object.keys(stops()).reduce((best, key) => Math.abs(stops()[key] - next) < Math.abs(stops()[best] - next) ? key : best, 'collapsed');
  handle.addEventListener('pointerdown', event => {
    if (!mobile.matches || event.button !== 0) return;
    stop(); drag = { id:event.pointerId, y:event.clientY, height, moved:false, samples:[{ y:height, time:event.timeStamp }] };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    if (!drag.moved && Math.abs(delta) < 5) return;
    drag.moved = true;
    const limits = stops(); const next = Math.max(limits.collapsed, Math.min(limits.expanded, drag.height + delta));
    paint(next); drag.samples.push({ y:next, time:event.timeStamp });
    drag.samples = drag.samples.filter(sample => sample.time >= event.timeStamp - 70);
  });
  function release(event, cancelled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const gesture = drag; drag = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    const first = gesture.samples[0], last = gesture.samples.at(-1);
    velocity = !cancelled && event.timeStamp - last.time < 80 && last.time > first.time ? (last.y - first.y) * 1000 / (last.time - first.time) : 0;
    const next = gesture.moved || cancelled ? nearest(height + velocity * .099) : state === 'collapsed' ? 'medium' : state === 'medium' ? 'expanded' : 'collapsed';
    settle(next);
  }
  handle.addEventListener('pointerup', event => release(event));
  handle.addEventListener('pointercancel', event => release(event, true));
  handle.addEventListener('lostpointercapture', event => release(event, true));
  handle.addEventListener('click', event => {
    if (event.detail === 0) settle(state === 'collapsed' ? 'medium' : state === 'medium' ? 'expanded' : 'collapsed', true);
  });
  handle.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); settle(event.key === 'ArrowUp' || event.key === 'End' ? 'expanded' : 'collapsed', true);
    }
  });
  const observer = new ResizeObserver(() => { if (!drag) settle(state, true); }); observer.observe(body);
  mobile.addEventListener('change', () => { drag = null; settle(state, true); });
  reduce.addEventListener('change', () => { if (reduce.matches) settle(state, true); });
  return { get state() { return state; }, set:(next, immediate = true) => settle(next, immediate), close:() => { stop(); drag = null; } };
}
