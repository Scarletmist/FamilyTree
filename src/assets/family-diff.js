/* Structured, direction-normalized differences; no DOM or mutable application state. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./relationship-evidence.js') : root.RelationshipEvidence);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyDiff = api;
})(globalThis, function (Evidence) {
  'use strict';
  const labels = { id:'成員 ID',type:'關係類型',kind:'親屬類別',archivedAt:'封存時間',reason:'原因',name:'姓名', gender:'性別', location:'所在地', position:'職位', notes:'備註', siblingOrder:'手足排行', discipleOrder:'師門排行', mapHidden:'不在地圖顯示', geocode:'定位結果', locationOverride:'手動修正位置', archive:'封存狀態', seniority:'長幼', groupId:'排行群組', source:'來源', note:'說明', familyName:'家族名稱', ignoredIntermediatePlans:'已忽略待補項目', schemaVersion:'資料格式版本', locationLookupDeviceId:'定位裝置' };
  const typeNames = { parent:'父母',child:'子女',grandparent:'祖父母',grandchild:'孫子女',spouse:'配偶',sibling:'手足',swornSibling:'契手足',fellowDisciple:'同門',teacher:'師父',student:'徒弟',tangCousin:'堂親',biaoCousin:'表親' };
  const systemFields = new Set(['geocode','locationLookupDeviceId','schemaVersion']);
  const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  function format(value, field) {
    if (value === undefined || value === null || value === '') return '未填寫';
    if (value && typeof value === 'object' && Array.isArray(value.conflictingValues)) return '雙向記錄不一致：' + value.conflictingValues.map(v => format(v,field)).join('／');
    if (value && typeof value === 'object' && Array.isArray(value.conflictingValues)) return '雙向記錄不一致：' + value.conflictingValues.map(v => format(v,field)).join('／');
    if (field === 'gender') return ({ M:'男', F:'女', U:'未知／尚未確認' })[value] || String(value);
    if (field === 'seniority') return ({ older:'年長', younger:'年幼', unknown:'未確認' })[value] || String(value);
    if (field === 'type') return typeNames[value] || String(value);
    if (typeof value === 'object' && !Array.isArray(value) && ['成員','關係','archive'].includes(field)) {
      return Object.entries(value).filter(([key]) => field !== '關係' || key !== 'status').map(([key,item]) => `${labels[key] || key}：${format(item,key)}`).join('\n');
    }
    if (typeof value === 'object') return JSON.stringify(value,null,2);
    if (typeof value === 'boolean') return value ? '是' : '否';
    return String(value);
  }
  function compare(before, after) {
    const items = [], left = new Map(before.people.map(p => [p.id,p])), right = new Map(after.people.map(p => [p.id,p]));
    const people = new Map([...left,...right]), nameCounts = new Map();
    for (const p of people.values()) nameCounts.set(p.name,(nameCounts.get(p.name) || 0) + 1);
    const nameFor = id => {
      const name = people.get(id)?.name;
      return name ? name + (nameCounts.get(name) > 1 ? `（ID：${id}）` : '') : id;
    };
    const add = (entity,entityId,label,field,oldValue,newValue,personIds=[],kind='changed') => {
      items.push({ entity,entityId,label,field,fieldLabel:labels[field] || field,kind,before:copy(oldValue),after:copy(newValue),personIds,
        system:systemFields.has(field) });
    };
    for (const id of new Set([...left.keys(),...right.keys()])) {
      const a = left.get(id), b = right.get(id), label = nameFor(id);
      if (!a || !b) {
        const clean = p => { if (!p) return null; const value = { ...p }; delete value.inferredRelationships; delete value.relationships; delete value.geocode; return value; };
        const kind = a ? 'removed' : 'added';
        add('member',id,label,'成員',clean(a),clean(b),[id],kind);
        if (a?.geocode || b?.geocode) add('member',id,label,'geocode',a?.geocode,b?.geocode,[id],kind);
        continue;
      }
      for (const key of new Set([...Object.keys(a),...Object.keys(b)])) {
        if (['id','relationships','inferredRelationships'].includes(key)) continue;
        if (!Evidence.same(a[key] ?? null,b[key] ?? null)) add('member',id,label,key,a[key],b[key],[id]);
      }
    }
    const oldEdges = Evidence.records(before), newEdges = Evidence.records(after);
    for (const key of new Set([...oldEdges.keys(),...newEdges.keys()])) {
      const a = oldEdges.get(key), b = newEdges.get(key), edge = b || a;
      const label = `${nameFor(edge.to)}是${nameFor(edge.from)}的${typeNames[edge.relation.type] || edge.relation.type}${edge.relation.kind ? '（' + edge.relation.kind + '）' : ''}`;
      if (!a || !b) { add('relationship',key,label,'關係',a?.relation,b?.relation,[edge.from,edge.to],a ? 'removed' : 'added'); continue; }
      for (const field of new Set([...Object.keys(a.relation),...Object.keys(b.relation)])) {
          if (field === 'status') continue; // Legacy confirmation is no longer an editable relationship field.
        if (!Evidence.same(a.relation[field] ?? null,b.relation[field] ?? null)) add('relationship',key,label,field,a.relation[field],b.relation[field],[edge.from,edge.to]);
      }
    }
    for (const [key,entity] of [['rankGroups','group'],['recycleBin','recycle']]) {
      const oldItems = new Map((before[key] || []).map(g => [g.id,g])), newItems = new Map((after[key] || []).map(g => [g.id,g]));
      for (const id of new Set([...oldItems.keys(),...newItems.keys()])) {
        const a = oldItems.get(id), b = newItems.get(id), value = b || a;
        // Rank-group member ordering is presentation, not a change in ranks.
        const normalize = g => entity === 'group' && g ? { ...g,members:g.members.slice().sort((x,y) => x.personId.localeCompare(y.personId)) } : g;
        if (!Evidence.same(normalize(a),normalize(b))) add(entity,id,value.name || value.person?.name || id,entity === 'group' ? '排行群組' : '回收紀錄',a,b,
          entity === 'group' ? [...new Set([...(a?.members || []),...(b?.members || [])].map(m => m.personId))] : [value.person.id],!a ? 'added' : !b ? 'removed' : 'changed');
      }
    }
    for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
      if (['people','rankGroups','recycleBin'].includes(key)) continue;
      const a = key === 'familyName' ? before[key] ?? '陳氏家族' : key === 'ignoredIntermediatePlans' ? [...(before[key] || [])].sort() : before[key];
      const b = key === 'familyName' ? after[key] ?? '陳氏家族' : key === 'ignoredIntermediatePlans' ? [...(after[key] || [])].sort() : after[key];
      if (!Evidence.same(a ?? null,b ?? null)) add('family','family',labels[key] || key,key,a,b);
    }
    const priority = item => item.kind === 'removed' || item.field === 'archive' ? 0 : item.entity === 'relationship' ? 1 : item.system ? 3 : 2;
    items.sort((a,b) => priority(a)-priority(b));
    const summary = {};
    for (const entity of ['member','relationship','group','recycle','family']) {
      summary[entity] = {};
      for (const kind of ['added','removed','changed']) summary[entity][kind] = new Set(items.filter(i => i.entity === entity && i.kind === kind).map(i => i.entityId)).size;
    }
    return { items,summary,total:items.length };
  }
  function lines(before,after) {
    return compare(before,after).items.map(item => {
      const prefix = ({ added:'新增',removed:'移除',changed:'修改' })[item.kind];
      const entity = ({ member:'成員',relationship:'關係',group:'排行群組',recycle:'回收紀錄',family:'族譜' })[item.entity];
      if (item.kind !== 'changed') return `${prefix}${entity}：${item.label}`;
      return `${prefix}${entity}：${item.label}・${item.fieldLabel}：${format(item.before,item.field)} → ${format(item.after,item.field)}`;
    });
  }
  return { compare,lines,format };
});
