/* Current-data maintenance tasks. No saved issue lists or automatic merges. */
(function (root,factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./family-model.js') : root.FamilyModel,
    node ? require('./family-location.js') : root.FamilyLocation);
  if (node) module.exports = api; else root.FamilyMaintenance = api;
})(globalThis,function (Model,Location) {
  'use strict';
  const categories = { unlinked:'未設定關係',intermediate:'待補親屬',location:'待處理定位',duplicate:'疑似重複成員' };
  const normalize = text => String(text || '').normalize('NFKC').trim().replace(/\s+/g,'').toLocaleLowerCase();
  function tasks(data,{ locationState = {} } = {}) {
    const graph = Model.build(data), active = new Map(graph.people.filter(p => !p.archive).map(p => [p.id,p]));
    const linked = Model.relationshipMemberIds(graph.people, graph.bonds), items = [];
    const add = (category,id,title,reason,personIds,action,extra = {}) => items.push({ category,id,title,reason,personIds,action,...extra });
    for (const p of active.values()) {
      if (!linked.has(p.id)) add('unlinked',p.id,p.name,'尚無入向或出向的直接關係。',[p.id],'edit',{ ownerId:p.id });
      if (Location.eligible(p) && !Location.effective(p)) {
        const reason = Location.current(p) ? ({ not_found:'查無地點，請補充地名或指定位置。',ambiguous:'有多個同名地點，請確認正確位置。' })[p.geocode.status]
          : locationState.kind === 'retry' && Location.normalize(locationState.query) === Location.normalize(p.location) ? '查詢失敗，等待重試；也可直接修正位置。' : '尚未查詢，等待背景定位。';
        add('location',p.id,p.name,`${p.location} · ${reason}`,[p.id],'location',{ ownerId:p.id });
      }
    }
    const slots = new Set();
    for (const plan of Model.intermediatePlans(data)) {
      if (!active.has(plan.near) || !active.has(plan.other) || slots.has(plan.slotId)) continue;
      slots.add(plan.slotId); add('intermediate',plan.slotId,plan.title,'依現有關係建議補登；不會自動建立成員。',[plan.near,plan.other],'intermediate',{ planId:plan.id });
    }
    const names = new Map();
    for (const p of active.values()) { const key = normalize(p.name); if (!names.has(key)) names.set(key,[]); names.get(key).push(p); }
    for (const people of names.values()) for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
      const a = people[i],b = people[j],samePlace = normalize(a.location) && normalize(a.location) === normalize(b.location);
      add('duplicate',JSON.stringify([a.id,b.id].sort()),`${a.name}／${b.name}`,`姓名正規化後相同${samePlace ? '，所在地也相同' : ''}。請確認是否為同一人。`,[a.id,b.id],'merge',
        { keepId:a.id,removeId:b.id,locations:[a.location,b.location] });
    }
    return { items,counts:Object.fromEntries(Object.keys(categories).map(key => [key,items.filter(item => item.category === key).length])),total:items.length };
  }
  return { categories,normalize,tasks };
});
