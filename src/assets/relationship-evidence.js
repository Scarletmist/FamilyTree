/* Relationship provenance and optional source records. Legacy status is opaque data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RelationshipEvidence = api;
})(globalThis, function () {
  'use strict';
  const inverse = { parent:'child', child:'parent', grandparent:'grandchild', grandchild:'grandparent', spouse:'spouse', sibling:'sibling', swornSibling:'swornSibling', fellowDisciple:'fellowDisciple', tangCousin:'tangCousin', biaoCousin:'biaoCousin', teacher:'student', student:'teacher', uncleAunt:'nephewNiece', nephewNiece:'uncleAunt' };
  const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}' : JSON.stringify(value);
  const same = (a,b) => stable(a) === stable(b);
  function canonical(from, relation) {
    const to = relation.to ?? relation.personId;
    const reversed = from > to;
    const normalized = { ...relation, type: reversed ? inverse[relation.type] || relation.type : relation.type };
    for (const k of ['from','to','personId','path','recorded']) delete normalized[k];
    if (reversed && normalized.seniority) normalized.seniority = ({ older:'younger', younger:'older' })[normalized.seniority] || normalized.seniority;
    if (normalized.seniority === 'unknown') delete normalized.seniority;
    const a = reversed ? to : from, b = reversed ? from : to;
    return { key:JSON.stringify([a,b,normalized.type,normalized.kind || '']), from:a, to:b, relation:normalized };
  }
  function records(data) {
    const result = new Map();
    for (const p of data.people || []) for (const r of p.relationships || []) {
      const edge = canonical(p.id, r), existing = result.get(edge.key);
      if (!existing) { result.set(edge.key, { ...edge, records:[{ ownerId:p.id, relation:r }] }); continue; }
      existing.records.push({ ownerId:p.id, relation:r });
      for (const [key,value] of Object.entries(edge.relation)) {
        if (existing.relation[key] === undefined) existing.relation[key] = value;
        else if (!same(existing.relation[key],value)) {
          const values = existing.relation[key]?.conflictingValues || [existing.relation[key]];
          existing.relation[key] = { conflictingValues:[...values.filter(v => !same(v,value)),value].sort((a,b) => stable(a).localeCompare(stable(b))) };
        }
      }
    }
    return result;
  }
  function describe(data, from, relation, index = records(data)) {
    const direct = relation.type && index.get(canonical(from,relation).key);
    const derived = !direct;
    const steps = relation.path || (relation.rankGroup ? [{ ...relation, from, to:relation.to ?? relation.personId }] : []);
    const premises = derived ? steps.map(step => {
      const entry = index.get(canonical(step.from,step).key);
      const group = step.rankGroup && (data.rankGroups || []).find(group => group.id === step.groupId && group.type === step.type
        && group.members.some(member => member.personId === step.from) && group.members.some(member => member.personId === (step.to ?? step.personId)));
      return { key:canonical(step.from,step).key, from:step.from, to:step.to ?? step.personId,
        type:step.type, ...(step.kind ? {kind:step.kind} : {}), records:entry?.records || [],
        ...(group ? { rankGroup: { id:group.id, name:group.name, type:group.type,
          fromOrder:group.members.find(member => member.personId === step.from).order,
          toOrder:group.members.find(member => member.personId === (step.to ?? step.personId)).order } } : {}) };
    }) : [];
    return { origin:derived ? 'inferred' : 'direct', originLabel:derived ? '推導' : '直接記錄',
      premises, records:direct?.records || premises.flatMap(p => p.records) };
  }
  const types = { parent:'父母', child:'子女', grandparent:'祖父母', grandchild:'孫子女', spouse:'配偶', sibling:'手足', swornSibling:'契手足', fellowDisciple:'師兄弟姊妹', tangCousin:'堂親', biaoCousin:'表親', teacher:'師父', student:'徒弟', uncleAunt:'叔伯姑姨舅', nephewNiece:'姪甥子女' };
  const text = proof => proof.originLabel;
  // One index per render/query, shared by every segment and reverse record.
  function create(data) {
    const index = records(data);
    const explain = (from,relation) => describe(data,from,relation,index);
    const adjacency = new Map();
    for (const edge of index.values()) for (const id of [edge.from,edge.to]) {
      if (!adjacency.has(id)) adjacency.set(id,[]);
      adjacency.get(id).push({ ...edge.relation,type:edge.from === id ? edge.relation.type : inverse[edge.relation.type],personId:edge.from === id ? edge.to : edge.from,
        ...(edge.from !== id && ['older','younger'].includes(edge.relation.seniority) ? {seniority:edge.relation.seniority === 'older' ? 'younger' : 'older'} : {}) });
    }
    const directed = id => adjacency.get(id) || [];
    function between(from,to,allowed = Object.keys(types)) {
      const result = [], seen = new Set();
      function add(relation) {
        if (!allowed.includes(relation.type)) return;
        const key = canonical(from,relation).key;
        // Different proof paths remain inspectable instead of inheriting a group status.
        const signature = key + ':' + stable(relation.path || []);
        if (seen.has(signature)) return;
        seen.add(signature); result.push({ from,relation,evidence:explain(from,relation) });
      }
      directed(from).filter(r => r.personId === to).forEach(add);
      const directTypes = new Set(result.map(item => item.relation.type));
      for (const group of data.rankGroups || []) {
        if (from === to || directTypes.has(group.type) || !allowed.includes(group.type)
          || !group.members.some(member => member.personId === from) || !group.members.some(member => member.personId === to)) continue;
        add({ type:group.type, personId:to, groupId:group.id, rankGroup:true,
          path:[{ from, to, type:group.type, groupId:group.id, rankGroup:true }] });
      }
      for (const r of data.inferredRelations || []) if (r.from === from && r.personId === to && !index.has(canonical(from,r).key)) add(r);
      for (const [type,premise,reverse] of [['sibling','parent','child'],['fellowDisciple','teacher','student']]) {
        if (!allowed.includes(type) || result.some(item => item.relation.type === type && !item.relation.rankGroup)) continue;
        const eligible = r => r.type === premise && (type !== 'sibling' || ['親生','過繼','養子女'].includes(r.kind));
        const left = directed(from).filter(eligible), right = directed(to).filter(eligible);
        for (const a of left) for (const b of right.filter(r => r.personId === a.personId)) add({ type,personId:to,path:[
          { from,to:a.personId,type:premise,...(a.kind ? {kind:a.kind} : {}) },
          { from:a.personId,to,type:reverse,...(b.kind ? {kind:b.kind} : {}) }
        ] });
      }
      return result;
    }
    return { describe:explain,between, path:edges => edges.length === 1 ? explain(edges[0].from,edges[0]) : explain(edges[0]?.from,{ path:edges }) };
  }
  return { inverse, stable, same, canonical, records, describe, create, types, text };
});
