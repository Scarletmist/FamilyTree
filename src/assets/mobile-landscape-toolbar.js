(function () {
  'use strict';
  let initialized = false;
  function initialize() {
    if (initialized) return;
    const controls = document.querySelector('.tree-controls');
    const searchOpen = document.getElementById('mobile-search-open');
    if (!controls || !searchOpen) { requestAnimationFrame(initialize); return; }
    initialized = true;
    const get = id => document.getElementById(id);
    const compact = matchMedia('(max-width:700px), (max-width:950px) and (max-height:520px)');
    const svg = path => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    const icons = {
      more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
      map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15"/>',
      query:'<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8 8 8 8m-3-8h5v5"/>',
      eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
      'eye-off':'<path d="m3 3 18 18M10.6 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a17.5 17.5 0 0 1-3.2 3.9M6.5 6.5C3.7 8.5 2 12 2 12s4 7 10 7a11 11 0 0 0 5.5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
      list:'<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
      merge:'<path d="M5 3v4c0 5 7 5 7 9v5M19 3v4c0 5-7 5-7 9m-4 1 4 4 4-4"/>',
      undo:'<path d="M4 5v6h6M4 11a8 8 0 1 1 2 9"/>',
      cloud:'<path d="M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0 0 10Z"/>',
      import:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
      export:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
      edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15z"/>',
      legend:'<path d="M9 6h12M9 12h8M9 18h12M3 6h1M3 12h1M3 18h1"/>'
    };
    const openers = ['desktop','portrait','landscape'].map(mode => {
      const button = document.createElement('button'); button.type = 'button'; button.id = mode + '-more-open';
      button.className = `plain-button ${mode}-toolbar-control`;
      button.setAttribute('aria-label','更多功能'); button.setAttribute('aria-haspopup','dialog');
      button.setAttribute('aria-expanded','false'); button.setAttribute('aria-controls','landscape-more-sheet');
      button.innerHTML = svg(icons.more); controls.append(button); return button;
    });
    const scope = get('family-filter');
    document.querySelector('.workspace-toolbar__scope').append(document.querySelector('.family-filter-label'), scope.closest('.searchable-select') || scope);
    const resetScope = document.createElement('button'); resetScope.type = 'button'; resetScope.id = 'family-scope-reset'; resetScope.className = 'plain-button'; resetScope.textContent = '全族譜'; resetScope.setAttribute('aria-label','返回全族譜');
    scope.closest('.workspace-toolbar__scope').append(resetScope);
    const syncScope = () => { resetScope.hidden = !scope.value || scope.disabled; };
    resetScope.addEventListener('click', () => { scope.value = ''; scope.dispatchEvent(new Event('change',{bubbles:true})); });
    scope.addEventListener('change',syncScope); new MutationObserver(syncScope).observe(scope,{childList:true,attributes:true,attributeFilter:['disabled']}); syncScope();
    // Move the actual map entry, preserving its module listener and unique ID.
    document.querySelector('.workspace-toolbar').append(get('show-member-map'));
    const dialog = document.createElement('dialog'); dialog.id = 'landscape-more-sheet'; dialog.className = 'landscape-more-sheet';
    dialog.setAttribute('aria-labelledby','landscape-more-title');
    dialog.innerHTML = `<div class="landscape-more-sheet__header"><h2 id="landscape-more-title">更多功能</h2><button type="button" class="details-icon" id="landscape-more-close" aria-label="關閉更多功能">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></div><div class="landscape-more-sheet__body"></div>`;
    const sections = [
      ['備份、同步與輸出',[['diagram-export','列印／下載向量圖','export'],['export','匯出族譜備份','export'],['import','匯入族譜','import'],['cloud','Google Drive 同步','cloud']]],
      ['成員管理',[['workbench','待整理資料','list'],['archived','封存成員','list'],['recycle','回收區','list'],['groups','排行群組','list'],['merge','合併重複成員','merge'],['ignored','已忽略待補項目','list'],['undo','復原','undo']]],
      ['檢視',[['relationship','查兩人關係','query'],['map','成員地圖','map'],['minimap','全圖導覽','map'],['canvas-names','隱藏姓名','eye'],['inferred-lines','顯示自動辨別線段','query'],['legend','關係圖例','legend']]],
      ['族譜設定',[['family-name','編輯家族名稱','edit']]]
    ];
    const menuSearch = document.createElement('input'); menuSearch.type = 'search'; menuSearch.className = 'workspace-menu-search'; menuSearch.placeholder = '搜尋功能'; menuSearch.setAttribute('aria-label','搜尋功能');
    dialog.querySelector('.landscape-more-sheet__body').before(menuSearch);
    for (const [title, items] of sections) {
      const section = document.createElement('details'); section.className = 'workspace-menu-group'; section.open = true;
      const heading = document.createElement('summary'); heading.textContent = title; section.append(heading);
      for (const [name,label,icon] of items) {
        const button = name === 'inferred-lines' ? get('toggle-inferred-lines') : document.createElement('button');
        button.type = 'button'; button.className = 'landscape-more-action'; button.dataset.action = name; button.hidden = false;
        button.innerHTML = svg(icons[icon]); const text = document.createElement('span'); text.dataset.label = ''; text.textContent = label;
        if (name === 'inferred-lines' && button.getAttribute('aria-pressed') === 'true') text.textContent = '隱藏自動辨別線段';
        button.append(text); section.append(button);
        if (name === 'inferred-lines') {
          const hint = document.createElement('p'); hint.id = 'inferred-lines-hint'; hint.className = 'workspace-menu-hint';
          hint.textContent = '全覽可切換；選取成員時自動顯示詳細線段。i 查看依據，＋補登親屬。'; section.append(hint);
        }
      }
      if (title === '備份、同步與輸出') {
        const hint = document.createElement('p'); hint.className = 'workspace-menu-hint';
        hint.textContent = window.FamilyRepository?.isStatic ? '資料儲存在此裝置；匯出備份可另存一份，連結雲端後可跨裝置同步。' : '資料已儲存至伺服器；匯出備份可另存一份。'; section.append(hint);
      }
      dialog.querySelector('.landscape-more-sheet__body').append(section);
    }
    const legendPanel = document.createElement('div'); legendPanel.className = 'landscape-more-legend legend'; legendPanel.hidden = true;
    dialog.querySelector('[data-action=legend]').after(legendPanel); document.body.append(dialog);
    const action = name => dialog.querySelector(`[data-action="${name}"]`);
    function filterMenu() {
      const keyword = menuSearch.value.trim().normalize('NFKC').toLocaleLowerCase();
      for (const section of dialog.querySelectorAll('.workspace-menu-group')) {
        let visible = 0;
        for (const item of section.querySelectorAll('[data-action]')) {
          const eligible = !((item.dataset.action === 'ignored' && !(window.getIgnoredIntermediateCount?.() || 0)) || (item.dataset.action === 'cloud' && get('cloud-sync').hidden));
          item.hidden = !eligible || !item.textContent.normalize('NFKC').toLocaleLowerCase().includes(keyword); if (!item.hidden) visible++;
        }
        section.hidden = !visible; if (keyword) section.open = true;
      }
    }
    menuSearch.addEventListener('input',filterMenu);
    searchOpen.prepend(action('relationship').querySelector('svg').cloneNode(true));
    let opener;
    function syncState() {
      action('minimap').setAttribute('aria-pressed',get('toggle-tree-minimap').getAttribute('aria-pressed'));
      action('minimap').querySelector('[data-label]').textContent = get('toggle-tree-minimap').getAttribute('aria-pressed') === 'true' ? '收合全圖導覽' : '開啟全圖導覽';
      action('diagram-export').disabled = !window.FamilyApp?.snapshot()?.data.people.length;
      action('family-name').disabled = get('edit-family-name').disabled;
      action('import').disabled = get('import-json').disabled; action('export').disabled = get('export-json').disabled;
      action('cloud').hidden = get('cloud-sync').hidden;
      action('groups').disabled = action('merge').disabled = !window.FamilyEditor?.snapshot();
      for (const name of ['workbench','archived','recycle']) action(name).disabled = !window.FamilyApp?.snapshot();
      const undo = window.FamilyEditor?.snapshot()?.undoLabel;
      action('undo').disabled = !undo; action('undo').querySelector('[data-label]').textContent = undo ? '復原：' + undo : '復原（目前沒有修改）';
      const ignored = window.getIgnoredIntermediateCount?.() || 0; action('ignored').hidden = !ignored;
      action('ignored').querySelector('[data-label]').textContent = `已忽略待補項目（${ignored}）`;
      const hidden = get('toggle-canvas-names').getAttribute('aria-pressed') === 'true';
      action('canvas-names').querySelector('svg').outerHTML = svg(icons[hidden ? 'eye-off' : 'eye']);
      action('canvas-names').querySelector('[data-label]').textContent = hidden ? '顯示姓名' : '隱藏姓名';
      action('canvas-names').setAttribute('aria-pressed',String(hidden));
      const state = get('cloud-sync').dataset.syncState;
      action('cloud').querySelector('[data-label]').textContent = state === 'synced' ? 'Google Drive 已同步' : state === 'pending' ? '雲端尚未同步' : state === 'conflict' ? '有版本差異' : state === 'syncing' ? '雲端同步中…' : 'Google Drive 同步';
    }
    function closeMore({ focus = true } = {}) {
      if (!dialog.open) return; dialog.close(); openers.forEach(button => button.setAttribute('aria-expanded','false'));
      if (focus) opener?.focus({preventScroll:true});
    }
    function position() {
      if (!dialog.open || compact.matches) return;
      const box = opener.getBoundingClientRect();
      dialog.style.left = Math.max(8,Math.min(box.right - 292,innerWidth - 300)) + 'px';
      dialog.style.top = box.bottom + 6 + 'px'; dialog.style.maxHeight = Math.max(100,innerHeight - box.bottom - 14) + 'px';
    }
    for (const button of openers) button.addEventListener('click', () => {
      if (dialog.open) { closeMore(); return; }
      opener = button; menuSearch.value = ''; syncState(); filterMenu(); legendPanel.hidden = true;
      if (compact.matches) dialog.showModal(); else dialog.show();
      button.setAttribute('aria-expanded','true'); position(); action('diagram-export').focus({preventScroll:true});
    });
    get('landscape-more-close').addEventListener('click', () => closeMore());
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeMore(); });
    document.addEventListener('pointerdown', event => { if (dialog.open && !dialog.contains(event.target) && !openers.some(button => button.contains(event.target))) closeMore({focus:false}); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && dialog.open && ![...document.querySelectorAll('dialog:modal')].some(modal => modal !== dialog)) { event.preventDefault(); closeMore(); }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z' && !event.target.closest('input,textarea,select,[contenteditable],dialog') && !document.querySelector('dialog:modal')) {
        if (window.FamilyEditor?.snapshot()?.undoLabel) { event.preventDefault(); window.FamilyEditor.undo(); }
      }
    });
    const run = (name, callback) => action(name).addEventListener('click', () => { closeMore(); callback(); });
    run('map', () => get('show-member-map').click()); run('relationship', () => searchOpen.click());
    run('family-name', () => get('edit-family-name').click()); run('groups', () => window.FamilyManagement?.openGroups());
    run('merge', () => window.FamilyManagement?.openMerge()); run('ignored', () => window.openIgnoredIntermediatePlans?.());
    run('workbench',() => window.FamilyMaintenanceUI?.openWorkbench()); run('archived',() => window.FamilyMaintenanceUI?.openArchived()); run('recycle',() => window.FamilyMaintenanceUI?.openRecycle());
    run('undo', () => window.FamilyEditor?.undo()); run('cloud', () => get('cloud-sync').click());
    run('import', () => get('import-json').click()); run('export', () => get('export-json').click());
    run('minimap',() => get('toggle-tree-minimap').click());run('diagram-export',() => get('export-diagram').click());
    action('canvas-names').addEventListener('click', () => { get('toggle-canvas-names').click(); syncState(); });
    action('legend').addEventListener('click', () => {
      legendPanel.replaceChildren(...[...get('relationship-legend').children].map(node => node.cloneNode(true))); legendPanel.hidden = !legendPanel.hidden;
    });
    compact.addEventListener('change', () => closeMore({focus:false})); window.addEventListener('resize',position);
    window.addEventListener('familyintermediatechange',syncState); window.addEventListener('cloudsyncuichange',syncState);
    const observer = new MutationObserver(syncState);
    for (const id of ['edit-family-name','import-json','export-json','cloud-sync','toggle-canvas-names','toggle-tree-minimap']) observer.observe(get(id), {attributes:true,attributeFilter:['disabled','hidden','aria-pressed','data-sync-state']});
    syncState();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',initialize,{once:true}); else initialize();
})();
