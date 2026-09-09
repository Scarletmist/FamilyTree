/* Relationship detail presentation. The graph remains the only source of relationship data. */
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./family-model.js') : root.FamilyModel;
  const details = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = details;
  else root.FamilyRelationshipDetails = details;
})(globalThis, function (FamilyModel) {
  'use strict';
  const CHILD_KINDS = new Set(['親生', '過繼', '養子女']);
  const CATEGORIES = [
    { id: 'parents', title: '父母' },
    { id: 'grandparents', title: '祖父母（直接設定）' },
    { id: 'spouses', title: '配偶' },
    { id: 'children', title: '子女' },
    { id: 'grandchildren', title: '孫子女（直接設定）' },
    { id: 'siblings', title: '手足' },
    { id: 'teachers', title: '師父' },
    { id: 'students', title: '徒弟' }
  ];
  function chineseNumber(n) {
    const digits = '零一二三四五六七八九';
    if (n < 10) return digits[n];
    if (n < 100) return (n < 20 ? '' : digits[Math.floor(n / 10)]) + '十' + (n % 10 ? digits[n % 10] : '');
    return String(n);
  }
  function siblingRole(sibling, person) {
    const order = FamilyModel.compareOrder(sibling, person);
    if (!order) return '手足（長幼待確認）';
    if (!['M', 'F'].includes(sibling.gender)) return order < 0 ? '年長手足' : '年幼手足';
    const prefix = sibling.siblingOrder === 1 ? '長' : chineseNumber(sibling.siblingOrder);
    return prefix + (order < 0 ? (sibling.gender === 'M' ? '兄' : '姊') : (sibling.gender === 'M' ? '弟' : '妹'));
  }
  function buildGroups(graph, personId) {
    const byId = new Map(graph.people.map(p => [p.id, p]));
    const person = byId.get(personId);
    if (!person) return [];
    const groups = new Map(CATEGORIES.map(category => [category.id, new Map()]));
    const unions = new Map((graph.unions || []).map(u => [u.id, u]));
    const descents = graph.descents || [];
    function add(group, id, { kind, context, ordinary = false, sworn = false } = {}) {
      if (id === personId || !byId.has(id)) return;
      const entries = groups.get(group);
      if (!entries.has(id)) entries.set(id, {
        personId: id, name: byId.get(id).name, kinds: new Set(), contexts: new Set(), ordinary: false, sworn: false
      });
      const entry = entries.get(id);
      if (kind) entry.kinds.add(kind);
      if (context) entry.contexts.add(context);
      entry.ordinary ||= ordinary;
      entry.sworn ||= sworn;
    }
    function parentNames(union) {
      return union.partners.map(id => byId.get(id)?.name).filter(Boolean).join('、');
    }
    for (const union of graph.unions || []) {
      if (union.married && union.partners.includes(personId)) {
        union.partners.filter(id => id !== personId).forEach(id => add('spouses', id));
      }
    }
    for (const descent of descents) {
      const union = unions.get(descent.union);
      if (!union) continue;
      const grand = descent.generations === 2;
      const context = (grand ? '共同祖父母：' : '共同父母：') + parentNames(union);
      if (descent.child === personId) {
        union.partners.forEach(id => add(grand ? 'grandparents' : 'parents', id, { kind: descent.kind, context: union.partners.length > 1 ? context : '' }));
        // Only these parent-child kinds imply ordinary siblings, as in the original model.
        if (!grand && CHILD_KINDS.has(descent.kind)) {
          descents.filter(d => d.union === union.id && d.generations !== 2 && CHILD_KINDS.has(d.kind) && d.child !== personId)
            .forEach(d => add('siblings', d.child, { kind: d.kind, ordinary: true, context }));
        }
      }
      if (union.partners.includes(personId)) {
        add(grand ? 'grandchildren' : 'children', descent.child, { kind: descent.kind, context: union.partners.length > 1 ? context : '' });
      }
    }
    for (const bond of graph.bonds || []) {
      if (!bond.members.includes(personId)) continue;
      const other = bond.members.find(id => id !== personId);
      add('siblings', other, { ordinary: bond.kind === '手足', sworn: bond.kind === '契手足' });
    }
    for (const mentorship of graph.mentorships || []) {
      if (mentorship.teacher === personId) add('students', mentorship.student);
      if (mentorship.student === personId) add('teachers', mentorship.teacher);
    }
    return CATEGORIES.map(category => {
      const entries = [...groups.get(category.id).values()].map(entry => {
        const target = byId.get(entry.personId);
        let role = '';
        const badges = [...entry.kinds];
        if (['grandparents', 'grandchildren'].includes(category.id)) {
          const noun = category.id === 'grandparents' ? ({ M: '祖父', F: '祖母', U: '祖父母' })[target.gender] : ({ M: '孫子', F: '孫女', U: '孫子女' })[target.gender];
          role = [...entry.kinds].map(kind => ({ 親生: '親生', 過繼: '過繼', 養子女: '養', 義子女: '義', 契子女: '契' })[kind] + noun).join('、');
        }
        if (category.id === 'siblings') {
          role = entry.ordinary ? siblingRole(target, person) : '契手足';
          if (entry.sworn && entry.ordinary) badges.push('契手足');
        }
        return { ...entry, role, badges, contexts: [...entry.contexts], kinds: [...entry.kinds],
          ordinary: entry.ordinary, sworn: entry.sworn };
      });
      if (category.id === 'siblings') {
        entries.sort((a, b) => {
          const left = byId.get(a.personId), right = byId.get(b.personId);
          return FamilyModel.orderKey(left) - FamilyModel.orderKey(right) || a.name.localeCompare(b.name, 'zh-Hant') || a.personId.localeCompare(b.personId);
        });
      }
      return { ...category, entries };
    }).filter(group => group.entries.length);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function iconButton(className, label, path) {
    const button = element('button', 'details-icon ' + className);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    button.appendChild(svg);
    return button;
  }
  function createController() {
    // Keep disclosure and drawer choices when the graph is redrawn.
    const openStates = new Map();
    let collapsed = false;
    function remember(panel) {
      const id = panel.dataset.memberId;
      if (!id) return;
      const state = new Map();
      panel.querySelectorAll('details[data-group]').forEach(details => state.set(details.dataset.group, details.open));
      if (state.size) openStates.set(id, state);
    }
    function setCollapsed(panel, value, { focus = false } = {}) {
      collapsed = Boolean(value);
      const content = panel.querySelector('.relationship-details__content');
      const tab = panel.querySelector('.relationship-details__tab');
      if (!content || !tab) return;
      panel.dataset.collapsed = String(collapsed);
      content.hidden = collapsed;
      content.inert = collapsed;
      tab.hidden = !collapsed;
      tab.setAttribute('aria-expanded', String(!collapsed));
      const button = content.querySelector('.details-collapse');
      if (button) button.setAttribute('aria-expanded', String(!collapsed));
      if (focus) (collapsed ? tab : button)?.focus({ preventScroll: true });
    }
    function render(panel, graph, personId, { onEdit, onClose } = {}) {
      // Redrawing must not strand keyboard focus in a removed control.
      const active = document.activeElement;
      const focused = active && panel.contains(active) ?
        { className: active.classList.contains('relationship-details__tab') ? 'relationship-details__tab' :
          active.classList.contains('edit-member') ? 'edit-member' :
          active.classList.contains('details-collapse') ? 'details-collapse' :
          active.classList.contains('details-close') ? 'details-close' : '',
          group: active.closest('details[data-group]')?.dataset.group } : null;
      remember(panel);
      panel.replaceChildren();
      panel.dataset.memberId = personId || '';
      const person = graph?.people.find(p => p.id === personId);
      panel.hidden = !person;
      if (!person) return;
      const content = element('div', 'relationship-details__content');
      content.id = 'relationship-details-content';
      const header = element('div', 'relationship-details__header');
      const edit = iconButton('edit-member', '編輯' + person.name + '的成員與關係', 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5z');
      edit.addEventListener('click', () => onEdit?.(person.id));
      const collapse = iconButton('details-collapse', '收合關係詳情至右側', 'M9 6l6 6-6 6');
      collapse.setAttribute('aria-controls', content.id);
      collapse.addEventListener('click', () => setCollapsed(panel, true, { focus: true }));
      const close = iconButton('details-close', '關閉關係詳情', 'M18 6 6 18 M6 6l12 12');
      close.addEventListener('click', () => onClose?.());
      const title = element('h2', '', person.name + '的關係');
      title.id = 'relationship-details-title';
      header.append(edit, title, collapse, close);
      content.appendChild(header);
      const profile = element('div', 'relationship-details__profile');
      profile.appendChild(element('p', '', '所在地：' + (person.location || '未填寫')));
      profile.appendChild(element('p', '', '職位：' + (person.position || '未填寫')));
      content.appendChild(profile);
      const groups = buildGroups(graph, person.id);
      if (!groups.length) {
        content.appendChild(element('p', 'relationship-details__empty', '尚未記錄關係。'));
      } else {
        const list = element('div', 'relationship-groups');
        const saved = openStates.get(person.id);
        groups.forEach((group, index) => {
          const details = element('details', 'relationship-group');
          details.dataset.group = group.id;
          details.open = saved?.has(group.id) ? saved.get(group.id) : index === 0;
          const summary = element('summary', 'relationship-group__summary');
          summary.append(element('span', 'relationship-group__title', group.title), element('span', 'relationship-group__count', String(group.entries.length)));
          details.appendChild(summary);
          const items = element('ul', 'relationship-group__list');
          group.entries.forEach(entry => {
            const item = element('li', 'relationship-entry');
            const main = element('div', 'relationship-entry__main');
            main.appendChild(element('span', 'relationship-entry__name', entry.name));
            if (entry.role) main.appendChild(element('span', 'relationship-entry__role', entry.role));
            item.appendChild(main);
            if (entry.badges.length) {
              const badges = element('div', 'relationship-entry__badges');
              entry.badges.forEach(badge => badges.appendChild(element('span', 'relationship-entry__badge', badge)));
              item.appendChild(badges);
            }
            entry.contexts.forEach(context => item.appendChild(element('p', 'relationship-entry__context', context)));
            items.appendChild(item);
          });
          details.appendChild(items);
          list.appendChild(details);
        });
        content.appendChild(list);
      }
      const tab = element('button', 'relationship-details__tab');
      tab.type = 'button';
      tab.setAttribute('aria-label', '展開' + person.name + '的關係詳情');
      tab.setAttribute('aria-controls', content.id);
      tab.title = '展開關係詳情';
      const arrow = element('span', 'relationship-details__tab-arrow', '‹');
      arrow.setAttribute('aria-hidden', 'true');
      tab.append(arrow, element('span', 'relationship-details__tab-text', person.name + '的關係'));
      tab.addEventListener('click', () => setCollapsed(panel, false, { focus: true }));
      panel.append(content, tab);
      setCollapsed(panel, collapsed);
      if (focused && !panel.hidden) {
        const target = collapsed ? tab : focused.group ?
          [...panel.querySelectorAll('details[data-group]')].find(group => group.dataset.group === focused.group)?.querySelector('summary') :
          focused.className ? panel.querySelector('.' + focused.className) : null;
        (target || content.querySelector('.details-collapse'))?.focus({ preventScroll: true });
      }
    }
    return { render, setCollapsed, isCollapsed: () => collapsed };
  }

  return { buildGroups, siblingRole, createController };
});
