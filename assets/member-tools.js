(function () {
  'use strict';
  const selector = '#relationship-search select, #relationship-summary select, #member-form select';
  const controls = new WeakMap();
  let active = null, nextId = 0;
  const normalized = text => text.normalize('NFKC').toLocaleLowerCase();
  function close(restore = false) {
    if (!active) return;
    const control = active; active = null;
    control.panel.hidePopover(); control.trigger.setAttribute('aria-expanded', 'false');
    if (restore && control.trigger.isConnected) control.trigger.focus();
  }
  function position(control) {
    const rect = control.trigger.getBoundingClientRect();
    const vv = window.visualViewport;
    const viewportLeft = vv?.offsetLeft || 0, viewportTop = vv?.offsetTop || 0;
    const viewportWidth = vv?.width || innerWidth, viewportHeight = vv?.height || innerHeight;
    const rightEdge = viewportLeft + viewportWidth, bottomEdge = viewportTop + viewportHeight;
    const width = Math.min(Math.max(rect.width, 260), Math.max(180, viewportWidth - 16));
    const below = bottomEdge - rect.bottom - 8, above = rect.top - viewportTop - 8;
    const down = below >= 220 || below >= above;
    control.panel.style.width = width + 'px';
    control.panel.style.maxHeight = Math.max(80, Math.min(320, down ? below : above)) + 'px';
    control.panel.style.left = Math.max(viewportLeft + 8, Math.min(rect.left, rightEdge - width - 8)) + 'px';
    control.panel.style.top = (down ? rect.bottom + 4 : Math.max(viewportTop + 8, rect.top - control.panel.getBoundingClientRect().height - 4)) + 'px';
  }
  function draw(control) {
    const { select, search, list, hint } = control;
    const keyword = normalized(search.value.trim());
    control.options = [...select.options].filter(option => !option.disabled && normalized(option.textContent).includes(keyword));
    list.replaceChildren();
    control.index = Math.max(0, control.options.findIndex(option => option.selected));
    control.options.forEach((option, index) => {
      const item = document.createElement('div'); item.role = 'option'; item.id = list.id + '-' + index;
      item.textContent = option.textContent; item.setAttribute('aria-selected', String(option.selected));
      item.addEventListener('mousedown', event => event.preventDefault());
      item.addEventListener('click', event => { event.preventDefault(); choose(control, index); });
      list.append(item);
    });
    hint.textContent = control.options.length ? '' : '找不到符合的選項';
    highlight(control);
  }
  function highlight(control) {
    [...control.list.children].forEach((item, i) => item.classList.toggle('is-active', i === control.index));
    const item = control.list.children[control.index];
    if (item) { control.search.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
    else control.search.removeAttribute('aria-activedescendant');
  }
  function choose(control, index) {
    const option = control.options[index]; if (!option) return;
    control.select.value = option.value;
    close(true);
    control.select.dispatchEvent(new Event('input', { bubbles: true }));
    control.select.dispatchEvent(new Event('change', { bubbles: true }));
    enhance();
  }
  function open(control) {
    if (control.select.matches(':disabled')) return;
    close(); active = control; control.search.value = ''; draw(control);
    control.panel.showPopover(); position(control);
    control.trigger.setAttribute('aria-expanded', 'true'); control.search.focus();
  }
  function enhance() {
    if (active && (!active.select.isConnected || active.select.matches(':disabled'))) close();
    document.querySelectorAll(selector).forEach(select => {
      let control = controls.get(select);
      if (!control) {
        const wrapper = document.createElement('span'); wrapper.className = 'searchable-select';
        const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'select-trigger';
        const title = select.getAttribute('aria-label') || select.closest('label')?.firstChild?.textContent?.trim() || '選項';
        trigger.setAttribute('aria-label', title); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false');
        const panel = document.createElement('div'); panel.className = 'select-dropdown'; panel.popover = 'manual'; panel.role = 'dialog'; panel.setAttribute('aria-label', title); panel.id = 'select-popup-' + ++nextId;
        trigger.setAttribute('aria-controls', panel.id);
        const search = document.createElement('input'); search.type = 'search'; search.placeholder = '輸入關鍵字搜尋'; search.className = 'select-search'; search.autocomplete = 'off'; search.setAttribute('aria-label', '搜尋' + title);
        const list = document.createElement('div'); list.role = 'listbox'; list.id = panel.id + '-options'; list.setAttribute('aria-label', title); list.className = 'select-options';
        search.role = 'combobox'; search.setAttribute('aria-controls', list.id); search.setAttribute('aria-expanded', 'true'); search.setAttribute('aria-autocomplete', 'list');
        const hint = document.createElement('small'); hint.className = 'select-search-status'; hint.setAttribute('role', 'status');
        panel.append(search, list, hint); select.before(wrapper); wrapper.append(select, trigger, panel);
        select.classList.add('select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
        control = { select, trigger, panel, search, list, hint }; controls.set(select, control);
        trigger.addEventListener('click', event => { event.preventDefault(); active === control ? close() : open(control); });
        trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(control); } });
        search.addEventListener('input', () => draw(control));
        search.addEventListener('keydown', event => {
          if (event.isComposing) return;
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); control.index = Math.max(0, Math.min(control.options.length - 1, control.index + (event.key === 'ArrowDown' ? 1 : -1))); highlight(control); }
          if (event.key === 'Enter') { event.preventDefault(); choose(control, control.index); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
          if (event.key === 'Tab') { close(true); }
        });
        select.addEventListener('change', enhance);
        select.addEventListener('focus', () => trigger.focus());
        select.addEventListener('invalid', event => { event.preventDefault(); open(control); });
      }
      const text = select.selectedOptions[0]?.textContent || '請選擇';
      if (control.trigger.textContent !== text) control.trigger.textContent = text;
      const disabled = select.matches(':disabled');
      if (control.trigger.disabled !== disabled) control.trigger.disabled = disabled;
    });
  }
  const observer = new MutationObserver(enhance);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  document.addEventListener('pointerdown', event => { if (active && !active.panel.contains(event.target) && !active.trigger.contains(event.target)) close(); });
  document.addEventListener('scroll', () => { if (active) position(active); }, true);
  window.addEventListener('resize', () => { if (active) position(active); });
  window.visualViewport?.addEventListener('resize', () => { if (active) position(active); });
  window.visualViewport?.addEventListener('scroll', () => { if (active) position(active); });
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('close', () => close()));
  document.getElementById('member-form').addEventListener('reset', () => { close(); setTimeout(enhance, 0); });
  enhance();

  const dialog = document.getElementById('member-list-dialog');
  const searchMembers = document.getElementById('member-list-search');
  const body = document.getElementById('member-list-body');
  const count = document.getElementById('member-list-count');
  const empty = document.getElementById('member-list-empty');
  const ignoredOpen = document.getElementById('open-ignored-intermediates');
  const ignoredCount = document.getElementById('ignored-intermediate-count');
  const filterButtons = [...document.querySelectorAll('[data-member-filter]')];
  const recentSection = document.getElementById('member-list-recent');
  const recentItems = document.getElementById('member-list-recent-items');
  const RECENT_KEY = 'family-tree:recent-members:v1:' + location.pathname;
  const RECENT_LIMIT = 6;
  let memberFilter = 'all';

  function readRecentMembers() {
    try {
      const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(ids) ? ids.filter(id => typeof id === 'string').slice(0, RECENT_LIMIT) : [];
    } catch (_) { return []; }
  }
  function writeRecentMembers(ids) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, RECENT_LIMIT))); } catch (_) {}
  }
  window.clearRecentFamilyMembers = () => {
    try { localStorage.removeItem(RECENT_KEY); } catch (_) {}
    if (dialog.open) renderMemberList();
  };
  function rememberRecentMember(id) {
    if (!id) return;
    const people = window.FAMILY?.people || [];
    if (!people.some(person => person.id === id)) return;
    writeRecentMembers([id, ...readRecentMembers().filter(value => value !== id)]);
    if (dialog.open) renderMemberList();
  }

  function currentIgnoredCount() {
    if (!window.FAMILY?.people) return 0;
    const ignored = new Set(FamilyModel.ignoredIntermediatePlanIds(window.FAMILY));
    return new Set(FamilyModel.intermediatePlans(window.FAMILY, { includeIgnored: true }).filter(plan => ignored.has(plan.id)).map(plan => plan.slotId)).size;
  }
  function refreshIgnoredCount() {
    const value = currentIgnoredCount();
    if (ignoredCount) ignoredCount.textContent = value ? `（${value}）` : '';
  }
  function navigateToMember(id) {
    if (!id) return;
    if (dialog.open) dialog.close();
    window.selectFamilyMember?.(id, { expandDetails: true });
  }
  function renderMemberList() {
    const people = window.FAMILY?.people || [], linked = FamilyModel.relationshipMemberIds(people);
    const keyword = normalized(searchMembers?.value.trim() || '');
    const visible = people.filter(person => {
      const connected = linked.has(person.id);
      if (memberFilter === 'unlinked' && connected) return false;
      if (!keyword) return true;
      return normalized([person.name, person.location, person.position, connected ? `第 ${person.gen} 代` : '未設定關係'].join(' ')).includes(keyword);
    });
    if (recentSection && recentItems) {
      const byId = new Map(people.map(person => [person.id, person]));
      const recentIds = readRecentMembers().filter(id => byId.has(id));
      if (recentIds.length !== readRecentMembers().length) writeRecentMembers(recentIds);
      recentItems.replaceChildren();
      const showRecent = !keyword && memberFilter === 'all' && recentIds.length > 0;
      recentSection.hidden = !showRecent;
      if (showRecent) recentIds.forEach(id => {
        const person = byId.get(id);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'member-list-recent__item';
        button.textContent = person.name; button.title = [person.location, person.position].filter(Boolean).join(' · ');
        button.addEventListener('click', () => navigateToMember(id));
        recentItems.appendChild(button);
      });
    }
    body.replaceChildren();
    visible.forEach(person => {
      const row = document.createElement('tr'); const connected = linked.has(person.id);
      row.dataset.personId = person.id; row.className = 'member-list-row' + (!connected ? ' member-list-unlinked' : '');
      row.tabIndex = 0; row.setAttribute('aria-label', `查看${person.name}並定位到族譜圖`);
      const values = [person.name, person.location, person.position, connected ? `第 ${person.gen} 代` : ''];
      const labels = ['姓名', '所在地', '職位', '代別'];
      values.forEach((value, index) => {
        const cell = document.createElement('td'); cell.dataset.label = labels[index];
        if (index === 0) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'member-list-name-button';
          button.textContent = value; button.setAttribute('aria-label', `查看${person.name}並定位到族譜圖`);
          button.addEventListener('click', event => { event.stopPropagation(); navigateToMember(person.id); });
          cell.appendChild(button);
        } else cell.textContent = value;
        row.append(cell);
      });
      if (!connected) { row.title = '尚未設定任何關係'; const badge = document.createElement('span'); badge.className = 'unlinked-badge'; badge.textContent = '未設定關係'; row.firstChild.append(badge); }
      row.addEventListener('click', () => navigateToMember(person.id));
      row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigateToMember(person.id); } });
      body.append(row);
    });
    empty.hidden = visible.length > 0;
    filterButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.memberFilter === memberFilter)));
    const unlinkedCount = people.filter(person => !linked.has(person.id)).length;
    const unlinkedButton = filterButtons.find(button => button.dataset.memberFilter === 'unlinked');
    if (unlinkedButton) unlinkedButton.textContent = `未設定關係${unlinkedCount ? `（${unlinkedCount}）` : ''}`;
    if (memberFilter === 'unlinked') {
      count.textContent = keyword
        ? `顯示 ${visible.length} / ${unlinkedCount} 位未設定關係成員。點選成員可定位到族譜圖並開啟關係詳情。`
        : `共 ${unlinkedCount} 位未設定關係成員。點選成員可定位到族譜圖並開啟關係詳情。`;
    } else {
      count.textContent = keyword
        ? `顯示 ${visible.length} / 共 ${people.length} 位成員。點選成員可定位到族譜圖並開啟關係詳情。`
        : `共 ${people.length} 位成員；淡黃色列表示未設定關係，代別留空。點選成員可定位到族譜圖並開啟關係詳情。`;
    }
    refreshIgnoredCount();
  }
  document.getElementById('show-member-list').addEventListener('click', () => {
    if (searchMembers) searchMembers.value = '';
    memberFilter = 'all';
    renderMemberList();
    dialog.showModal();
    searchMembers?.focus();
  });
  searchMembers?.addEventListener('input', renderMemberList);
  filterButtons.forEach(button => button.addEventListener('click', () => {
    memberFilter = button.dataset.memberFilter || 'all';
    renderMemberList();
  }));
  ignoredOpen?.addEventListener('click', () => {
    if (dialog.open) dialog.close();
    window.openIgnoredIntermediatePlans?.();
  });
  document.getElementById('close-member-list').addEventListener('click', () => dialog.close());
  window.addEventListener('familyintermediatechange', () => { refreshIgnoredCount(); if (dialog.open) renderMemberList(); });
  window.addEventListener('familyrepositorychange', () => { queueMicrotask(() => { refreshIgnoredCount(); if (dialog.open) renderMemberList(); }); });
  window.addEventListener('familymemberviewed', event => rememberRecentMember(event.detail?.id));
  refreshIgnoredCount();
})();
