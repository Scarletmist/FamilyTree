/* Interactive review adapter. Changes only this template's DOM. */
addEventListener('DOMContentLoaded', () => {
  const mobile = matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px)');
  const landscape = matchMedia('(max-width:950px) and (max-height:520px) and (orientation:landscape)');
  const panel = document.querySelector('#relationship-details');
  const scrim = document.createElement('div'); scrim.className = 'detail-reading-scrim'; scrim.hidden = true; scrim.setAttribute('aria-hidden','true'); document.body.append(scrim);
  let reading = false, initial = true, scheduled = false, frame = 0, drag = null, focusTimer = 0;
  const scrollPositions = new Map();
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const background = () => [...document.querySelectorAll('.page-header,.workspace-toolbar,.workspace > :not(#relationship-details)')];
  function report() {
    const height = panel.hidden || panel.dataset.collapsed === 'true' ? 0 : Math.round(panel.querySelector('.relationship-details__body')?.clientHeight || 0);
    if (parent !== window) parent.postMessage({type:'detail-template-state',mode:panel.dataset.collapsed === 'true' ? 'compact' : reading ? 'read' : 'browse',height},location.origin);
  }
  function setReading(value) {
    const previousReading = reading;
    reading = Boolean(value) && mobile.matches && !panel.hidden && panel.dataset.collapsed !== 'true';
    panel.dataset.reading = String(reading); scrim.hidden = !reading;
    panel.setAttribute('role', reading ? 'dialog' : 'region');
    if (reading) panel.setAttribute('aria-modal','true'); else panel.removeAttribute('aria-modal');
    for(const item of background()) { item.inert = reading; item.classList.toggle('detail-template-inert',reading); }
    const button = panel.querySelector('.detail-expand');
    if(button) { button.setAttribute('aria-label', reading ? '返回瀏覽面板' : '展開完整閱讀'); button.title = reading ? '返回瀏覽面板' : '展開完整閱讀'; button.setAttribute('aria-pressed',String(reading)); button.querySelector('path').setAttribute('d',reading ? 'M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5' : 'M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5'); }
    report();
    if(previousReading !== reading && !reading) centerAfterLayout();
  }
  function centerAfterLayout() {
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      if(!landscape.matches || reading || panel.hidden || panel.dataset.collapsed === 'true' || !panel.dataset.memberId) return;
      dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:panel.dataset.memberId,options:{preserveDetailsState:true}}}));
    },200);
  }
  function settle(target, velocity) {
    cancelAnimationFrame(frame);
    if(reduced.matches) { panel.style.height = ''; report(); return; }
    let value = panel.getBoundingClientRect().height, last = performance.now();
    function step(now) {
      const dt = Math.min(.025,(now-last)/1000); last = now;
      velocity += (420*(target-value)-41*velocity)*dt; value += velocity*dt;
      panel.style.height = value + 'px';
      if(Math.abs(target-value)<.5 && Math.abs(velocity)<8) { panel.style.height = ''; report(); return; }
      frame = requestAnimationFrame(step);
    }
    frame = requestAnimationFrame(step);
  }
  function enhance() {
    scheduled = false;
    if(!panel || !mobile.matches) return;
    if(panel.hidden) { setReading(false); return; }
    const top = panel.querySelector('.relationship-details__top'), body = panel.querySelector('.relationship-details__body'), nav = panel.querySelector('.relationship-details__navigation');
    if(!top || !body || !nav) return;
    if(!nav.querySelector('.detail-expand')) {
      const header = panel.querySelector('.relationship-details__header'), actions = panel.querySelector('.relationship-details__actions');
      const overview = document.createElement('div'); overview.className = 'detail-overview'; overview.append(header,actions); body.prepend(overview);
      const memberId = panel.dataset.memberId;
      body.scrollTop = scrollPositions.get(memberId) || 0;
      body.addEventListener('scroll',()=>scrollPositions.set(memberId,body.scrollTop),{passive:true});
      const add = actions.querySelector('.add-relative'); if(add) actions.querySelector('.relationship-details__more-body').append(add);
      const title = document.createElement('span'); title.className = 'detail-nav-title'; title.textContent = header.querySelector('h2').textContent; nav.querySelector('.details-back').after(title);
      const expand = document.createElement('button'); expand.className = 'details-icon detail-expand'; expand.type = 'button'; expand.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5"/></svg>';
      nav.querySelector('.details-collapse').before(expand); expand.addEventListener('click',()=>{ cancelAnimationFrame(frame); panel.style.height = ''; setReading(!reading); });
      const grabber = document.createElement('div'); grabber.className = 'detail-grabber'; grabber.setAttribute('aria-hidden','true'); top.prepend(grabber);
      top.addEventListener('pointerdown',event => {
        if(landscape.matches || event.button !== 0 || event.target.closest('button,summary')) return;
        cancelAnimationFrame(frame); const height = panel.getBoundingClientRect().height;
        drag = {start:event.clientY,height,last:event.clientY,time:event.timeStamp,velocity:0,moved:false}; top.setPointerCapture(event.pointerId);
      });
      top.addEventListener('pointermove',event => {
        if(!drag) return; const delta = drag.start-event.clientY;
        if(Math.abs(delta)>6) drag.moved = true;
        if(!drag.moved) return;
        const elapsed = event.timeStamp-drag.time;
        if(elapsed>0) drag.velocity = (drag.last-event.clientY)*1000/elapsed;
        drag.last = event.clientY; drag.time = event.timeStamp;
        panel.style.height = Math.min(innerHeight-16,Math.max(110,drag.height+delta))+'px';
      });
      const endDrag = event => {
        if(!drag) return; const released = drag; drag = null;
        if(top.hasPointerCapture(event.pointerId)) top.releasePointerCapture(event.pointerId);
        if(!released.moved) return;
        const height = panel.getBoundingClientRect().height, projected = height + Math.max(-180,Math.min(180,released.velocity*.15));
        if(projected<innerHeight*.32) { panel.style.height = ''; panel.querySelector('.details-collapse').click(); setReading(false); return; }
        if(event.type === 'pointercancel') { panel.style.height = ''; report(); return; }
        setReading(projected>innerHeight*.79);
        settle(reading ? innerHeight-16 : innerHeight*.63,released.velocity);
      };
      top.addEventListener('pointerup',endDrag); top.addEventListener('pointercancel',endDrag);
      actions.addEventListener('click',event => { if(event.target.closest('.details-locate')) setReading(false); });
      body.addEventListener('click',event => { if(event.target.closest('.relationship-details__location')) setReading(false); },true);
      nav.querySelector('.details-collapse').addEventListener('click',()=>setReading(false));
      nav.querySelector('.details-close').addEventListener('click',()=>setReading(false));
      nav.querySelector('.details-back').addEventListener('click',()=> { if(!nav.querySelector('.details-back').getAttribute('aria-label').includes('清單')) return; setReading(false); });
      if(initial) { for(const group of body.querySelectorAll('details[data-group]')) if(['parents','children'].includes(group.dataset.group)) group.open = true; initial = false; }
    }
    if(panel.dataset.collapsed === 'true') setReading(false); else setReading(reading);
    report();
  }
  new MutationObserver(()=>{ if(!scheduled) { scheduled = true; requestAnimationFrame(enhance); } }).observe(panel,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-collapsed']});
  new ResizeObserver(report).observe(panel);
  addEventListener('resize',()=>{cancelAnimationFrame(frame);panel.style.height='';drag=null;enhance();centerAfterLayout();});
  addEventListener('message',event=>{
    if(event.origin !== location.origin || event.source !== parent || event.data.type !== 'detail-template-mode') return;
    if(panel.hidden) openExample();
    if(event.data.mode === 'compact') { panel.querySelector('.details-collapse')?.click(); setReading(false); }
    else { if(panel.dataset.collapsed === 'true') panel.querySelector('.relationship-details__tab')?.click(); setReading(event.data.mode === 'read'); }
  });
  scrim.addEventListener('click',()=>setReading(false));
  addEventListener('keydown',event=> {
    if(!reading || document.querySelector('dialog[open]')) return;
    if(event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); setReading(false); panel.querySelector('.detail-expand')?.focus(); }
    if(event.key === 'Tab') {
      const focusable = [...panel.querySelectorAll('button,summary,a,input,select,textarea')].filter(item => !item.disabled && item.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  },true);
  function openExample() {
    if(document.querySelector('#relationship-search')?.getAttribute('aria-busy') === 'true') return false;
    const node = [...document.querySelectorAll('.person')].find(item => item.querySelector('.person__name')?.textContent === '陳文彬');
    if(!node) return false;
    dispatchEvent(new CustomEvent('familytreeselect',{detail:{id:node.dataset.personId,options:{expandDetails:true}}}));
    enhance(); return !panel.hidden;
  }
  let opening = false;
  const startup = new MutationObserver(scheduleExample);
  function scheduleExample() {
    if(opening) return;
    opening = true;
    requestAnimationFrame(() => { opening = false; if(openExample()) startup.disconnect(); });
  }
  startup.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']}); scheduleExample();
});
