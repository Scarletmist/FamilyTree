/* Shared accessible comparison for cloud conflicts, merges and import previews. */
(function () {
  'use strict';
  const el = (tag,text,cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
  let nextId = 0;
  const entityLabels = { member:'成員',relationship:'關係',group:'排行群組',recycle:'回收紀錄',family:'族譜設定' };
  const actionLabels = { added:'新增',removed:'移除',changed:'修改' };
  function readable(value, field, data) {
    if (field === '成員' && value) { const copy = {...value}; delete copy.id; return FamilyDiff.format(copy,field); }
    if (field === 'groupId' && value) return data.rankGroups?.find(g => g.id === value)?.name || '已移除群組';
    if (!value || !['排行群組','回收紀錄'].includes(field)) return FamilyDiff.format(value,field);
    const people = new Map([...(data.people || []),...(data.recycleBin || []).map(entry => entry.person)].map(p => [p.id,p]));
    const name = id => people.get(id)?.name || '已移除成員';
    if (field === '排行群組') return [value.name + ' · ' + ({sibling:'家庭手足',swornSibling:'契手足',fellowDisciple:'師門'})[value.type],
      value.anchorId ? '所屬：' + name(value.anchorId) : '未指定所屬人物',
      ...(value.members || []).map(m => name(m.personId) + '：' + (m.order == null ? '排行未知' : '排行 ' + m.order))].join('\n');
    return [value.person.name + '已移至回收區', '移入時間：' + new Date(value.deletedAt).toLocaleString('zh-TW'),
      '保留 ' + ((value.person.relationships || []).length + (value.incomingRelationships || []).length) + ' 筆關係、' + (value.groupReferences || []).length + ' 組排行參照供還原'].join('\n');
  }
  function valueCell(value,field,label,data) {
    const cell = el('div',undefined,'family-diff-value');
    cell.append(el('span',label,'family-diff-value__label'));
    const text = readable(value,field,data);
    if (text.length > 180) {
      const details = el('details',undefined,'family-diff-long');
      details.append(el('summary',text.slice(0,80) + '…（展開完整內容）'),el('pre',text)); cell.append(details);
    } else cell.append(el('span',text,'family-diff-value__text'));
    if (value && ['排行群組','回收紀錄','成員'].includes(field)) {
      const raw = el('details',undefined,'family-diff-raw'); raw.append(el('summary','進階：原始資料'),el('pre',JSON.stringify(value,null,2))); cell.append(raw);
    }
    return cell;
  }
  window.renderFamilyDifferences = (container,before,after,options = {}) => {
    container.querySelector('.family-differences')?.remove();
    const result = FamilyDiff.compare(before,after), prefix = 'family-diff-' + ++nextId;
    const combined = {people:[...new Map([...before.people,...after.people].map(p => [p.id,p])).values()]};
    const section = el('details',undefined,'family-differences'); section.open = true;
    const oldLabel = options.beforeLabel || '目前版本', newLabel = options.afterLabel || '新版本';
    section.append(el('summary',`內容差異（${oldLabel} → ${newLabel}，共 ${result.total} 項）`));
    if (!result.total) { section.append(el('p','成員與關係內容相同。')); container.append(section); return; }
    const summary = el('p',undefined,'family-diff-summary');
    summary.setAttribute('role','status');
    summary.textContent = Object.keys(entityLabels).filter(entity => Object.values(result.summary[entity]).some(Boolean)).map(entity => {
      const count = result.summary[entity];
      return `${entityLabels[entity]}：新增 ${count.added}、移除 ${count.removed}、修改 ${count.changed}`;
    }).join('；');
    const controls = el('div',undefined,'family-diff-controls');
    const searchLabel = el('label','搜尋差異'), search = el('input'); search.type = 'search'; search.id = prefix + '-search'; search.placeholder = '成員、欄位或內容'; searchLabel.htmlFor = search.id; searchLabel.append(search);
    const categoryLabel = el('label','差異類別'), category = el('select'); category.id = prefix + '-category'; categoryLabel.htmlFor = category.id;
    for (const [value,text] of [['all','所有差異'],...Object.entries(entityLabels)]) { const option = el('option',text); option.value = value; category.append(option); }
    categoryLabel.append(category);
    const systemLabel = el('label',undefined,'family-diff-system-toggle'), system = el('input'); system.type = 'checkbox';
    systemLabel.append(system,el('span','顯示系統資料')); controls.append(searchLabel,categoryLabel,systemLabel);
    const count = el('p',undefined,'family-diff-count'); count.setAttribute('role','status');
    const list = el('div',undefined,'family-diff-groups');
    function draw() {
      list.replaceChildren();
      const keyword = search.value.trim().normalize('NFKC').toLocaleLowerCase();
      const visible = result.items.filter(item => (system.checked || !item.system) && (category.value === 'all' || category.value === item.entity)
        && (!keyword || [item.label,item.entityId,item.fieldLabel,readable(item.before,item.field,before),readable(item.after,item.field,after)].join(' ').normalize('NFKC').toLocaleLowerCase().includes(keyword)));
      const systemCount = result.items.filter(item => item.system).length;
      count.textContent = `顯示 ${visible.length}／${result.total} 項差異${!system.checked && systemCount ? `；${systemCount} 項系統資料可展開查看` : ''}`;
      const groups = new Map();
      for (const item of visible) {
        const key = item.entity + ':' + item.entityId;
        if (!groups.has(key)) {
          const group = el('section',undefined,'family-diff-group');
          const person = [...before.people,...after.people].find(p => p.id === item.entityId);
          let label = person ? window.familyPersonLabel(person,combined) : item.label;
          for (const p of [...before.people,...after.people]) label = label.replaceAll('（ID：' + p.id + '）','（' + (p.location || p.position || '同名成員') + '）');
          const heading = el('h3',`${actionLabels[item.kind]}${entityLabels[item.entity]}：${label}`);
          heading.id = prefix + '-group-' + groups.size; group.setAttribute('aria-labelledby',heading.id);
          group.append(heading); list.append(group); groups.set(key,group);
        }
        const row = el('div',undefined,'family-diff-row'); row.dataset.change = item.kind;
        row.append(el('strong',item.fieldLabel,'family-diff-field'),valueCell(item.before,item.field,oldLabel,before),valueCell(item.after,item.field,newLabel,after));
        groups.get(key).append(row);
      }
      if (!visible.length) list.append(el('p','沒有符合的差異。若有系統資料，可勾選上方選項查看。','form-note'));
    }
    search.addEventListener('input',draw); category.addEventListener('change',draw); system.addEventListener('change',draw);
    const advanced = el('details',undefined,'family-diff-filters'); advanced.open = result.total > 8;
    advanced.append(el('summary','搜尋與篩選差異'),controls);
    section.append(summary,advanced,count,list); container.append(section); draw();
  };
})();
