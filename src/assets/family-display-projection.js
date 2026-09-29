/* Display-only generation placement. Domain validation and relationship truth stay in FamilyModel. */
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./family-model.js') : root.FamilyModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyDisplayProjection = api;
})(globalThis, function (Model) {
  'use strict';

  const COUSIN_KINDS = new Set(['堂親', '表親']);
  const FAMILY_PEER_KINDS = new Set(['手足', '契手足', '堂親', '表親']);

  function project(domainGraph) {
    if (!domainGraph || !Array.isArray(domainGraph.people)) throw new Error('族譜顯示資料格式不正確。');

    const people = domainGraph.people.map(person => ({ ...person }));
    const graph = { ...domainGraph, people };
    const byId = new Map(people.map(person => [person.id, person]));
    const adjacency = new Map(people.map(person => [person.id, []]));
    const link = (a, b, offset) => {
      if (!adjacency.has(a) || !adjacency.has(b)) return;
      adjacency.get(a).push([b, offset]);
      adjacency.get(b).push([a, -offset]);
    };

    const unions = new Map((graph.unions || []).map(union => [union.id, union]));
    for (const descent of graph.descents || []) {
      const union = unions.get(descent.union);
      for (const parent of union?.partners || []) link(parent, descent.child, descent.generations || 1);
    }
    for (const union of graph.unions || []) {
      if (!union.married || union.partners.length < 2) continue;
      for (let i = 1; i < union.partners.length; i++) link(union.partners[0], union.partners[i], 0);
    }
    for (const bond of graph.bonds || []) {
      if (!FAMILY_PEER_KINDS.has(bond.kind) || bond.members.length < 2) continue;
      link(bond.members[0], bond.members[1], 0);
    }

    const levels = new Map();
    const familyComponents = [];
    const componentOf = new Map();
    for (const person of people) {
      if (levels.has(person.id)) continue;
      const component = [person.id];
      levels.set(person.id, 0);
      for (let index = 0; index < component.length; index++) {
        const id = component[index];
        for (const [next, offset] of adjacency.get(id)) {
          const value = levels.get(id) + offset;
          if (levels.has(next)) {
            if (levels.get(next) !== value) {
              throw Model.relationshipError(
                `關係階層互相矛盾：「${byId.get(id).name}」與「${byId.get(next).name}」的父母、子女、祖孫或手足設定和既有路徑不一致，請檢查方向與代差。`,
                [id, next]
              );
            }
          } else {
            levels.set(next, value);
            component.push(next);
          }
        }
      }
      const min = Math.min(...component.map(id => levels.get(id)));
      const generationKnown = component.some(id => levels.get(id) !== min);
      component.forEach(id => {
        byId.get(id).gen = levels.get(id) - min + 1;
        Object.defineProperty(byId.get(id), 'generationKnown', {
          value: generationKnown,
          enumerable: false,
          configurable: true
        });
        componentOf.set(id, familyComponents.length);
      });
      familyComponents.push(component);
    }

    const componentLinks = familyComponents.map(() => []);
    for (const mentorship of graph.mentorships || []) {
      const teacherComponent = componentOf.get(mentorship.teacher);
      const studentComponent = componentOf.get(mentorship.student);
      if (teacherComponent === studentComponent
        || familyComponents[teacherComponent].length < 2
        || familyComponents[studentComponent].length < 2) continue;
      componentLinks[teacherComponent].push({
        next: studentComponent,
        from: mentorship.teacher,
        to: mentorship.student,
        offset: 1
      });
      componentLinks[studentComponent].push({
        next: teacherComponent,
        from: mentorship.student,
        to: mentorship.teacher,
        offset: -1
      });
    }

    const aligned = new Set();
    const componentOrder = familyComponents.map((ids, index) => ({ ids, index }))
      .sort((a, b) => b.ids.length - a.ids.length || [...a.ids].sort()[0].localeCompare([...b.ids].sort()[0]));
    for (const { index } of componentOrder) {
      if (aligned.has(index)) continue;
      const queue = [index];
      aligned.add(index);
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const componentLink of componentLinks[queue[cursor]]) {
          if (aligned.has(componentLink.next)) continue;
          const shift = byId.get(componentLink.from).gen + componentLink.offset - byId.get(componentLink.to).gen;
          familyComponents[componentLink.next].forEach(id => { byId.get(id).gen += shift; });
          aligned.add(componentLink.next);
          queue.push(componentLink.next);
        }
      }
      const ids = queue.flatMap(componentIndex => familyComponents[componentIndex]);
      const shift = Math.max(0, 1 - Math.min(...ids.map(id => byId.get(id).gen)));
      ids.forEach(id => { byId.get(id).gen += shift; });
    }

    const contacts = new Map(people.map(person => [person.id, []]));
    for (const mentorship of graph.mentorships || []) {
      const freeTeacher = !adjacency.get(mentorship.teacher).length;
      if (!freeTeacher && adjacency.get(mentorship.student).length) continue;
      const offset = freeTeacher ? 1 : 0;
      contacts.get(mentorship.teacher).push([mentorship.student, offset]);
      contacts.get(mentorship.student).push([mentorship.teacher, -offset]);
    }

    const placed = new Set(people.filter(person => adjacency.get(person.id).length).map(person => person.id));
    const queue = [...placed].sort((a, b) => byId.get(a).gen - byId.get(b).gen || a.localeCompare(b));
    function placeContacts() {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const [next, offset] of contacts.get(queue[cursor])) {
          if (placed.has(next)) continue;
          byId.get(next).gen = byId.get(queue[cursor]).gen + offset;
          placed.add(next);
          queue.push(next);
        }
      }
      queue.length = 0;
    }
    placeContacts();
    for (const person of people) {
      if (placed.has(person.id)) continue;
      placed.add(person.id);
      queue.push(person.id);
      placeContacts();
    }

    const visited = new Set();
    for (const person of people) {
      if (visited.has(person.id)) continue;
      const component = [person.id];
      visited.add(person.id);
      for (let index = 0; index < component.length; index++) {
        for (const [next] of [...adjacency.get(component[index]), ...contacts.get(component[index])]) {
          if (visited.has(next)) continue;
          visited.add(next);
          component.push(next);
        }
      }
      const shift = Math.max(0, 1 - Math.min(...component.map(id => byId.get(id).gen)));
      if (shift) component.forEach(id => { byId.get(id).gen += shift; });
    }

    const anchoredPeers = new Set();
    for (const person of people) {
      for (const relation of person.relationships || []) {
        if (relation.type === 'fellowDisciple' || Model.isCousin(relation.type)) continue;
        anchoredPeers.add(person.id);
        anchoredPeers.add(relation.personId);
      }
    }
    const peerLinks = new Map(people.map(person => [person.id, []]));
    for (const bond of graph.bonds || []) {
      if (bond.kind !== '師兄弟姊妹' && !COUSIN_KINDS.has(bond.kind)) continue;
      const [a, b] = bond.members;
      peerLinks.get(a).push(b);
      peerLinks.get(b).push(a);
    }
    const peerPlaced = new Set(anchoredPeers);
    const peerQueue = [...anchoredPeers].sort((a, b) => byId.get(a).gen - byId.get(b).gen || a.localeCompare(b));
    function placePeers() {
      for (let cursor = 0; cursor < peerQueue.length; cursor++) {
        for (const next of peerLinks.get(peerQueue[cursor])) {
          if (peerPlaced.has(next)) continue;
          byId.get(next).gen = byId.get(peerQueue[cursor]).gen;
          peerPlaced.add(next);
          peerQueue.push(next);
        }
      }
      peerQueue.length = 0;
    }
    placePeers();
    for (const person of people) {
      if (peerPlaced.has(person.id)) continue;
      peerPlaced.add(person.id);
      peerQueue.push(person.id);
      placePeers();
    }

    return graph;
  }

  function intermediatePlans(data, { includeIgnored = false, graph = null } = {}) {
    const plans = Model.intermediatePlans(data, { includeIgnored });
    const projected = graph?.people?.every(person => Number.isFinite(person.gen))
      ? graph
      : project(Model.build(data));
    const byId = new Map(projected.people.map(person => [person.id, person]));
    return plans.map(plan => {
      const person = byId.get(plan.near);
      return {
        ...plan,
        generation: Math.max(person?.generationKnown ? 0 : 1, (person?.gen || 1) - 1)
      };
    });
  }

  // Use the full graph even when a query/filter hides an intermediate row.
  // Missing ancestors reserve display rows without renumbering members by view.
  function generationOffset(graph) {
    const plans = intermediatePlans(graph, { graph });
    return Math.max(0, 1 - Math.min(1, ...plans.map(plan => plan.generation)));
  }

  return { project, intermediatePlans, generationOffset };
});
