/* Shared by the browser and local server. JSON member relationships are the only source of truth. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.FamilyModel = model;
})(globalThis, function () {
  'use strict';
  const DEFAULT_FAMILY_NAME = '陳氏家族';
  function normalizeFamilyName(value) {
    if (value === undefined) return DEFAULT_FAMILY_NAME;
    if (typeof value !== 'string') fail('家族名稱格式不正確。');
    const name = value.trim();
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) fail('家族名稱須為 1 至 80 個字元，且不能包含控制字元。');
    return name;
  }
  const KINDS = ['親生', '過繼', '養子女', '義子女', '契子女'];
  const TYPES = ['parent', 'child', 'grandparent', 'grandchild', 'spouse', 'sibling', 'swornSibling', 'teacher', 'student'];
  const isDescent = type => ['parent', 'child', 'grandparent', 'grandchild'].includes(type);
  const CHILD_KINDS = ['親生', '過繼', '養子女'];
  const knownOrder = p => Number.isInteger(p.siblingOrder) && p.siblingOrder > 0;
  const orderKey = p => knownOrder(p) ? p.siblingOrder : Infinity;
  const compareOrder = (a, b) => knownOrder(a) && knownOrder(b) ? a.siblingOrder - b.siblingOrder : 0;
  const INVERSE = { parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent', spouse: 'spouse', sibling: 'sibling', swornSibling: 'swornSibling', teacher: 'student', student: 'teacher' };
  // Editing shows all direct relations, even when the source record lives on the other person.
  function relationshipsFor(data, id) {
    const result = new Map();
    for (const person of data.people) for (const r of person.relationships) {
      let relation;
      if (person.id === id) relation = { type: r.type, personId: r.personId };
      else if (r.personId === id) relation = { type: INVERSE[r.type], personId: person.id };
      else continue;
      if (isDescent(relation.type)) relation.kind = r.kind;
      result.set([relation.type, relation.personId, relation.kind || ''].join('|'), relation);
    }
    return [...result.values()];
  }
  function replaceMember(data, member) {
    if (!data.people.some(p => p.id === member.id)) fail('找不到要修改的成員。');
    // Move all relations for the edited person to this record. Removed inverse edges must
    // disappear too; relations between everyone else are preserved exactly.
    const next = { ...data, people: data.people.map(p => p.id === member.id ? { ...p, ...member } : {
      ...p, relationships: p.relationships.filter(r => r.personId !== member.id)
    }) };
    build(next);
    return next;
  }
  function fail(message) { throw new Error(message); }
  function validateMember(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('成員格式不正確。');
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)) fail('成員 ID 不正確。');
    for (const [key, label, max] of [['name', '姓名', 80], ['location', '所在地', 120], ['position', '職位', 120]]) {
      if (typeof p[key] !== 'string' || p[key].length > max || (key === 'name' && !p[key].trim())) fail(`${label}格式不正確或過長。`);
    }
    if (!['M', 'F', 'U'].includes(p.gender)) fail('性別格式不正確。');
    if (p.siblingOrder !== null && (!knownOrder(p) || p.siblingOrder > 999)) fail('手足次序須為 1 至 999 的整數，未知請留空。');
    if (!Array.isArray(p.relationships) || p.relationships.length > 100) fail('關係須為陣列，最多 100 筆。');
    const seen = new Set();
    for (const r of p.relationships) {
      if (!r || !TYPES.includes(r.type) || typeof r.personId !== 'string') fail('關係類型或對象不正確。');
      if (r.personId === p.id) fail('不能與自己建立關係。');
      if (isDescent(r.type) && !KINDS.includes(r.kind)) fail('請選擇親子／祖孫關係類型。');
      const key = [r.type, r.personId, r.kind || ''].join('|');
      if (seen.has(key)) fail('同一關係重複填寫。');
      seen.add(key);
    }
  }
  function build(data) {
    if (!data || data.schemaVersion !== 2 || !Array.isArray(data.people)) fail('族譜 JSON 格式不正確。');
    const familyName = normalizeFamilyName(data.familyName);
    const people = data.people.map(p => ({ ...p }));
    const byId = new Map();
    for (const p of people) {
      validateMember(p);
      if (byId.has(p.id)) fail('成員 ID 重複。');
      byId.set(p.id, p);
    }
    const parents = new Map(), spouses = new Map(), siblings = new Map(), sworn = new Map(), mentors = new Map();
    const pair = (a, b) => [a, b].sort();
    for (const p of people) for (const r of p.relationships) {
      if (!byId.has(r.personId)) fail('關係對象不存在，請重新選擇。');
      const q = r.personId;
      if (isDescent(r.type)) {
        const upwards = ['parent', 'grandparent'].includes(r.type);
        const parent = upwards ? q : p.id, child = upwards ? p.id : q;
        const generations = r.type.startsWith('grand') ? 2 : 1;
        parents.set([parent, child, r.kind, generations].join('|'), { parent, child, kind: r.kind, generations });
      } else if (r.type === 'teacher' || r.type === 'student') {
        const teacher = r.type === 'teacher' ? q : p.id, student = r.type === 'teacher' ? p.id : q;
        mentors.set([teacher, student].join('|'), { teacher, student });
      } else {
        const members = pair(p.id, q), map = r.type === 'spouse' ? spouses : r.type === 'sibling' ? siblings : sworn;
        map.set(members.join('|'), members);
      }
    }
    const edges = [...parents.values()];
    // Derive display levels from parent/child (+1), grandparent/grandchild (+2) and peers (0).
    // Mentorship does not imply a family generation.
    const adjacency = new Map(people.map(p => [p.id, []]));
    function link(a, b, offset) { adjacency.get(a).push([b, offset]); adjacency.get(b).push([a, -offset]); }
    edges.forEach(e => link(e.parent, e.child, e.generations));
    [...spouses.values(), ...siblings.values(), ...sworn.values()].forEach(([a, b]) => link(a, b, 0));
    const levels = new Map();
    for (const p of people) {
      if (levels.has(p.id)) continue;
      const component = [p.id];
      levels.set(p.id, 0);
      for (let i = 0; i < component.length; i++) {
        const id = component[i];
        for (const [next, offset] of adjacency.get(id)) {
          const value = levels.get(id) + offset;
          if (levels.has(next)) {
            if (levels.get(next) !== value) fail('關係階層互相矛盾：請檢查父母、子女、祖父母、孫子女或手足的方向與代差。');
          } else { levels.set(next, value); component.push(next); }
        }
      }
      const min = Math.min(...component.map(id => levels.get(id)));
      component.forEach(id => { byId.get(id).gen = levels.get(id) - min + 1; });
    }
    // An otherwise unconnected mentor/student is displayed alongside their known contact.
    for (let i = 0; i < people.length; i++) {
      let changed = false;
      for (const m of mentors.values()) {
        for (const [a, b] of [[m.teacher, m.student], [m.student, m.teacher]]) {
          if (!adjacency.get(a).length && byId.get(a).gen < byId.get(b).gen) { byId.get(a).gen = byId.get(b).gen; changed = true; }
        }
      }
      if (!changed) break;
    }
    const groups = new Map();
    function family(ids) {
      const partners = ids.slice().sort(), key = partners.join('|');
      if (!groups.has(key)) groups.set(key, { id: `u${groups.size + 1}`, partners, married: spouses.has(key) });
      return groups.get(key);
    }
    spouses.forEach(ids => family(ids));
    const descents = [];
    for (const child of people) {
      for (const kind of KINDS) for (const generations of [1, 2]) {
        const ids = edges.filter(e => e.child === child.id && e.kind === kind && e.generations === generations).map(e => e.parent);
        if (!ids.length) continue;
        if (ids.length > (generations === 2 ? 4 : 2)) fail(`${child.name}同一關係類型最多${generations === 2 ? '四位祖父母' : '兩位父母'}。`);
        descents.push({ union: family(ids).id, child: child.id, kind, ...(generations === 2 ? { generations } : {}) });
      }
    }
    for (const group of groups.values()) {
      const orders = new Set();
      const seenChildren = new Set();
      for (const d of descents.filter(d => d.union === group.id && d.generations !== 2 && CHILD_KINDS.includes(d.kind))) {
        if (seenChildren.has(d.child)) continue;
        seenChildren.add(d.child);
        const child = byId.get(d.child);
        if (!knownOrder(child)) continue;
        if (orders.has(child.siblingOrder)) fail('同一組父母下的手足次序重複，請填入其他數字或留空。');
        orders.add(child.siblingOrder);
      }
    }
    for (const [a, b] of siblings.values()) {
      if (knownOrder(byId.get(a)) && knownOrder(byId.get(b)) && compareOrder(byId.get(a), byId.get(b)) === 0) fail('手足次序重複，請填入其他數字或留空。');
    }
    return { familyName, people, unions: [...groups.values()], descents,
      bonds: [...sworn.values()].map(members => ({ members, kind: '契手足' })).concat([...siblings.values()].map(members => ({ members, kind: '手足' }))),
      mentorships: [...mentors.values()] };
  }
  return { DEFAULT_FAMILY_NAME, normalizeFamilyName, build, validateMember, relationshipsFor, replaceMember, KINDS, TYPES, isDescent, knownOrder, orderKey, compareOrder };
});
