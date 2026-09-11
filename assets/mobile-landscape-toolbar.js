(function () {
  'use strict';

  const landscape = matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)');
  const controls = document.querySelector('.tree-controls');
  const mobileSearchOpen = document.getElementById('mobile-search-open');
  const mobileSearchEnd = document.getElementById('mobile-search-end');
  const editFamilyName = document.getElementById('edit-family-name');
  const canvasNames = document.getElementById('toggle-canvas-names');
  const importJson = document.getElementById('import-json');
  const exportJson = document.getElementById('export-json');
  const legend = document.getElementById('relationship-legend');
  if (!controls || !mobileSearchOpen || !editFamilyName || !canvasNames || !importJson || !exportJson || !legend) return;

  const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const createToolbarButton = (id, label, icon) => {
    const button = document.createElement('button');
    button.type = 'button'; button.id = id; button.className = 'plain-button landscape-toolbar-control';
    button.setAttribute('aria-label', label); button.title = label; button.innerHTML = icon;
    return button;
  };

  const relationshipButton = createToolbarButton('landscape-relationship-open', '查詢兩人關係', svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10.5 10.5 13.5 13.5M14.5 7.5h5m-2.5-2.5v5"/>'));
  const moreButton = createToolbarButton('landscape-more-open', '更多功能', svg('<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>'));

  const cloud = document.getElementById('cloud-sync');
  controls.insertBefore(relationshipButton, cloud || null);
  controls.appendChild(moreButton);

  const dialog = document.createElement('dialog');
  dialog.id = 'landscape-more-sheet'; dialog.className = 'landscape-more-sheet'; dialog.setAttribute('aria-labelledby', 'landscape-more-title');
  dialog.innerHTML = `
    <div class="landscape-more-sheet__header">
      <h2 id="landscape-more-title">更多功能</h2>
      <button type="button" id="landscape-more-close" class="details-icon" aria-label="關閉更多功能" title="關閉更多功能">${svg('<path d="M18 6 6 18M6 6l12 12"/>')}</button>
    </div>
    <div class="landscape-more-sheet__body">
      <div class="landscape-more-actions">
        <button type="button" class="landscape-more-action" data-action="family-name">${svg('<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5z"/>')}<span>編輯家族名稱</span></button>
        <button type="button" class="landscape-more-action" data-action="canvas-names">${svg('<path d="M2 2h6v6H2zM16 2h6v6h-6zM9 9h6v6H9zM2 16h6v6H2zM16 16h6v6h-6z"/>')}<span data-label>隱藏畫布姓名</span></button>
        <button type="button" class="landscape-more-action" data-action="legend">${svg('<path d="M4 6h16M4 12h10M4 18h16"/>')}<span>關係圖例</span></button>
        <button type="button" class="landscape-more-action" data-action="import">${svg('<path d="M12 15V4m-4 4 4-4 4 4M5 18v2h14v-2"/>')}<span>匯入族譜</span></button>
        <button type="button" class="landscape-more-action" data-action="export">${svg('<path d="M12 3v11m-4-4 4 4 4-4M5 18v2h14v-2"/>')}<span>匯出族譜</span></button>
        <div class="landscape-more-legend" data-legend hidden></div>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const action = name => dialog.querySelector(`[data-action="${name}"]`);
  const nameAction = action('family-name'), canvasAction = action('canvas-names');
  const legendAction = action('legend'), importAction = action('import'), exportAction = action('export');
  const legendPanel = dialog.querySelector('[data-legend]');

  function closeMore() { if (dialog.open) dialog.close(); }
  function refreshLegend() {
    legendPanel.replaceChildren(...[...legend.children].map(node => node.cloneNode(true)));
    legendPanel.classList.add('legend');
  }
  function syncState() {
    nameAction.disabled = editFamilyName.disabled;
    importAction.disabled = importJson.disabled;
    exportAction.disabled = exportJson.disabled;
    const namesHidden = canvasNames.getAttribute('aria-pressed') === 'true';
    canvasAction.setAttribute('aria-pressed', String(namesHidden));
    canvasAction.querySelector('[data-label]').textContent = namesHidden ? '顯示畫布姓名' : '隱藏畫布姓名';
    const relationshipActive = mobileSearchEnd && !mobileSearchEnd.hidden;
    relationshipButton.setAttribute('aria-pressed', String(relationshipActive));
    relationshipButton.setAttribute('aria-label', relationshipActive ? '修改兩人關係查詢' : '查詢兩人關係');
    relationshipButton.title = relationshipActive ? '修改兩人關係查詢' : '查詢兩人關係';
  }

  relationshipButton.addEventListener('click', () => mobileSearchOpen.click());
  moreButton.addEventListener('click', () => { refreshLegend(); syncState(); dialog.showModal(); });
  dialog.querySelector('#landscape-more-close').addEventListener('click', closeMore);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMore(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeMore(); });

  nameAction.addEventListener('click', () => { closeMore(); editFamilyName.click(); });
  canvasAction.addEventListener('click', () => { canvasNames.click(); syncState(); });
  importAction.addEventListener('click', () => { closeMore(); importJson.click(); });
  exportAction.addEventListener('click', () => { closeMore(); exportJson.click(); });
  legendAction.addEventListener('click', () => {
    const opening = legendPanel.hidden;
    if (opening) refreshLegend();
    legendPanel.hidden = !opening;
    legendAction.setAttribute('aria-pressed', String(opening));
  });

  const observer = new MutationObserver(syncState);
  observer.observe(editFamilyName, { attributes:true, attributeFilter:['disabled'] });
  observer.observe(importJson, { attributes:true, attributeFilter:['disabled'] });
  observer.observe(exportJson, { attributes:true, attributeFilter:['disabled'] });
  observer.observe(canvasNames, { attributes:true, attributeFilter:['aria-pressed','aria-label'] });
  if (mobileSearchEnd) observer.observe(mobileSearchEnd, { attributes:true, attributeFilter:['hidden'] });
  new MutationObserver(() => { if (!legendPanel.hidden) refreshLegend(); }).observe(legend, { childList:true, subtree:true });

  function layoutChanged() {
    if (!landscape.matches) closeMore();
    syncState();
  }
  landscape.addEventListener('change', layoutChanged);
  syncState();
})();
