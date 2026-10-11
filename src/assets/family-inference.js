/* Rebuildable biological kinship records. Inferred records are never premises. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyInference = api;
})(globalThis, function () {
  'use strict';
  const inverse = { parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent',
    sibling: 'sibling', tangCousin: 'tangCousin', biaoCousin: 'biaoCousin', uncleAunt: 'nephewNiece', nephewNiece: 'uncleAunt' };
  const flip = edge => ({ ...edge, from: edge.to, to: edge.from, type: inverse[edge.type],
    ...(edge.seniority ? { seniority: edge.seniority === 'older' ? 'younger' : edge.seniority === 'younger' ? 'older' : 'unknown' } : {}) });
  const reverse = path => path.slice().reverse().map(flip);
  const pairKey = (a, b) => [a, b].sort().join('|');
  const edgeKey = edge => [edge.from, edge.to, edge.type, edge.kind || ''].join('|');
  const pathKey = path => path.map(edgeKey).join(';');
  const lineageOf = person => person.gender === 'M' ? 'paternal' : person.gender === 'F' ? 'maternal' : 'unknown';

  function derive(data, siblingOrder = () => 0) {
    const people = new Map(data.people.map(person => [person.id, person]));
    const parents = new Map(data.people.map(person => [person.id, new Map()]));
    const children = new Map(data.people.map(person => [person.id, new Map()]));
    const siblingLinks = new Map(data.people.map(person => [person.id, new Map()]));
    const directSiblings = new Set(), seeds = [], grandparents = [], recorded = new Set();
    const relations = new Map(), lineages = new Map(), classifiedProof = new Map();
    const premiseKey = edge => edge.from < edge.to ? edgeKey(edge) : edgeKey(flip(edge));
    const pending = new Set();
    for (const person of data.people) for (const relation of person.relationships) if (relation.status === 'pending' && inverse[relation.type]) {
      pending.add(premiseKey({ from: person.id, to: relation.personId, type: relation.type, kind: relation.kind }));
    }
    function addSibling(a, b, path) {
      if (a === b) return;
      for (const [from, to, evidence] of [[a, b, path], [b, a, reverse(path)]]) {
        const previous = siblingLinks.get(from).get(to);
        if (!previous || evidence.length < previous.length || evidence.length === previous.length && pathKey(evidence) < pathKey(previous)) siblingLinks.get(from).set(to, evidence);
      }
    }
    for (const person of data.people) for (const relation of person.relationships) {
      if (!inverse[relation.type]) continue;
      const edge = { from: person.id, to: relation.personId, type: relation.type };
      for (const key of ['kind', 'seniority', 'groupId']) if (relation[key] !== undefined) edge[key] = relation[key];
      recorded.add(edgeKey(edge));
      recorded.add(edgeKey(flip(edge)));
      if (relation.status === 'pending' || pending.has(premiseKey(edge))) continue;
      if (['parent', 'child'].includes(edge.type) && edge.kind === '親生') {
        const upwards = edge.type === 'parent' ? edge : flip(edge);
        parents.get(upwards.from).set(upwards.to, upwards);
        children.get(upwards.to).set(upwards.from, flip(upwards));
      } else if (edge.type === 'sibling') {
        directSiblings.add(pairKey(edge.from, edge.to));
        addSibling(edge.from, edge.to, [edge]);
      } else if (['tangCousin', 'biaoCousin'].includes(edge.type)) seeds.push({ a: edge.from, b: edge.to, type: edge.type, path: [edge] });
      else if (['grandparent', 'grandchild'].includes(edge.type) && edge.kind === '親生') {
        const upwards = edge.type === 'grandparent' ? edge : flip(edge);
        grandparents.push({ ...upwards, path: [upwards], lineage: 'unknown' });
      }
    }
    // A direct cousin record can identify the parents' sibling relationship,
    // but only when exactly one recorded biological parent pair fits its branch.
    for (const seed of seeds) {
      // A biao record does not identify which parents are related. Missing
      // parents are not evidence that the recorded parent is the correct branch.
      if (seed.type !== 'tangCousin') continue;
      const candidates = [];
      for (const a of parents.get(seed.a).keys()) for (const b of parents.get(seed.b).keys()) {
        if (a === b) continue;
        const ga = people.get(a).gender, gb = people.get(b).gender;
        if (seed.type === 'tangCousin' ? ga !== 'F' && gb !== 'F' : ga !== 'M' || gb !== 'M') candidates.push([a, b]);
      }
      if (candidates.length !== 1) continue;
      const [a, b] = candidates[0], ga = people.get(a).gender, gb = people.get(b).gender;
      if (seed.type === 'tangCousin' ? ga !== 'M' || gb !== 'M' : ga !== 'F' && gb !== 'F') continue;
      addSibling(a, b, [flip(parents.get(seed.a).get(a)), ...seed.path, parents.get(seed.b).get(b)]);
    }
    for (const family of children.values()) {
      const ids = [...family.keys()].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        addSibling(ids[i], ids[j], [flip(family.get(ids[i])), family.get(ids[j])]);
      }
    }
    function fullSibling(a, b) {
      const pa = [...parents.get(a).keys()], pb = [...parents.get(b).keys()];
      if (pa.length === 2 && pb.length === 2) return pa.every(id => pb.includes(id));
      for (const gender of ['M', 'F']) {
        const left = pa.filter(id => people.get(id).gender === gender), right = pb.filter(id => people.get(id).gender === gender);
        if (left.length && right.length && !left.some(id => right.includes(id))) return false;
      }
      return directSiblings.has(pairKey(a, b));
    }
    function siblingPaths(start, type, branchParent) {
      const paths = new Map([[start, []]]), queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const from = queue[i];
        for (const [to, evidence] of [...siblingLinks.get(from)].sort(([a], [b]) => a.localeCompare(b))) {
          if (paths.has(to)) continue;
          const sharedParent = [...parents.get(from).keys()].find(id => parents.get(to).has(id)
            && (branchParent ? id === branchParent : type === 'tangCousin' && people.get(id).gender === 'M'));
          if (!fullSibling(from, to) && !sharedParent) continue;
          paths.set(to, [...paths.get(from), ...evidence]);
          queue.push(to);
        }
      }
      return paths;
    }
    function add(from, to, type, path, extra = {}) {
      // A proof may revisit its own endpoint while expanding a cousin's parent.
      // Remove that loop so the retained evidence is a real, simple graph path.
      const simple = [], nodes = [from];
      for (const edge of path) {
        const repeated = nodes.indexOf(edge.to);
        if (repeated >= 0) { simple.length = repeated; nodes.length = repeated + 1; }
        else { simple.push(edge); nodes.push(edge.to); }
      }
      path = simple;
      if (from === to || !path.length) return;
      const key = [from, to, type, extra.kind || ''].join('|');
      const previous = relations.get(key);
      const value = { from, personId: to, type, ...extra, path };
      const classified = ['paternal', 'maternal'].includes(extra.lineage);
      if (extra.lineage) {
        const branches = lineages.get(key) || new Set();
        if (classified) branches.add(extra.lineage);
        lineages.set(key, branches);
        value.lineage = branches.size === 1 ? [...branches][0] : 'unknown';
      }
      if (!previous || classified && !classifiedProof.get(key)
        || classified === Boolean(classifiedProof.get(key)) && (path.length < previous.path.length || path.length === previous.path.length && pathKey(path) < pathKey(previous.path))) {
        relations.set(key, value);
        classifiedProof.set(key, classified);
      } else if (value.lineage) previous.lineage = value.lineage;
    }
    function both(from, to, type, path, extra = {}) {
      add(from, to, type, path, extra);
      // Uncle seniority compares the uncle with the parent, never with the child.
      const inverseExtra = { ...extra };
      if (type === 'uncleAunt') delete inverseExtra.seniority;
      add(to, from, inverse[type], reverse(path), inverseExtra);
    }
    for (const [child, family] of parents) for (const [parent, childParent] of family) {
      const lineage = lineageOf(people.get(parent));
      for (const [grandparent, parentGrandparent] of parents.get(parent)) {
        both(child, grandparent, 'grandparent', [childParent, parentGrandparent], { kind: '親生', lineage });
        grandparents.push({ from: child, to: grandparent, path: [childParent, parentGrandparent], lineage });
      }
      for (const [relative, proof] of siblingLinks.get(parent)) {
        if (family.has(relative)) continue;
        const order = siblingOrder(parent, relative);
        both(child, relative, 'uncleAunt', [childParent, ...proof], { lineage,
          ...(order ? { seniority: order < 0 ? 'older' : 'younger' } : {}) });
      }
    }
    // Direct grandparents also apply to full siblings even when their middle parent is missing.
    for (const edge of grandparents) for (const [sibling, proof] of siblingPaths(edge.from, 'grandparent')) {
      if (sibling !== edge.from) both(sibling, edge.to, 'grandparent', [...reverse(proof), ...edge.path], { kind: '親生', lineage: edge.lineage });
    }
    for (const relation of [...relations.values()].filter(r => r.type === 'uncleAunt')) {
      for (const [sibling, proof] of siblingPaths(relation.from, 'uncleAunt')) if (sibling !== relation.from) {
        both(sibling, relation.personId, 'uncleAunt', [...reverse(proof), ...relation.path], { lineage: relation.lineage,
          ...(relation.seniority ? { seniority: relation.seniority } : {}) });
      }
    }
    for (const [parentA, siblings] of siblingLinks) for (const [parentB, proof] of siblings) {
      if (parentA >= parentB) continue;
      const ga = people.get(parentA).gender, gb = people.get(parentB).gender;
      const type = ga === 'M' && gb === 'M' ? 'tangCousin' : ga === 'F' || gb === 'F' ? 'biaoCousin' : null;
      if (!type) continue;
      for (const [a, childA] of children.get(parentA)) for (const [b, childB] of children.get(parentB)) {
        seeds.push({ a, b, type, parentA, parentB, path: [flip(childA), ...proof, childB] });
      }
    }
    for (const seed of seeds) {
      const left = siblingPaths(seed.a, seed.type, seed.parentA), right = siblingPaths(seed.b, seed.type, seed.parentB);
      for (const [a, before] of left) for (const [b, after] of right) {
        if (siblingLinks.get(a).has(b)) continue;
        both(a, b, seed.type, [...reverse(before), ...seed.path, ...after]);
      }
    }
    return [...relations.values()].map(relation => ({ ...relation, recorded: recorded.has([relation.from, relation.personId, relation.type, relation.kind || ''].join('|')) }))
      .sort((a, b) => [a.from, a.type, a.personId, a.kind || ''].join('|').localeCompare([b.from, b.type, b.personId, b.kind || ''].join('|')));
  }

  function normalize(data, inferred) {
    const byId = new Map(data.people.map(person => [person.id, []]));
    for (const { from, recorded, ...relation } of inferred) if (!recorded) byId.get(from).push(relation);
    let changed = false;
    const people = data.people.map(person => {
      const expected = byId.get(person.id), current = person.inferredRelationships;
      if ((!expected.length && current === undefined) || JSON.stringify(expected) === JSON.stringify(current)) return person;
      changed = true;
      const next = { ...person };
      if (expected.length) next.inferredRelationships = expected;
      else delete next.inferredRelationships;
      return next;
    });
    return changed ? { ...data, people } : data;
  }

  function role(relation, target) {
    const gender = target.gender, outer = relation.lineage === 'maternal';
    if (relation.type === 'grandparent') return (relation.lineage === 'unknown' ? ({ M: '祖父／外祖父', F: '祖母／外祖母', U: '祖父母／外祖父母' })[gender]
      : (outer ? '外' : '') + ({ M: '祖父', F: '祖母', U: '祖父母' })[gender]);
    if (relation.type === 'grandchild') return relation.lineage === 'unknown' ? ({ M: '孫子／外孫', F: '孫女／外孫女', U: '孫子女／外孫子女' })[gender]
      : (outer ? '外' : '') + ({ M: outer ? '孫' : '孫子', F: '孫女', U: '孫子女' })[gender];
    if (relation.type === 'uncleAunt') {
      if (relation.lineage === 'unknown') return ({ M: '叔伯／舅', F: '姑／姨', U: '叔伯姑姨舅' })[gender];
      if (outer) return ({ M: '舅舅', F: '阿姨', U: '舅舅／阿姨' })[gender];
      return gender === 'F' ? '姑姑' : gender === 'U' ? '叔伯／姑姑' : relation.seniority === 'older' ? '伯父' : relation.seniority === 'younger' ? '叔父' : '叔父／伯父';
    }
    if (relation.type === 'nephewNiece') return relation.lineage === 'unknown' ? ({ M: '姪子／外甥', F: '姪女／外甥女', U: '姪甥子女' })[gender]
      : ({ M: outer ? '外甥' : '姪子', F: outer ? '外甥女' : '姪女', U: outer ? '甥子女' : '姪子女' })[gender];
    const prefix = relation.type === 'tangCousin' ? '堂' : '表';
    return prefix + ({ M: '兄弟', F: '姊妹', U: '兄弟姊妹' })[gender];
  }
  return { derive, normalize, role };
});
