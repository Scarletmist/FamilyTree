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
  const TYPES = ['parent', 'child', 'grandparent', 'grandchild', 'spouse', 'sibling', 'swornSibling', 'fellowDisciple', 'tangCousin', 'biaoCousin', 'teacher', 'student'];
  const isCousin = type => ['tangCousin', 'biaoCousin'].includes(type);
  function cousinRole(person, type, seniority) {
    const prefix = type === 'tangCousin' ? '堂' : '表';
    return prefix + (seniority === 'older' ? { M: '兄', F: '姊', U: '年長手足' } : seniority === 'younger' ? { M: '弟', F: '妹', U: '年幼手足' } : { M: '兄弟', F: '姊妹', U: '兄弟姊妹' })[person.gender];
  }
  const isDescent = type => ['parent', 'child', 'grandparent', 'grandchild'].includes(type);
  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function sameJsonData(a, b) { return stableJson(a) === stableJson(b); }
  const CHILD_KINDS = ['親生', '過繼', '養子女'];
  const knownOrder = p => Number.isInteger(p.siblingOrder) && p.siblingOrder > 0;
  const orderKey = p => knownOrder(p) ? p.siblingOrder : Infinity;
  const compareOrder = (a, b) => knownOrder(a) && knownOrder(b) ? a.siblingOrder - b.siblingOrder : a.siblingOrder === 1 ? -1 : b.siblingOrder === 1 ? 1 : 0;
  const inverseSeniority = value => value === 'older' ? 'younger' : value === 'younger' ? 'older' : 'unknown';
  const knownDiscipleOrder = p => Number.isInteger(p?.discipleOrder) && p.discipleOrder > 0;
  const compareDiscipleOrder = (a, b) => knownDiscipleOrder(a) && knownDiscipleOrder(b) ? a.discipleOrder - b.discipleOrder : 0;
  function fellowRole(person, base) {
    const order = compareDiscipleOrder(person, base);
    if (order < 0) return { M: '師兄', F: '師姊', U: '年長同門' }[person.gender];
    if (order > 0) return { M: '師弟', F: '師妹', U: '年幼同門' }[person.gender];
    return { M: '師兄弟', F: '師姊妹', U: '師兄弟姊妹' }[person.gender];
  }
  function memberOptionLabels(people) {
    const counts = new Map();
    people.forEach(person => { const name = person.name.trim(); counts.set(name, (counts.get(name) || 0) + 1); });
    return new Map(people.map(person => [person.id, person.name + (counts.get(person.name.trim()) > 1 ? '（' + (person.location.trim() || '所在地未填寫') + '）' : '')]));
  }
  function relationshipMemberIds(people) {
    const ids = new Set();
    for (const person of people || []) for (const relation of person.relationships || []) {
      ids.add(person.id);
      if (relation?.personId) ids.add(relation.personId);
    }
    return ids;
  }
  const INVERSE = { parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent', spouse: 'spouse', sibling: 'sibling', swornSibling: 'swornSibling', fellowDisciple: 'fellowDisciple', tangCousin: 'tangCousin', biaoCousin: 'biaoCousin', teacher: 'student', student: 'teacher' };
  // Editing shows all direct relations, even when the source record lives on the other person.
  function relationshipsFor(data, id) {
    const result = new Map();
    for (const person of data.people) for (const r of person.relationships) {
      let relation;
      if (person.id === id) relation = { type: r.type, personId: r.personId };
      else if (r.personId === id) relation = { type: INVERSE[r.type], personId: person.id };
      else continue;
      if (isDescent(relation.type)) relation.kind = r.kind;
      if ((r.type === 'fellowDisciple' || isCousin(r.type)) && r.seniority && r.seniority !== 'unknown') relation.seniority = person.id === id ? r.seniority : inverseSeniority(r.seniority);
      const key = [relation.type, relation.personId, relation.kind || ''].join('|');
      if (!result.get(key)?.seniority || relation.seniority) result.set(key, relation);
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
  const intermediateKey = (kind, members) => [kind, ...members.slice().sort()].join('|');
  function ignoredIntermediatePlanIds(data) {
    const value = data?.ignoredIntermediatePlans;
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 1000 || value.some(id => typeof id !== 'string' || !id || id.length > 500 || /[\u0000-\u001f\u007f]/u.test(id))) fail('已忽略待補項目格式不正確。');
    return [...new Set(value)];
  }
  function completedCousins(graph) {
    const parents = new Map(graph.people.map(p => [p.id, new Set()]));
    const unions = new Map(graph.unions.map(u => [u.id, u]));
    const people = new Map(graph.people.map(p => [p.id, p]));
    for (const d of graph.descents) if (d.kind === '親生' && d.generations !== 2) unions.get(d.union).partners.forEach(id => parents.get(d.child).add(id));
    const siblings = new Set(graph.bonds.filter(b => b.kind === '手足').map(b => intermediateKey('手足', b.members)));
    const result = new Set();
    for (const b of graph.bonds.filter(b => ['堂親', '表親'].includes(b.kind))) {
      for (const a of parents.get(b.members[0])) for (const c of parents.get(b.members[1])) {
        if (a === c) continue;
        const genders = [people.get(a).gender, people.get(c).gender];
        const matching = b.kind === '堂親' ? genders.every(g => g === 'M') : genders.includes('F');
        if (matching && (siblings.has(intermediateKey('手足', [a, c])) || [...parents.get(a)].some(id => parents.get(c).has(id)))) result.add(intermediateKey(b.kind, b.members));
      }
    }
    return result;
  }
  // Suggestions are derived from biological edges only; placeholders never enter JSON.
  function intermediatePlans(data, { includeIgnored = false } = {}) {
    const ignored = new Set(ignoredIntermediatePlanIds(data));
    const graph = build(data), byId = new Map(graph.people.map(p => [p.id, p]));
    const parents = new Map(graph.people.map(p => [p.id, []]));
    const unions = new Map(graph.unions.map(u => [u.id, u]));
    for (const d of graph.descents) if (d.kind === '親生' && d.generations !== 2) {
      parents.get(d.child).push(...unions.get(d.union).partners);
    }
    const child = id => ({ type: 'child', personId: id, kind: '親生' });
    const plans = [];
    for (const bond of graph.bonds) {
      const [a, b] = bond.members, edgeKey = intermediateKey(bond.kind, bond.members);
      if (['堂親', '表親'].includes(bond.kind)) {
        const eligible = id => parents.get(id).filter(p => bond.kind !== '堂親' || byId.get(p).gender !== 'F');
        for (const [near, other] of [[a, b], [b, a]]) {
          // Existing biological parents are real nodes, not blank slots to duplicate.
          if (eligible(near).length || parents.get(near).length >= 2) continue;
          const candidates = eligible(other);
          plans.push({ id: edgeKey + '|' + near, edgeKey, near, other,
            title: `新增${byId.get(near).name}的親生${bond.kind === '堂親' ? '父親' : '父母'}`,
            gender: bond.kind === '堂親' ? 'M' : 'U',
            relationships: [child(near)],
            choices: candidates.map(id => ({ personId: id, label: byId.get(id).name, relationship: { type: 'sibling', personId: id } })),
            knownOther: candidates.length === 1 ? candidates[0] : null });
        }
      } else if (bond.kind === '手足' && !parents.get(a).some(id => parents.get(b).includes(id)) && parents.get(a).length < 2 && parents.get(b).length < 2) {
        plans.push({ id: edgeKey, edgeKey, near: a, other: b, title: `新增${byId.get(a).name}與${byId.get(b).name}的共同親生父母`, gender: 'U', relationships: [child(a), child(b)], choices: [] });
      }
    }
    for (const d of graph.descents) if (d.kind === '親生' && d.generations === 2) {
      for (const ancestor of unions.get(d.union).partners) {
        const known = parents.get(d.child);
        if (known.some(id => parents.get(id).includes(ancestor)) || known.length >= 2) continue;
        const edgeKey = intermediateKey('親生祖孫', [ancestor, d.child]);
        plans.push({ id: edgeKey, edgeKey, near: d.child, other: ancestor,
          title: `新增${byId.get(ancestor).name}與${byId.get(d.child).name}之間的親生父母`, gender: 'U',
          relationships: [child(d.child), { type: 'parent', personId: ancestor, kind: '親生' }], choices: [] });
      }
    }
    // Separate cousin edges can refer to the same missing father. Share the
    // display slot when their other endpoints are known biological siblings and
    // their suggested relationships agree; retain each edge's own plan identity.
    const siblingPairs = new Set(graph.bonds.filter(b => b.kind === '手足').map(b => intermediateKey('手足', b.members)));
    const siblingsOf = (a, b) => siblingPairs.has(intermediateKey('手足', [a, b])) || parents.get(a).some(id => parents.get(b).includes(id));
    const roots = plans.map((_, i) => i);
    const rootOf = i => { while (roots[i] !== i) i = roots[i]; return i; };
    const signature = plan => JSON.stringify([plan.near, plan.gender, plan.choices.map(c => c.personId).sort()]);
    for (let i = 0; i < plans.length; i++) for (let j = 0; j < i; j++) {
      if (plans[i].edgeKey.startsWith('堂親|') && plans[j].edgeKey.startsWith('堂親|') && signature(plans[i]) === signature(plans[j]) && siblingsOf(plans[i].other, plans[j].other)) roots[rootOf(i)] = rootOf(j);
    }
    const slotIds = new Map();
    plans.forEach((plan, i) => {
      const root = rootOf(i), previous = slotIds.get(root);
      if (!previous || plan.id < previous) slotIds.set(root, plan.id);
    });
    // Only an established family generation may reserve a new ancestor row.
    // An isolated peer relationship still has no evidence for generation zero.
    const result = plans.map((plan, i) => {
      const person = byId.get(plan.near);
      return { ...plan, slotId: slotIds.get(rootOf(i)), generation: Math.max(person.generationKnown ? 0 : 1, person.gen - 1) };
    });
    return includeIgnored ? result : result.filter(plan => !ignored.has(plan.id));
  }
  function fail(message) { throw new Error(message); }
  function validateMember(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) fail('成員格式不正確。');
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)) fail('成員 ID 不正確。');
    for (const [key, label, max] of [['name', '姓名', 80], ['location', '所在地', 120], ['position', '職位', 120]]) {
      if (typeof p[key] !== 'string' || p[key].length > max || (key === 'name' && !p[key].trim())) fail(`${label}格式不正確或過長。`);
    }
    if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 5000)) fail('備註說明須為 5000 字以內的文字。');
    if (!['M', 'F', 'U'].includes(p.gender)) fail('性別格式不正確。');
    if (p.siblingOrder !== null && (!knownOrder(p) || p.siblingOrder > 999)) fail('手足次序須為 1 至 999 的整數，未知請留空。');
    if (p.discipleOrder != null && (!knownDiscipleOrder(p) || p.discipleOrder > 999)) fail('師門次序須為 1 至 999 的整數，未知請留空。');
    if (!Array.isArray(p.relationships) || p.relationships.length > 100) fail('關係須為陣列，最多 100 筆。');
    const seen = new Set();
    for (const r of p.relationships) {
      if (!r || !TYPES.includes(r.type) || typeof r.personId !== 'string') fail('關係類型或對象不正確。');
      if (r.personId === p.id) fail('不能與自己建立關係。');
      if (isDescent(r.type) && !KINDS.includes(r.kind)) fail('請選擇親子／祖孫關係類型。');
      if (r.seniority !== undefined && ((r.type !== 'fellowDisciple' && !isCousin(r.type)) || !['older', 'younger', 'unknown'].includes(r.seniority))) fail('關係長幼設定不正確。');
      const key = [r.type, r.personId, r.kind || ''].join('|');
      if (seen.has(key)) fail('同一關係重複填寫。');
      seen.add(key);
    }
  }
  function build(data) {
    if (!data || data.schemaVersion !== 2 || !Array.isArray(data.people)) fail('族譜 JSON 格式不正確。');
    const familyName = normalizeFamilyName(data.familyName);
    const ignoredIntermediatePlans = ignoredIntermediatePlanIds(data);
    const people = data.people.map(p => ({ ...p }));
    const byId = new Map();
    for (const p of people) {
      validateMember(p);
      if (byId.has(p.id)) fail('成員 ID 重複。');
      byId.set(p.id, p);
    }
    const parents = new Map(), spouses = new Map(), siblings = new Map(), sworn = new Map(), fellows = new Map(), mentors = new Map(), cousins = new Map();
    const pair = (a, b) => [a, b].sort();
    for (const p of people) for (const r of p.relationships) {
      if (!byId.has(r.personId)) fail('關係對象不存在，請重新選擇。');
      const q = r.personId;
      if (isDescent(r.type)) {
        const upwards = ['parent', 'grandparent'].includes(r.type);
        const parent = upwards ? q : p.id, child = upwards ? p.id : q;
        const generations = r.type.startsWith('grand') ? 2 : 1;
        parents.set([parent, child, r.kind, generations].join('|'), { parent, child, kind: r.kind, generations });
      } else if (isCousin(r.type)) {
        const members = pair(p.id, q), key = r.type + '|' + members.join('|');
        const bond = cousins.get(key) || { members, kind: r.type === 'tangCousin' ? '堂親' : '表親' };
        if (['older', 'younger'].includes(r.seniority)) {
          const elderId = r.seniority === 'older' ? q : p.id;
          if (bond.elderId && bond.elderId !== elderId) fail('堂表親的長幼記錄互相矛盾。');
          bond.elderId = elderId;
        }
        cousins.set(key, bond);
      } else if (r.type === 'teacher' || r.type === 'student') {
        const teacher = r.type === 'teacher' ? q : p.id, student = r.type === 'teacher' ? p.id : q;
        mentors.set([teacher, student].join('|'), { teacher, student });
      } else {
        const members = pair(p.id, q), map = r.type === 'spouse' ? spouses : r.type === 'sibling' ? siblings : r.type === 'fellowDisciple' ? fellows : sworn;
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
    // First cousins share a generation, including while one parental branch is incomplete.
    cousins.forEach(({ members: [a, b] }) => link(a, b, 0));
    const levels = new Map();
    const familyComponents = [], componentOf = new Map();
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
      const generationKnown = component.some(id => levels.get(id) !== min);
      component.forEach(id => {
        byId.get(id).gen = levels.get(id) - min + 1;
        Object.defineProperty(byId.get(id), 'generationKnown', { value: generationKnown, enumerable: false, configurable: true });
      });
      component.forEach(id => componentOf.set(id, familyComponents.length));
      familyComponents.push(component);
    }
    // Adding a teacher's relatives must not discard the placement previously
    // supplied by their student. Align whole independent family components;
    // mentorship within one family never overrides its established offsets.
    const componentLinks = familyComponents.map(() => []);
    for (const m of mentors.values()) {
      const t = componentOf.get(m.teacher), s = componentOf.get(m.student);
      if (t === s || familyComponents[t].length < 2 || familyComponents[s].length < 2) continue;
      componentLinks[t].push({ next: s, from: m.teacher, to: m.student, offset: 1 });
      componentLinks[s].push({ next: t, from: m.student, to: m.teacher, offset: -1 });
    }
    const aligned = new Set();
    const componentOrder = familyComponents.map((ids, index) => ({ ids, index }))
      .sort((a, b) => b.ids.length - a.ids.length || [...a.ids].sort()[0].localeCompare([...b.ids].sort()[0]));
    for (const { index } of componentOrder) {
      if (aligned.has(index)) continue;
      const queue = [index]; aligned.add(index);
      for (let i = 0; i < queue.length; i++) for (const link of componentLinks[queue[i]]) {
        if (aligned.has(link.next)) continue;
        const shift = byId.get(link.from).gen + link.offset - byId.get(link.to).gen;
        familyComponents[link.next].forEach(id => { byId.get(id).gen += shift; });
        aligned.add(link.next); queue.push(link.next);
      }
      const ids = queue.flatMap(i => familyComponents[i]);
      const shift = Math.max(0, 1 - Math.min(...ids.map(id => byId.get(id).gen)));
      ids.forEach(id => { byId.get(id).gen += shift; });
    }
    // Mentorship supplies display placement only when a member has no family/peer
    // anchor. An unanchored teacher goes one row above the student. Preserve all
    // established family offsets and never turn mentorship into a parent edge.
    const contacts = new Map(people.map(p => [p.id, []]));
    for (const m of mentors.values()) {
      const freeTeacher = !adjacency.get(m.teacher).length;
      if (!freeTeacher && adjacency.get(m.student).length) continue;
      const offset = freeTeacher ? 1 : 0;
      contacts.get(m.teacher).push([m.student, offset]);
      contacts.get(m.student).push([m.teacher, -offset]);
    }
    const placed = new Set(people.filter(p => adjacency.get(p.id).length).map(p => p.id));
    const queue = [...placed].sort((a, b) => byId.get(a).gen - byId.get(b).gen || a.localeCompare(b));
    function placeContacts() {
      for (let i = 0; i < queue.length; i++) for (const [next, offset] of contacts.get(queue[i])) {
        if (placed.has(next)) continue;
        byId.get(next).gen = byId.get(queue[i]).gen + offset;
        placed.add(next); queue.push(next);
      }
      queue.length = 0;
    }
    placeContacts();
    for (const p of people) if (!placed.has(p.id)) { placed.add(p.id); queue.push(p.id); placeContacts(); }
    // If a student was in generation 1, shift only its connected display group
    // together so the new teacher can occupy generation 1 without a generation 0.
    const visited = new Set();
    for (const p of people) {
      if (visited.has(p.id)) continue;
      const component = [p.id]; visited.add(p.id);
      for (let i = 0; i < component.length; i++) for (const [next] of [...adjacency.get(component[i]), ...contacts.get(component[i])]) {
        if (!visited.has(next)) { visited.add(next); component.push(next); }
      }
      const shift = Math.max(0, 1 - Math.min(...component.map(id => byId.get(id).gen)));
      if (shift) component.forEach(id => { byId.get(id).gen += shift; });
    }
    // Explicit fellow disciples share a display row only when no other relation
    // supplies an anchor. Do not infer their age order from family sibling ranks.
    const anchoredPeers = new Set();
    for (const p of people) for (const r of p.relationships) if (r.type !== 'fellowDisciple' && !isCousin(r.type)) { anchoredPeers.add(p.id); anchoredPeers.add(r.personId); }
    const peerLinks = new Map(people.map(p => [p.id, []]));
    fellows.forEach(([a, b]) => { peerLinks.get(a).push(b); peerLinks.get(b).push(a); });
    cousins.forEach(({ members: [a, b] }) => { peerLinks.get(a).push(b); peerLinks.get(b).push(a); });
    const peerPlaced = new Set(anchoredPeers);
    const peerQueue = [...anchoredPeers].sort((a, b) => byId.get(a).gen - byId.get(b).gen || a.localeCompare(b));
    function placePeers() {
      for (let i = 0; i < peerQueue.length; i++) for (const next of peerLinks.get(peerQueue[i])) if (!peerPlaced.has(next)) {
        byId.get(next).gen = byId.get(peerQueue[i]).gen; peerPlaced.add(next); peerQueue.push(next);
      }
      peerQueue.length = 0;
    }
    placePeers();
    for (const p of people) if (!peerPlaced.has(p.id)) { peerPlaced.add(p.id); peerQueue.push(p.id); placePeers(); }
    // A school is connected by explicit fellowship or a recorded common teacher.
    const schoolLinks = new Map(people.map(p => [p.id, []]));
    fellows.forEach(([a, b]) => { schoolLinks.get(a).push(b); schoolLinks.get(b).push(a); });
    const firstStudent = new Map();
    for (const m of mentors.values()) {
      if (!firstStudent.has(m.teacher)) firstStudent.set(m.teacher, m.student);
      else { const first = firstStudent.get(m.teacher); schoolLinks.get(first).push(m.student); schoolLinks.get(m.student).push(first); }
    }
    const schoolSeen = new Set();
    for (const p of people) {
      if (schoolSeen.has(p.id)) continue;
      const component = [p.id], orders = new Set(); schoolSeen.add(p.id);
      for (let i = 0; i < component.length; i++) {
        const member = byId.get(component[i]);
        if (knownDiscipleOrder(member)) { if (orders.has(member.discipleOrder)) fail('同一師門內的次序重複，請填入其他數字或留空。'); orders.add(member.discipleOrder); }
        for (const next of schoolLinks.get(member.id)) if (!schoolSeen.has(next)) { schoolSeen.add(next); component.push(next); }
      }
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
    return { schemaVersion: 2, familyName, ignoredIntermediatePlans, people, unions: [...groups.values()], descents,
      bonds: [...cousins.values()].concat([...fellows.values()].map(members => ({ members, kind: '師兄弟姊妹' }))).concat([...sworn.values()].map(members => ({ members, kind: '契手足' }))).concat([...siblings.values()].map(members => ({ members, kind: '手足' }))),
      mentorships: [...mentors.values()] };
  }
  // A shared stroke asserts a common source, so require evidence, not merely
  // equal relationship labels. Keep groups as stars with pairwise-compatible leaves.
  function connectorGroups(graph, edges) {
    const parents = id => (graph.descents || []).filter(d => d.child === id && d.kind === '親生' && (d.generations || 1) === 1)
      .flatMap(d => graph.unions.find(u => u.id === d.union)?.partners || []);
    const teachers = id => (graph.mentorships || []).filter(m => m.student === id).map(m => m.teacher);
    const common = (a, b) => a.some(id => b.includes(id));
    const siblings = (a, b) => common(parents(a), parents(b)) || (graph.bonds || []).some(r => r.kind === '手足' && r.members.includes(a) && r.members.includes(b));
    function compatible(root, a, b) {
      const x = a.from === root ? a.to : a.from, y = b.from === root ? b.to : b.from;
      if (a.kind !== b.kind) return false;
      if (a.kind === '師徒') return a.from === root && b.from === root;
      if (a.kind === '堂親') return siblings(x, y);
      if (a.kind === '手足') return common(parents(root), parents(x).filter(p => parents(y).includes(p)));
      if (a.kind === '師兄弟姊妹') return common(teachers(root), teachers(x).filter(t => teachers(y).includes(t)));
      // A biao relationship alone does not identify the paternal/maternal branch.
      // Fully resolved biological cousin paths are already drawn as parent links.
      return false;
    }
    const result = edges.map((_, i) => ({ group: `aux:${i}` })), used = new Set();
    edges.forEach((edge, i) => {
      if (used.has(i)) return;
      let best = [];
      for (const root of [edge.from, edge.to]) {
        const candidates = [i];
        edges.forEach((other, j) => {
          if (j <= i || used.has(j) || ![other.from, other.to].includes(root)) return;
          if (candidates.every(k => compatible(root, edges[k], other))) candidates.push(j);
        });
        if (candidates.length > best.length) best = candidates.map(index => ({ index, root }));
      }
      if (best.length > 1) best.forEach(({ index, root }) => {
        used.add(index); result[index] = { group: `shared:${i}`, root };
      });
    });
    return result;
  }
  return { DEFAULT_FAMILY_NAME, normalizeFamilyName, build, validateMember, relationshipsFor, replaceMember, KINDS, TYPES, isDescent, sameJsonData, knownOrder, orderKey, compareOrder, memberOptionLabels, relationshipMemberIds, inverseSeniority, fellowRole, knownDiscipleOrder, compareDiscipleOrder, isCousin, cousinRole, intermediateKey, ignoredIntermediatePlanIds, intermediatePlans, completedCousins, connectorGroups };
});
