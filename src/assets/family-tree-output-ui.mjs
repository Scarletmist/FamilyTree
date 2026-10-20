import { element } from './family-tree-renderer.mjs';
import { createTreeLayout } from './family-tree-layout.mjs';
import { renderDiagram } from './family-tree-diagram.mjs';
import { captureScene,projectOutputGraph,buildSourceAppendix } from './family-tree-scene.mjs';
import { serializeSVG,paginateScene,printDocument,wrapText,svgHeaderHeight } from './family-tree-output.mjs';

export function createExportController({getContext,getGraph}) {
  const dialog = element('dialog','tree-output-dialog');dialog.id = 'tree-output-dialog';dialog.setAttribute('aria-labelledby','tree-output-title');
  dialog.innerHTML = `<header class="tree-output-header"><h2 id="tree-output-title">族譜輸出</h2><button type="button" class="details-icon" data-close aria-label="關閉族譜輸出"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18 M6 6l12 12" /></svg></button></header>
    <div class="tree-output-body"><div class="tree-output-options">
      <label>輸出範圍<select id="tree-output-scope"><option value="all">全家族</option><option value="current">目前顯示範圍</option><option value="path">目前比較路徑</option></select></label>
      <label class="tree-output-check"><input type="checkbox" id="tree-output-archived">包含封存成員</label>
      <label class="tree-output-check"><input type="checkbox" id="tree-output-location">顯示所在地</label>
      <label class="tree-output-check"><input type="checkbox" id="tree-output-position">顯示職位</label>
      <label class="tree-output-check"><input type="checkbox" id="tree-output-sources">附關係來源與說明</label>
      <label>紙張<select id="tree-output-paper"><option>A4</option><option>A3</option></select></label>
      <label>方向<select id="tree-output-orientation"><option value="landscape">橫式</option><option value="portrait">直式</option></select></label>
    </div><p class="tree-output-hint" id="tree-output-privacy"></p><p class="tree-output-hint">封存成員預設省略；需要銜接的成員會保留並標示。回收區成員不會輸出。</p>
    <p id="tree-output-dirty" class="tree-output-hint" role="status"></p>
    <div class="tree-output-preview-tools"><label>預覽頁面<select id="tree-output-page" disabled><option value="all">完整圖</option></select></label><div class="tree-output-preview-mode" role="group" aria-label="預覽縮放"><button type="button" class="plain-button" id="tree-output-fit" aria-pressed="true">適應預覽</button><button type="button" class="plain-button" id="tree-output-original" aria-pressed="false">原尺寸</button></div></div>
    <div class="tree-output-preview is-fit" id="tree-output-preview"><p>建立預覽後，可下載向量圖或開啟列印版。</p></div>
    <p id="tree-output-status" role="status" aria-live="polite"></p></div>
    <footer class="tree-output-actions"><button type="button" class="plain-button" id="tree-output-generate">更新預覽</button><button type="button" class="plain-button" id="tree-output-svg" disabled>下載向量圖（SVG）</button><button type="button" class="primary-button" id="tree-output-print" disabled>列印／PDF</button></footer>`;
  document.body.append(dialog);
  const get = id => document.getElementById('tree-output-' + id),status = get('status'),preview = get('preview');
  let prepared = null,busy = false,opener = null;
  const printWindows = new Set();
  const version = () => JSON.stringify(globalThis.FamilyApp.snapshot()?.version);
  const privacy = () => getContext()?.hideNames === true;
  function invalidate(message = '設定已變更，請更新預覽。') {
    prepared = null;get('svg').disabled = get('print').disabled = get('page').disabled = true;
    get('dirty').textContent = message;
    preview.dataset.stale = 'true';
    for (const popup of printWindows) {
      try {
        if (popup.closed) {printWindows.delete(popup);continue;}
        popup.document.querySelectorAll('.print-page,.appendix').forEach(page => page.style.display = 'none');
        popup.document.getElementById('print-document').disabled = true;
        popup.document.querySelector('.print-toolbar span').textContent = '原族譜或輸出設定已更新，請關閉此視窗並更新預覽。';
      } catch {printWindows.delete(popup);}
    }
    if (dialog.open) status.textContent = message;
  }
  function syncPrivacy() {
    const hidden = privacy();
    for (const key of ['location','position','sources']) {get(key).disabled = hidden;if (hidden) get(key).checked = false;}
    get('privacy').textContent = hidden ? '姓名已隱藏：輸出使用 OOO，並省略可能包含姓名的欄位、家族名稱與來源說明。' : '輸出採用完整姓名及目前的姓名顯示設定。';
  }
  dialog.querySelector('[data-close]').addEventListener('click',() => dialog.close());
  dialog.addEventListener('close',() => opener?.focus({preventScroll:true}));
  dialog.querySelector('.tree-output-options').addEventListener('change',() => invalidate());
  function setFit(fit) {
    preview.classList.toggle('is-fit',fit);
    get('fit').setAttribute('aria-pressed',String(fit)); get('original').setAttribute('aria-pressed',String(!fit));
  }
  get('fit').addEventListener('click', () => setFit(true));
  get('original').addEventListener('click', () => setFit(false));
  addEventListener('familyappchange',() => invalidate('族譜資料已更新，請重新產生預覽後再輸出。'));
  new MutationObserver(() => {if (dialog.open) {syncPrivacy();invalidate('姓名顯示設定已變更，請更新預覽。');}})
    .observe(document.getElementById('toggle-canvas-names'),{attributes:true,attributeFilter:['aria-pressed']});
  function settings() {
    const hidden = privacy(),scope = get('scope').value;
    return {scope,paper:get('paper').value,orientation:get('orientation').value,hideNames:hidden,
      includeArchived:get('archived').checked,location:!hidden && get('location').checked,position:!hidden && get('position').checked,
      sources:!hidden && get('sources').checked};
  }
  async function generate() {
    if (busy) return;
    busy = true;get('generate').disabled = true;invalidate('正在建立預覽…');
    let canvas;
    try {
      const stamp = version(),options = settings(),context = getContext();
      await document.fonts.ready;
      const original = options.scope === 'path' ? context?.graph : getGraph();
      if (!original || (options.scope === 'path' && !context?.queryView.active)) throw new Error('請先選擇兩人成員並查詢關係。');
      const {graph:projected,bridges} = projectOutputGraph(original,{ids:options.scope === 'current' ? context?.ids : null,includeArchived:options.includeArchived});
      const graph = {...projected,rankGroups:options.hideNames ? [] : projected.rankGroups,
        bonds:projected.bonds.filter(bond => !bond.rankGroupIds || options.scope === 'path'),
        people:projected.people.map(p => ({...p,name:options.hideNames ? 'OOO' : p.name,
          location:options.location ? p.location : '',position:options.position ? p.position : ''}))};
      if (!graph.people.length) throw new Error('此範圍沒有可輸出的成員。');
      const {FamilyModel:M,FamilyDisplayProjection:P} = globalThis;
      const connectedIds = M.relationshipMemberIds(graph.people, graph.bonds),displayShift = P.generationOffset(graph);
      const keys = new Set((graph.bonds || []).map(b => M.intermediateKey(b.kind,b.members)));
      for (const d of graph.descents || []) if (d.kind === '親生' && d.generations === 2) graph.unions.find(u => u.id === d.union)?.partners.forEach(id => keys.add(M.intermediateKey('親生祖孫',[id,d.child])));
      const ids = new Set(graph.people.map(p => p.id));
      const intermediatePlans = P.intermediatePlans(graph,{graph}).filter(p => ids.has(p.near) && ids.has(p.other) && keys.has(p.edgeKey));
      const uncertainGeneration = Math.max(0,...graph.people.filter(p => connectedIds.has(p.id)).map(p => p.gen)) + displayShift + 1;
      const layout = createTreeLayout({graph,fullGraph:graph,connectedIds,intermediatePlans,displayShift,uncertainGeneration,
        model:M,orderKey:M.orderKey,includeArchived:true});
      canvas = element('div','tree__canvas tree-export-stage');canvas.setAttribute('aria-hidden','true');canvas.inert = true;document.body.append(canvas);
      const result = renderDiagram({canvas,layout,graph,FAMILY:graph,intermediatePlans,displayShift,uncertainGeneration,
        hideCanvasNames:options.hideNames,interactive:false,onMemberBind:(node,p) => {
          if (bridges.has(p.id)) node.append(element('span','person__bridge','銜接人物'));
          for (const span of node.children) {
            const size = span.classList.contains('person__name') ? 20 : 16;
            span.textContent = wrapText(span.textContent,216,size).join('\n');
          }
        }});
      const scene = captureScene(canvas,{bands:result.bands}),appendix = options.sources ? buildSourceAppendix(projected) : [];
      const title = options.hideNames ? '家族族譜' : (globalThis.FamilyApp.snapshot().data.familyName || '家族') + '族譜';
      const scope = options.scope === 'all' ? '全家族' : options.scope === 'path' ? '目前比較路徑' : context.scopeLabel;
      const outputOptions = {...options,title,scope,appendix};
      if (stamp !== version() || JSON.stringify(options) !== JSON.stringify(settings())) throw new Error('資料或設定已更新，請重新建立預覽。');
      prepared = {stamp,scene,options:outputOptions,svg:serializeSVG(scene,outputOptions)};
      const pagination = paginateScene(scene,outputOptions),info = element('p','tree-output-hint',`${scene.nodes.length} 位成員 · ${pagination.pages.length} 張族譜頁＋導覽索引${appendix.length ? '＋來源附錄' : ''} · 正文至少 12pt`);
      const image = element('div','tree-output-preview__diagram');
      // XML was authored exclusively through escaped text and allowed geometry.
      image.innerHTML = prepared.svg.replace(/^<\?xml[^>]+>/,'');
      const svg = image.querySelector('svg');
      const ns = 'http://www.w3.org/2000/svg',cuts = document.createElementNS(ns,'g');cuts.setAttribute('transform',`translate(0 ${svgHeaderHeight(scene,title)})`);
      for (const page of pagination.pages) {
        const box = document.createElementNS(ns,'rect');for (const key of ['x','y','width','height']) box.setAttribute(key,page[key]);
        box.setAttribute('fill','none');box.setAttribute('stroke','#286e86');box.setAttribute('stroke-width','2');box.setAttribute('stroke-dasharray','8 5');
        const number = document.createElementNS(ns,'text');number.setAttribute('x',page.x + 8);number.setAttribute('y',page.y + 20);number.setAttribute('font-size','16');number.setAttribute('fill','#286e86');number.textContent = '第 ' + page.number + ' 頁';cuts.append(box,number);
      }
      svg.append(cuts);preview.replaceChildren(info,image);
      const fullViewBox = svg.getAttribute('viewBox');
      const all = element('option','','完整圖'); all.value = 'all'; get('page').replaceChildren(all);
      pagination.pages.forEach((page,index) => { const option = element('option','','第 ' + page.number + ' 頁／' + pagination.pages.length); option.value = index; get('page').append(option); });
      get('page').onchange = () => {
        const page = pagination.pages[Number(get('page').value)];
        svg.setAttribute('viewBox',get('page').value === 'all' || !page ? fullViewBox : `${page.x} ${page.y + svgHeaderHeight(scene,title)} ${page.width} ${page.height}`);
      };
      get('page').disabled = false; get('dirty').textContent = '設定與預覽一致'; delete preview.dataset.stale;
      status.textContent = '預覽已更新。藍色虛線標示列印分頁；SVG 保留完整族譜。';get('svg').disabled = get('print').disabled = false;
    } catch (error) {invalidate(error.message || '無法建立輸出，請再試一次。');}
    finally {canvas?.remove();busy = false;get('generate').disabled = false;}
  }
  function current() {
    if (!prepared || prepared.stamp !== version()) {invalidate('族譜資料已更新，請更新預覽。');return false;}return true;
  }
  get('generate').addEventListener('click',generate);
  get('svg').addEventListener('click',() => {
    if (!current()) return;
    const blob = new Blob([prepared.svg],{type:'image/svg+xml;charset=utf-8'}),url = URL.createObjectURL(blob),link = element('a');
    link.href = url;link.download = prepared.options.hideNames ? 'family-tree.svg' : 'family-tree-' + prepared.options.scope + '.svg';link.click();setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  get('print').addEventListener('click',() => {
    if (!current()) return;
    const popup = window.open('','_blank');if (!popup) {status.textContent = '請允許開啟列印視窗後再試一次。';return;}
    const printedSnapshot = prepared;
    // A preview or SVG download does not need a copy of every printed page.
    // Build those pages only after the user opens the print view.
    prepared.html ??= printDocument(prepared.scene,prepared.options);
    popup.document.open();popup.document.write(prepared.html);popup.document.close();
    printWindows.add(popup);
    popup.document.getElementById('print-document').addEventListener('click',async () => {
      if (prepared !== printedSnapshot || !current()) {popup.document.querySelector('.print-toolbar span').textContent = '原族譜已更新，請關閉此視窗並更新預覽。';return;}
      await popup.document.fonts.ready;popup.focus();popup.print();
    });
  });
  document.getElementById('export-diagram').addEventListener('click',event => {
    opener = event.currentTarget.hidden ? document.activeElement : event.currentTarget;invalidate();syncPrivacy();
    get('scope').querySelector('[value=path]').disabled = !getContext()?.queryView.active;
    get('scope').value = getContext()?.queryView.active ? 'path' : 'all';
    dialog.showModal();generate();
  });
}
