/*
 * Pure layout projection for the family-tree canvas.
 * DOM creation and pointer behavior deliberately stay outside this module.
 */

export function createTreeLayout({
  graph,
  fullGraph,
  focus = null,
  focusedIds = null,
  connectedIds,
  intermediatePlans,
  displayShift,
  uncertainGeneration,
  model,
  orderKey
}) {
  const people = graph.people
    .filter(person => !focusedIds || focusedIds.has(person.id))
    .map(person => ({
      ...person,
      gen: connectedIds.has(person.id) ? person.gen + displayShift : uncertainGeneration
    }));
  const byId = new Map(people.map(person => [person.id, person]));

  const unions = (graph.unions || []).filter(union => {
    if (focus && union.id !== focus.id) return false;
    const valid = Array.isArray(union.partners)
      && union.partners.length >= 1
      && union.partners.length <= 4
      && new Set(union.partners).size === union.partners.length
      && union.partners.every(id => byId.has(id));
    if (!valid) console.warn('略過無效婚姻', union.id);
    return valid;
  });
  const unionById = new Map(unions.map(union => [union.id, union]));

  const descents = (graph.descents || []).filter(descent => {
    if (descent.kind === '親生'
      && descent.generations === 2
      && intermediatePlans.some(plan => plan.near === descent.child && plan.edgeKey.startsWith('親生祖孫|'))) return false;
    if (focus && descent.union !== focus.id) return false;
    const valid = byId.has(descent.child) && unionById.has(descent.union);
    if (!valid) console.warn('略過無效親子關係', descent);
    return valid;
  });

  const childrenOf = union => descents
    .filter(descent => descent.union === union.id)
    .sort((a, b) => orderKey(byId.get(a.child)) - orderKey(byId.get(b.child)));

  const completedCousins = model.completedCousins(graph);
  const extra = (graph.bonds || [])
    .filter(bond => !completedCousins.has(model.intermediateKey(bond.kind, bond.members)))
    .map(bond => ({ from: bond.members?.[0], to: bond.members?.[1], kind: bond.kind }))
    .concat(intermediatePlans
      .filter(plan => plan.edgeKey.startsWith('親生祖孫|'))
      .map(plan => ({ from: plan.other, to: plan.near, kind: '親生', planId: plan.id })))
    .concat((graph.mentorships || []).map(item => ({ from: item.teacher, to: item.student, kind: '師徒' })))
    .filter(relation => {
      if (focus && (!byId.has(relation.from) || !byId.has(relation.to))) return false;
      const valid = byId.has(relation.from) && byId.has(relation.to) && relation.from !== relation.to;
      if (!valid) console.warn('略過無效關係', relation);
      return valid;
    });

  const sharing = model.connectorGroups(graph, extra);
  extra.forEach((relation, index) => {
    if (sharing[index].root === relation.to) [relation.from, relation.to] = [relation.to, relation.from];
  });

  const occupiedGenerations = people
    .filter(person => connectedIds.has(person.id))
    .map(person => person.gen)
    .concat(intermediatePlans.map(plan => plan.generation + displayShift));
  const firstGeneration = occupiedGenerations.length ? Math.min(...occupiedGenerations) : 1;
  const lastGeneration = occupiedGenerations.length ? Math.max(...occupiedGenerations) : 1;
  const generations = occupiedGenerations.length
    ? Array.from({ length: lastGeneration - firstGeneration + 1 }, (_, index) => firstGeneration + index)
    : [];
  if (people.some(person => !connectedIds.has(person.id))) generations.push(uncertainGeneration);

  const originCounts = new Map();
  const childCounts = new Map();
  const originLanes = new Map();
  const childLanes = new Map();
  unions.forEach(union => {
    const gen = Math.max(...union.partners.map(id => byId.get(id).gen));
    originLanes.set(union.id, originCounts.get(gen) || 0);
    originCounts.set(gen, (originCounts.get(gen) || 0) + 1);
    for (const childGen of new Set(childrenOf(union).map(descent => byId.get(descent.child).gen))) {
      childLanes.set(`${union.id}:${childGen}`, childCounts.get(childGen) || 0);
      childCounts.set(childGen, (childCounts.get(childGen) || 0) + 1);
    }
  });

  const auxiliaryCounts = new Map();
  const groupLanes = new Map();
  const auxiliaryLanes = extra.map((relation, index) => {
    if (groupLanes.has(sharing[index].group)) return groupLanes.get(sharing[index].group);
    const members = extra.filter((_, candidate) => sharing[candidate].group === sharing[index].group);
    const memberPlans = members.map(edge => intermediatePlans.filter(plan =>
      edge.planId
        ? plan.id === edge.planId
        : plan.edgeKey === model.intermediateKey(edge.kind, [edge.from, edge.to])
    ));
    const count = Math.max(0, ...memberPlans.map(plans => plans.length));
    const gens = [...new Set([
      ...members.flatMap(edge => [byId.get(edge.from).gen, byId.get(edge.to).gen]),
      ...memberPlans.flat().map(plan => plan.generation + displayShift)
    ])];
    const lane = Math.max(0, ...gens.map(gen => auxiliaryCounts.get(gen) || 0));
    gens.forEach(gen => auxiliaryCounts.set(gen, lane + count + 1));
    groupLanes.set(sharing[index].group, lane);
    return lane;
  });

  const auxiliaryLaneStep = 18;
  const auxiliaryExtent = gen => auxiliaryCounts.has(gen)
    ? 24 + Math.max(0, auxiliaryCounts.get(gen) - 1) * auxiliaryLaneStep
    : 0;
  const upperLanes = gen => Math.max(
    58 + Math.max(0, (childCounts.get(gen) || 0) - 1) * 18,
    auxiliaryExtent(gen) + 16,
    64
  );
  const lowerLanes = gen => Math.max(
    22 + Math.max(0, (originCounts.get(gen) || 0) - 1) * 18,
    auxiliaryExtent(gen),
    40
  );
  const rowGap = gen => Math.max(144, lowerLanes(gen) + upperLanes(gen + 1) + 24);

  function generationBlocks(gen) {
    const visited = new Set();
    const blocks = [];
    people.filter(person => person.gen === gen).forEach(person => {
      if (visited.has(person.id)) return;
      const block = [];
      function visit(id) {
        if (visited.has(id) || byId.get(id)?.gen !== gen) return;
        visited.add(id);
        block.push(byId.get(id));
        unions.forEach(union => {
          if (union.partners.includes(id)) union.partners.forEach(visit);
        });
      }
      visit(person.id);
      block.sort((a, b) => people.indexOf(a) - people.indexOf(b));
      blocks.push(block);
    });

    function key(block) {
      const links = descents.filter(descent => block.some(person => person.id === descent.child));
      links.sort((a, b) => unions.indexOf(unionById.get(a.union)) - unions.indexOf(unionById.get(b.union)));
      if (links.length) {
        return [
          unions.indexOf(unionById.get(links[0].union)),
          orderKey(byId.get(links[0].child))
        ];
      }
      for (const bond of graph.bonds || []) {
        if (bond.kind !== '手足' || !bond.members.some(id => block.some(person => person.id === id))) continue;
        const other = bond.members.find(id => !block.some(person => person.id === id));
        const parentLink = descents.find(descent => descent.child === other);
        if (parentLink) return [unions.indexOf(unionById.get(parentLink.union)), orderKey(block[0])];
      }
      return [Infinity, orderKey(block[0])];
    }

    blocks.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return (x[0] - y[0]) || (x[1] - y[1]) || 0;
    });
    return blocks;
  }

  return {
    fullGraph,
    graph,
    people,
    byId,
    unions,
    unionById,
    descents,
    childrenOf,
    completedCousins,
    extra,
    sharing,
    generations,
    firstGeneration,
    lastGeneration,
    originLanes,
    childLanes,
    auxiliaryLanes,
    auxiliaryLaneStep,
    auxiliaryExtent,
    upperLanes,
    lowerLanes,
    rowGap,
    generationBlocks
  };
}
