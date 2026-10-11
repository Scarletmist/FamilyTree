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
    const ancestryAnchors = new Set();
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
        if (levels.get(id) > min) ancestryAnchors.add(id);
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

    // Moving a root with no known ancestors must move its relatives and
    // mentors too, preserving the hierarchy already established above.
    const placementLinks = new Map(people.map(person => [person.id, adjacency.get(person.id).map(([id]) => id)]));
    const anchoredPeers = new Set(ancestryAnchors);
    for (const mentorship of graph.mentorships || []) {
      placementLinks.get(mentorship.teacher).push(mentorship.student);
      placementLinks.get(mentorship.student).push(mentorship.teacher);
      anchoredPeers.add(mentorship.teacher);
      anchoredPeers.add(mentorship.student);
    }
    const placementComponents = [], placementComponentOf = new Map();
    const visited = new Set();
    for (const person of people) {
      if (visited.has(person.id)) continue;
      const component = [person.id];
      visited.add(person.id);
      for (let index = 0; index < component.length; index++) {
        for (const next of placementLinks.get(component[index])) {
          if (visited.has(next)) continue;
          visited.add(next);
          component.push(next);
        }
      }
      const shift = Math.max(0, 1 - Math.min(...component.map(id => byId.get(id).gen)));
      if (shift) component.forEach(id => { byId.get(id).gen += shift; });
      component.forEach(id => placementComponentOf.set(id, placementComponents.length));
      placementComponents.push(component);
    }

    const peerLinks = placementComponents.map(() => []);
    const peerSources = new Map();
    const peerRoots = placementComponents.map((_, index) => index);
    function peerRoot(index) {
      while (peerRoots[index] !== index) {
        peerRoots[index] = peerRoots[peerRoots[index]];
        index = peerRoots[index];
      }
      return index;
    }
    const incomingPeers = [];
    for (const bond of graph.bonds || []) {
      if (bond.kind !== '師兄弟姊妹' && !COUSIN_KINDS.has(bond.kind)) continue;
      const [a, b] = bond.members;
      const componentA = placementComponentOf.get(a), componentB = placementComponentOf.get(b);
      if (componentA === componentB) continue;
      const anchorA = anchoredPeers.has(a), anchorB = anchoredPeers.has(b);
      if (!anchorB) peerLinks[componentA].push({ next: componentB, from: a, to: b });
      if (!anchorA) peerLinks[componentB].push({ next: componentA, from: b, to: a });
      if (!anchorA && !anchorB) peerRoots[peerRoot(componentB)] = peerRoot(componentA);
      if (anchorA !== anchorB) {
        const source = anchorA ? componentA : componentB, target = anchorA ? componentB : componentA;
        peerSources.set(source, Math.min(peerSources.get(source) ?? Infinity, byId.get(anchorA ? a : b).gen));
        incomingPeers.push([source, target]);
      }
    }
    // Place the known side first, including through chains of unanchored peers.
    // A descendant's own peer link must not pin its ancestor to generation one.
    peerLinks.forEach(links => links.sort((a, b) => byId.get(a.from).gen - byId.get(b.from).gen
      || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)));
    const peerTargets = new Set(incomingPeers.filter(([source, target]) => peerRoot(source) !== peerRoot(target)).map(([, target]) => peerRoot(target)));
    const peerOrder = placementComponents.map((ids, index) => ({ ids, index }))
      .sort((a, b) => Number(peerTargets.has(peerRoot(a.index))) - Number(peerTargets.has(peerRoot(b.index)))
        || (peerSources.get(a.index) ?? Infinity) - (peerSources.get(b.index) ?? Infinity)
        || b.ids.length - a.ids.length || [...a.ids].sort()[0].localeCompare([...b.ids].sort()[0]));
    const peerPlaced = new Set();
    for (const { index } of peerOrder) {
      if (peerPlaced.has(index)) continue;
      const peerQueue = [index];
      peerPlaced.add(index);
      for (let cursor = 0; cursor < peerQueue.length; cursor++) {
        for (const peerLink of peerLinks[peerQueue[cursor]]) {
          if (peerPlaced.has(peerLink.next)) continue;
          const shift = byId.get(peerLink.from).gen - byId.get(peerLink.to).gen;
          placementComponents[peerLink.next].forEach(id => { byId.get(id).gen += shift; });
          peerPlaced.add(peerLink.next);
          peerQueue.push(peerLink.next);
        }
      }
      const ids = peerQueue.flatMap(componentIndex => placementComponents[componentIndex]);
      const shift = Math.max(0, 1 - Math.min(...ids.map(id => byId.get(id).gen)));
      if (shift) ids.forEach(id => { byId.get(id).gen += shift; });
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
