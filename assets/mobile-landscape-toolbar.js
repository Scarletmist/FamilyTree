(function () {
  'use strict';

  const portrait = matchMedia('(max-width:700px) and (orientation:portrait)');
  const landscape = matchMedia('(max-width:950px) and (max-height:520px) and (pointer:coarse) and (orientation:landscape)');
  const controls = document.querySelector('.tree-controls');
  const mobileSearchOpen = document.getElementById('mobile-search-open');
  const mobileSearchEnd = document.getElementById('mobile-search-end');
  const editFamilyName = document.getElementById('edit-family-name');
  const canvasNames = document.getElementById('toggle-canvas-names');
  const importJson = document.getElementById('import-json');
  const exportJson = document.getElementById('export-json');
  const cloud = document.getElementById('cloud-sync');
  const legend = document.getElementById('relationship-legend');
  if (!controls || !mobileSearchOpen || !editFamilyName || !canvasNames || !importJson || !exportJson || !legend) return;

  const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  const createToolbarButton = (id, label, icon, className) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = `plain-button ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.innerHTML = icon;
    return button;
  };
  const moreIcon = svg('<circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/>');

  const relationshipButton = createToolbarButton(
    'landscape-relationship-open',
    '查詢兩人關係',
    svg('<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10.5 10.5 13.5 13.5M14.5 7.5h5m-2.5-2.5v5"/>'),
    'landscape-toolbar-control'
  );
  const landscapeMoreButton = createToolbarButton('landscape-more-open', '更多功能', moreIcon, 'landscape-toolbar-control');
  const portraitMoreButton = createToolbarButton('portrait-more-open', '更多功能', moreIcon, 'mobile-icon-control portrait-toolbar-control');

  controls.insertBefore(relationshipButton, cloud || null);
  controls.append(landscapeMoreButton, portraitMoreButton);

  const dialog = document.createElement('dialog');
  dialog.id = 'landscape-more-sheet';
  dialog.className = 'landscape-more-sheet';
  dialog.setAttribute('aria-labelledby', 'landscape-more-title');
  dialog.innerHTML = `
    <div class="landscape-more-sheet__header">
      <h2 id="landscape-more-title">更多功能</h2>
      <button type="button" id="landscape-more-close" class="details-icon" aria-label="關閉更多功能" title="關閉更多功能">${svg('<path d="M18 6 6 18M6 6l12 12"/>')}</button>
    </div>
    <div class="landscape-more-sheet__body">
      <div class="landscape-more-actions">
        <button type="button" class="landscape-more-action" data-action="cloud">${svg('<path d="M7.5 18.5h9.2a4.3 4.3 0 0 0 .7-8.5A6 6 0 0 0 6 8.6a4.8 4.8 0 0 0 1.5 9.9Z"/><path d="M12 10v6m-2-2 2 2 2-2"/>')}<span data-cloud-label>Google Drive</span></button>
        <button type="button" class="landscape-more-action" data-action="family-name">${svg('<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5z"/>')}<span>編輯家族名稱</span></button>
        <button type="button" class="landscape-more-action" data-action="canvas-names">${svg('<path d="M2 2h6v6H2zM16 2h6v6h-6zM9 9h6v6H9zM2 16h6v6H2zM16 16h6v6h-6z"/>')}<span data-label>隱藏畫布姓名</span></button>
        <button type="button" class="landscape-more-action" data-action="legend">${svg('<path d="M4 6h16M4 12h10M4 18h16"/>')}<span>關係圖例</span></button>
        <button type="button" class="landscape-more-action" data-action="ignored">${svg('<circle cx="8" cy="8" r="3"/><path d="M3.5 19c.6-4 2.5-6 5.5-6 1.7 0 3 .6 4 1.7M16 8h5M18.5 5.5v5"/><path d="M15.5 16.5h6"/>')}<span data-ignored-label>已忽略待補項目</span></button>
        <button type="button" class="landscape-more-action" data-action="import">${svg('<path d="M12 15V4m-4 4 4-4 4 4M5 18v2h14v-2"/>')}<span>匯入族譜</span></button>
        <button type="button" class="landscape-more-action" data-action="export">${svg('<path d="M12 3v11m-4-4 4 4 4-4M5 18v2h14v-2"/>')}<span>匯出族譜</span></button>
        <div class="landscape-more-legend" data-legend hidden></div>
      </div>
    </div>`;
  document.body.appendChild(dialog);

  const action = name => dialog.querySelector(`[data-action="${name}"]`);
  const cloudAction = action('cloud');
  const nameAction = action('family-name');
  const canvasAction = action('canvas-names');
  const legendAction = action('legend');
  const ignoredAction = action('ignored');
  const importAction = action('import');
  const exportAction = action('export');
  const legendPanel = dialog.querySelector('[data-legend]');

  function closeMore() {
    if (dialog.open) dialog.close();
  }
  function refreshLegend() {
    legendPanel.replaceChildren(...[...legend.children].map(node => node.cloneNode(true)));
    legendPanel.classList.add('legend');
  }
  function cloudLabel(state) {
    if (state === 'synced') return 'Google Drive · 已同步';
    if (state === 'syncing') return 'Google Drive · 同步中';
    if (state === 'pending') return 'Google Drive · 待同步';
    if (state === 'conflict') return 'Google Drive · 有衝突';
    if (state === 'error') return 'Google Drive · 同步失敗';
    return 'Google Drive';
  }
  function syncState() {
    nameAction.disabled = editFamilyName.disabled;
    importAction.disabled = importJson.disabled;
    exportAction.disabled = exportJson.disabled;
    const namesHidden = canvasNames.getAttribute('aria-pressed') === 'true';
    canvasAction.setAttribute('aria-pressed', String(namesHidden));
    canvasAction.querySelector('[data-label]').textContent = namesHidden ? '顯示畫布姓名' : '隱藏畫布姓名';
    const ignored = new Set(window.FAMILY ? FamilyModel.ignoredIntermediatePlanIds(window.FAMILY) : []);
    const ignoredVisible = window.FAMILY ? new Set(FamilyModel.intermediatePlans(window.FAMILY, { includeIgnored:true }).filter(plan => ignored.has(plan.id)).map(plan => plan.slotId)).size : 0;
    ignoredAction.querySelector('[data-ignored-label]').textContent = ignoredVisible ? `已忽略待補項目（${ignoredVisible}）` : '已忽略待補項目';
    const relationshipActive = mobileSearchEnd && !mobileSearchEnd.hidden;
    relationshipButton.setAttribute('aria-pressed', String(relationshipActive));
    relationshipButton.setAttribute('aria-label', relationshipActive ? '修改兩人關係查詢' : '查詢兩人關係');
    relationshipButton.title = relationshipActive ? '修改兩人關係查詢' : '查詢兩人關係';

    if (cloudAction) {
      const state = cloud?.dataset.syncState || 'disconnected';
      cloudAction.hidden = !portrait.matches || !cloud || cloud.hidden;
      cloudAction.dataset.syncState = state;
      cloudAction.querySelector('[data-cloud-label]').textContent = cloudLabel(state);
      cloudAction.setAttribute('aria-label', cloud?.getAttribute('aria-label') || cloudLabel(state));
    }
  }

  relationshipButton.addEventListener('click', () => mobileSearchOpen.click());
  const openMore = () => {
    refreshLegend();
    syncState();
    dialog.showModal();
  };
  landscapeMoreButton.addEventListener('click', openMore);
  portraitMoreButton.addEventListener('click', openMore);
  dialog.querySelector('#landscape-more-close').addEventListener('click', closeMore);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMore(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeMore(); });

  cloudAction?.addEventListener('click', () => { closeMore(); cloud?.click(); });
  nameAction.addEventListener('click', () => { closeMore(); editFamilyName.click(); });
  canvasAction.addEventListener('click', () => { canvasNames.click(); syncState(); });
  ignoredAction.addEventListener('click', () => { closeMore(); window.openIgnoredIntermediatePlans?.(); });
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
  if (cloud) observer.observe(cloud, { attributes:true, attributeFilter:['hidden','data-sync-state','aria-label','title'] });
  window.addEventListener('familyintermediatechange', syncState);
  window.addEventListener('cloudsyncuichange', syncState);
  new MutationObserver(() => { if (!legendPanel.hidden) refreshLegend(); }).observe(legend, { childList:true, subtree:true });

  function layoutChanged() {
    closeMore();
    syncState();
  }
  portrait.addEventListener('change', layoutChanged);
  landscape.addEventListener('change', layoutChanged);
  syncState();
})();
