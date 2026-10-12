/* Reversible member lifecycle operations. The caller supplies the domain validator. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./relationship-evidence.js') : root.RelationshipEvidence);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyLifecycle = api;
})(globalThis, function (Evidence) {
  'use strict';
  const clone = data => JSON.parse(JSON.stringify(data));
  const fail = message => { throw Object.assign(new Error(message),{ status:400,code:'INVALID_LIFECYCLE' }); };
  const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  function validateArchive(person) {
    if (person?.archive !== undefined && (!person.archive || Array.isArray(person.archive) || !validTime(person.archive.archivedAt)
      || person.archive.reason !== undefined && (typeof person.archive.reason !== 'string' || person.archive.reason.length > 2000))) fail('封存資料格式不正確。');
  }
  function validate(data, validateMember) {
    for (const person of data.people) validateArchive(person);
    if (data.recycleBin === undefined) return;
    if (!Array.isArray(data.recycleBin)) fail('回收區須為陣列。');
    const ids = new Set();
    for (const entry of data.recycleBin) {
      if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || !validTime(entry.deletedAt) || !entry.person || entry.id !== entry.person.id
        || !Array.isArray(entry.incomingRelationships) || !Array.isArray(entry.groupReferences) || !Array.isArray(entry.ignoredPlans)) fail('回收資料格式不正確。');
      ids.add(entry.id); validateMember(entry.person);
      validateArchive(entry.person);
      for (const incoming of entry.incomingRelationships) {
        if (!incoming || typeof incoming.ownerId !== 'string' || incoming.ownerId === entry.id || incoming.relation?.personId !== entry.id) fail('回收關係資料不正確。');
        validateMember({ ...entry.person,id:incoming.ownerId,relationships:[incoming.relation] });
      }
      const groupIds = new Set();
      for (const ref of entry.groupReferences) {
        if (!ref || typeof ref.groupId !== 'string' || groupIds.has(ref.groupId) || typeof ref.wasAnchor !== 'boolean' || (!ref.wasAnchor && !ref.member)
          || (ref.type !== undefined && !['sibling','swornSibling','fellowDisciple'].includes(ref.type)) || (ref.member && (ref.member.personId !== entry.id
          || ref.member.order !== null && (!Number.isInteger(ref.member.order) || ref.member.order < 1 || ref.member.order > 999)))) fail('回收排行資料不正確。');
        groupIds.add(ref.groupId);
      }
      if (entry.ignoredPlans.some(p => typeof p !== 'string' || p.length > 500)) fail('回收待補紀錄不正確。');
    }
  }
  function selectedOmissions(command, field, allowed) {
    const values = command[field] || [];
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !allowed.has(value))) fail('還原選擇已不適用，請重新預覽。');
    return new Set(values);
  }
  function preview(data, command, Model) {
    const originalGraph = Model.build(data);
    if (!command || typeof command.id !== 'string') fail('請選擇要操作的成員。');
    const next = clone(data); next.schemaVersion = 3;
    const conflicts = [], affected = new Set([command.id]);
    let label, unchanged = false;
    if (command.type === 'restoreMember') {
      const entry = next.recycleBin?.find(e => e.id === command.id);
      if (!entry) fail('找不到要還原的回收成員。');
      label = `還原成員「${entry.person.name}」`;
      if (next.people.some(p => p.id === entry.person.id)) return { canApply:false,conflicts:[{ kind:'member',key:entry.id,message:'此成員 ID 已被使用，不能覆蓋目前成員。' }],affectedPersonIds:[entry.id],label,data:null,unchanged:false };
      const person = clone(entry.person); delete person.inferredRelationships;
      const clearOrders = selectedOmissions(command,'clearOrders',new Set(['siblingOrder','discipleOrder']));
      for (const key of clearOrders) person[key] = null;
      const relationshipKeys = new Set([...person.relationships.map(r => Evidence.canonical(person.id,r).key),...entry.incomingRelationships.map(r => Evidence.canonical(r.ownerId,r.relation).key)]);
      const omit = selectedOmissions(command,'omitRelationships',relationshipKeys);
      const omitGroups = selectedOmissions(command,'omitGroups',new Set(entry.groupReferences.map(r => r.groupId)));
      const restoredRelation = relation => {
        const copy = clone(relation);
        if (omitGroups.has(copy.groupId)) delete copy.groupId;
        return copy;
      };
      const present = new Set([...next.people.map(p => p.id),person.id]);
      person.relationships = person.relationships.filter(r => {
        const key = Evidence.canonical(person.id,r).key;
        if (omit.has(key)) return false;
        if (!present.has(r.personId)) { conflicts.push({ kind:'relationship',key,message:`關係對象「${r.personId}」已不存在。` }); return false; }
        affected.add(r.personId); return true;
      }).map(restoredRelation);
      next.people.push(person);
      for (const incoming of entry.incomingRelationships) {
        const key = Evidence.canonical(incoming.ownerId,incoming.relation).key;
        if (omit.has(key)) continue;
        const owner = next.people.find(p => p.id === incoming.ownerId);
        if (!owner) { conflicts.push({ kind:'relationship',key,message:`原關係記錄者「${incoming.ownerId}」已不存在。` }); continue; }
        owner.relationships.push(restoredRelation(incoming.relation)); affected.add(owner.id);
      }
      for (const ref of entry.groupReferences) {
        if (omitGroups.has(ref.groupId)) continue;
        const group = next.rankGroups?.find(g => g.id === ref.groupId);
        if (!group) { conflicts.push({ kind:'group',key:ref.groupId,message:`排行群組「${ref.groupId}」已不存在。` }); continue; }
        if (ref.type && ref.type !== group.type) { conflicts.push({ kind:'group',key:ref.groupId,message:`「${group.name}」的群組類型已改變。` }); continue; }
        if (ref.wasAnchor && group.anchorId && group.anchorId !== person.id) { conflicts.push({ kind:'group',key:ref.groupId,message:`「${group.name}」已改用其他父母或師父。` }); continue; }
        if (ref.member?.order != null && group.members.some(m => m.order === ref.member.order)) { conflicts.push({ kind:'group',key:ref.groupId,message:`「${group.name}」的原排行已被使用。` }); continue; }
        if (ref.wasAnchor) group.anchorId = person.id;
        if (ref.member) group.members.push(clone(ref.member));
        group.members.forEach(m => affected.add(m.personId));
      }
      next.ignoredIntermediatePlans = [...new Set([...(next.ignoredIntermediatePlans || []),...entry.ignoredPlans])];
      next.recycleBin = next.recycleBin.filter(e => e.id !== entry.id);
    } else {
      const person = next.people.find(p => p.id === command.id);
      if (!person) fail('找不到要操作的成員。');
      for (const p of next.people) for (const r of p.relationships) if (p.id === person.id || r.personId === person.id) { affected.add(p.id); affected.add(r.personId); }
      if (command.type === 'archiveMember') {
        label = `封存成員「${person.name}」`;
        if (person.archive) unchanged = true;
        else {
          if (command.reason !== undefined && (typeof command.reason !== 'string' || command.reason.length > 2000)) fail('封存原因最多 2000 字。');
          const time = command.now ?? new Date().toISOString(); if (!validTime(time)) fail('封存時間格式不正確。');
          person.archive = { archivedAt:time,...(command.reason?.trim() ? { reason:command.reason.trim() } : {}) };
        }
      } else if (command.type === 'unarchiveMember') {
        label = `解除封存「${person.name}」`; unchanged = !person.archive; delete person.archive;
      } else if (command.type === 'deleteMember') {
        label = `移至回收區「${person.name}」`;
        if (next.recycleBin?.some(e => e.id === person.id)) fail('回收區已有相同 ID，請先處理該回收紀錄。');
        const time = command.now ?? new Date().toISOString(); if (!validTime(time)) fail('刪除時間格式不正確。');
        const incomingRelationships = next.people.filter(p => p.id !== person.id).flatMap(p => p.relationships.filter(r => r.personId === person.id).map(relation => ({ ownerId:p.id,relation:clone(relation) })));
        const groupReferences = (next.rankGroups || []).filter(g => g.anchorId === person.id || g.members.some(m => m.personId === person.id))
          .map(g => ({ groupId:g.id,type:g.type,wasAnchor:g.anchorId === person.id,...(g.members.find(m => m.personId === person.id) ? { member:clone(g.members.find(m => m.personId === person.id)) } : {}) }));
        const ignoredPlans = (next.ignoredIntermediatePlans || []).filter(key => key.split('|').includes(person.id));
        const snapshot = clone(person); delete snapshot.inferredRelationships;
        next.recycleBin = [...(next.recycleBin || []),{ id:person.id,deletedAt:time,person:snapshot,incomingRelationships,groupReferences,ignoredPlans }];
        next.people = next.people.filter(p => p.id !== person.id).map(p => ({ ...p,relationships:p.relationships.filter(r => r.personId !== person.id) }));
        for (const group of next.rankGroups || []) {
          if (group.anchorId === person.id) delete group.anchorId;
          if (group.members.some(m => m.personId === person.id)) group.members.forEach(m => affected.add(m.personId));
          group.members = group.members.filter(m => m.personId !== person.id);
        }
        if (next.ignoredIntermediatePlans) next.ignoredIntermediatePlans = next.ignoredIntermediatePlans.filter(key => !ignoredPlans.includes(key));
      } else fail('不支援的成員生命週期操作。');
    }
    let completed = next;
    try { completed = Model.completeKinship(next); }
    catch (error) { conflicts.push({ kind:'validation',key:'domain',message:error.message }); }
    if (!conflicts.length) {
      const nextGraph = Model.build(completed);
      for (const person of completed.people) {
        const before = originalGraph.inferredRelations.filter(r => r.from === person.id);
        const after = nextGraph.inferredRelations.filter(r => r.from === person.id);
        if (!Evidence.same(before,after)) affected.add(person.id);
      }
    }
    return { data:completed,canApply:!conflicts.length,conflicts,affectedPersonIds:[...affected],label,unchanged };
  }
  function apply(data,command,Model) {
    const result = preview(data,command,Model);
    if (!result.canApply) fail(result.conflicts.map(c => c.message).join('；'));
    return { data:result.unchanged ? data : result.data,label:result.label,memberId:command.id,unchanged:result.unchanged };
  }
  return { validate,preview,apply,isArchived:person => Boolean(person?.archive) };
});
