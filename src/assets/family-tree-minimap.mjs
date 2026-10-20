import { element,svgElement } from './family-tree-renderer.mjs';
export function createMinimapGeometry(scene) {
  const fragment = document.createDocumentFragment();
  if (scene.nodes.length <= 200) for (const shape of scene.shapes.filter(s => s.tag === 'path')) {
    fragment.append(svgElement('path',{d:shape.attrs.d,fill:'none',stroke:shape.attrs.stroke || '#a89782','stroke-width':1,'vector-effect':'non-scaling-stroke'}));
  }
  for (const node of scene.nodes) fragment.append(svgElement('rect',{x:node.x,y:node.y,width:node.width,height:node.height,rx:6,fill:node.archived ? '#c8b8a2' : '#a28b6c'}));
  return fragment;
}
export function updateMinimapViewport(viewport,r,scene) {
  for (const [key,value] of Object.entries({x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.max(0,Math.min(scene.width,r.x + r.width) - Math.max(0,r.x)),height:Math.max(0,Math.min(scene.height,r.y + r.height) - Math.max(0,r.y))})) viewport.setAttribute(key,value);
}
export function createMinimap({camera,getSelectedId}) {
  const mobile = matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px)');
  let expanded = !mobile.matches,scene = null,frame = 0,drag = null;
  const panel = element('aside','tree-minimap'); panel.id = 'tree-minimap';panel.setAttribute('aria-label','全圖導覽');
  const header = element('div','tree-minimap__header'),label = element('span','','全圖');
  const close = element('button','details-icon');close.type = 'button';close.setAttribute('aria-label','收合全圖導覽');
  close.append(svgElement('svg',{viewBox:'0 0 24 24',width:18,height:18,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}));
  close.firstChild.append(svgElement('path',{d:'M18 6 6 18 M6 6l12 12'}));
  header.append(label,close);
  const svg = svgElement('svg',{class:'tree-minimap__surface',tabindex:'0',role:'group','aria-label':'全圖導覽：點選定位、拖曳視窗，方向鍵移動，Home 看全圖'});
  const geometry = svgElement('g'),selected = svgElement('rect',{class:'tree-minimap__selected',fill:'none',stroke:'#a33e2c','stroke-width':3,'vector-effect':'non-scaling-stroke'});
  const viewport = svgElement('rect',{class:'tree-minimap__viewport',fill:'#286e861c',stroke:'#286e86','stroke-width':2,'vector-effect':'non-scaling-stroke'});
  svg.append(geometry,selected,viewport);
  const actions = element('div','tree-minimap__actions'),fit = element('button','plain-button','看全圖'),member = element('button','plain-button','定位目前人物');
  fit.type = member.type = 'button';actions.append(fit,member);panel.append(header,svg,actions);document.querySelector('.workspace').append(panel);
  const toggle = document.getElementById('toggle-tree-minimap');
  function sync() {toggle?.setAttribute('aria-pressed',String(expanded));refresh();}
  toggle?.addEventListener('click',() => {expanded = !expanded;sync();});
  function collapse() {
    expanded = false;sync();
    [...document.querySelectorAll('[id$="-more-open"]')].find(button => button.getClientRects().length)?.focus({preventScroll:true});
  }
  close.addEventListener('click',collapse);
  fit.addEventListener('click',() => camera.fitView());member.addEventListener('click',() => camera.focusMember(getSelectedId()));
  for (const type of ['pointerdown','click','wheel']) panel.addEventListener(type,event => event.stopPropagation());
  const point = event => {const m = svg.getScreenCTM();return m ? new DOMPoint(event.clientX,event.clientY).matrixTransform(m.inverse()) : null;};
  svg.addEventListener('pointerdown',event => {
    if (!scene || event.button !== 0) return;event.preventDefault();
    const p = point(event),visible = camera.visibleWorldRect();if (!p || !visible) return;
    const inFrame = p.x >= visible.x && p.x <= visible.x + visible.width && p.y >= visible.y && p.y <= visible.y + visible.height;
    drag = {id:event.pointerId,offsetX:inFrame ? p.x - visible.x - visible.width / 2 : 0,offsetY:inFrame ? p.y - visible.y - visible.height / 2 : 0};
    svg.setPointerCapture(event.pointerId);camera.centerOnWorld(p.x - drag.offsetX,p.y - drag.offsetY);refresh();
  });
  svg.addEventListener('pointermove',event => {if (drag?.id !== event.pointerId) return;event.preventDefault();const p = point(event);if (p) camera.centerOnWorld(p.x - drag.offsetX,p.y - drag.offsetY);refresh();});
  for (const type of ['pointerup','pointercancel','lostpointercapture']) svg.addEventListener(type,() => {drag = null;});
  svg.addEventListener('keydown',event => {
    const r = camera.visibleWorldRect();if (!r) return;
    const shift = {ArrowLeft:[-r.width / 4,0],ArrowRight:[r.width / 4,0],ArrowUp:[0,-r.height / 4],ArrowDown:[0,r.height / 4]}[event.key];
    if (shift) {event.preventDefault();event.stopPropagation();camera.centerOnWorld(r.x + r.width / 2 + shift[0],r.y + r.height / 2 + shift[1]);}
    else if (event.key === 'Home') {event.preventDefault();event.stopPropagation();camera.fitView();}
    else if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();collapse();}
  });
  function update() {
    frame = 0;
    const r = camera.visibleWorldRect(),reading = document.getElementById('relationship-details')?.dataset.reading === 'true';
    const keyboard = mobile.matches && window.visualViewport && innerHeight - window.visualViewport.height > 150;
    const blocked = !expanded || !scene || reading || keyboard || document.querySelector('dialog[open]') || !r || r.screen.bottom - r.screen.top < 175;
    panel.hidden = Boolean(blocked);if (blocked) return;
    const workspace = panel.parentElement.getBoundingClientRect(),available = r.screen.bottom - r.screen.top;
    panel.style.right = Math.max(8,workspace.right - r.screen.right + 12) + 'px';
    panel.style.top = (r.screen.top - workspace.top + 12) + 'px';
    svg.style.height = Math.max(64,Math.min(128,available - 116)) + 'px';
    updateMinimapViewport(viewport,r,scene);
    const node = scene.nodes.find(n => n.id === getSelectedId());selected.hidden = !node;selected.style.display = node ? '' : 'none';
    if (node) for (const key of ['x','y','width','height']) selected.setAttribute(key,node[key]);
    member.disabled = !node;
  }
  function refresh() {if (!frame) frame = requestAnimationFrame(update);}
  function setScene(next,scope = '全圖') {
    scene = next; geometry.replaceChildren();
    if (scene) {
      svg.setAttribute('viewBox',`0 0 ${scene.width} ${scene.height}`);
      panel.dataset.simplified = String(scene.nodes.length > 200);
      label.textContent = scope + (scene.nodes.length > 200 ? ' · 精簡導覽' : '');
      geometry.append(createMinimapGeometry(scene));
    }
    refresh();
  }
  document.querySelector('.tree').addEventListener('scroll',refresh,{passive:true});
  addEventListener('resize',refresh,{passive:true});window.visualViewport?.addEventListener('resize',refresh,{passive:true});
  addEventListener('familydetailsreadingchange',refresh);
  const observer = new MutationObserver(refresh);
  document.querySelectorAll('dialog').forEach(d => observer.observe(d,{attributes:true,attributeFilter:['open']}));
  observer.observe(document.getElementById('relationship-details'),{attributes:true,attributeFilter:['hidden','data-collapsed','data-reading']});
  // Dialogs added by other feature modules are also observed once they appear.
  new MutationObserver(records => {for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) {
    for (const d of [ ...(node.matches('dialog') ? [node] : []),...node.querySelectorAll('dialog')]) observer.observe(d,{attributes:true,attributeFilter:['open']});
  }refresh();}).observe(document.body,{childList:true});
  mobile.addEventListener('change',() => {expanded = !mobile.matches;sync();});sync();
  return {setScene,refresh};
}
