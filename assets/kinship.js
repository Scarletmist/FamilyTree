/* Taiwan common kinship terms, based on the MOE 親朋稱呼表:
 * https://dict.concised.moe.edu.tw/appendix.jsp?ID=12&la=1&powerMode=0
 * Searches recorded edges only. No parents, marriages or cousin ages are invented.
 */
(function (root, factory) {
  const model = typeof module === 'object' && module.exports ? require('./family-model.js') : root.FamilyModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyKinship = api;
})(globalThis, function (Model) {
  'use strict';
  const INVERSE = { parent: 'child', child: 'parent', grandparent: 'grandchild', grandchild: 'grandparent', spouse: 'spouse', sibling: 'sibling', swornSibling: 'swornSibling', fellowDisciple: 'fellowDisciple', tangCousin: 'tangCousin', biaoCousin: 'biaoCousin', teacher: 'student', student: 'teacher' };
  function create(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.rules) || !config.labels || !config.direct || !config.notes || !config.display || !config.numerals || !Array.isArray(config.familyTypes) || !Array.isArray(config.familyKinds)) throw new Error('稱謂設定檔格式不正確');
  for (const key of ['self', 'fallbackTerm', 'chainSeparator', 'nonBiologicalPrefix', 'nonBiologicalSeparator', 'nonBiologicalSuffix']) if (typeof config.display[key] !== 'string') throw new Error('稱謂設定缺少顯示文字：' + key);
  if (typeof config.numerals.digits !== 'string' || config.numerals.digits.length !== 10 || typeof config.numerals.eldest !== 'string' || typeof config.numerals.tens !== 'string') throw new Error('稱謂數字設定不正確');
  const FAMILY_TYPES = new Set(config.familyTypes), FAMILY_KINDS = new Set(config.familyKinds);
  const weight = type => ['sibling', 'grandparent', 'grandchild'].includes(type) ? 2 : 1;
  const field = (context, path) => String(path).split('.').reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined, context);
  function evaluate(expr, context, depth = 0) {
    if (depth > 24) throw new Error('稱謂設定的參照過深或循環');
    if (typeof expr === 'string') return expr;
    if (!expr || typeof expr !== 'object') throw new Error('稱謂設定含無效運算式');
    if (expr.ref) return evaluate(config.labels[expr.ref], context, depth + 1);
    if (expr.select) { const key = String(field(context, expr.select)); return evaluate(Object.hasOwn(expr.cases, key) ? expr.cases[key] : expr.cases.default ?? '', context, depth + 1); }
    if (expr.join) return expr.join.map(e => evaluate(e, context, depth + 1)).join('');
    if (expr.field) return String(field(context, expr.field) ?? '');
    throw new Error('稱謂設定含不支援的運算式');
  }
  // Validate every branch, including references not selected by current data.
  function validate(expr, refs = []) {
    if (typeof expr === 'string') return;
    if (!expr || typeof expr !== 'object') throw new Error('無效稱謂設定');
    if (expr.ref) { if (refs.includes(expr.ref)) throw new Error('循環稱謂參照'); validate(config.labels[expr.ref], [...refs, expr.ref]); }
    else if (expr.select && expr.cases) Object.values(expr.cases).forEach(e => validate(e, refs));
    else if (Array.isArray(expr.join)) expr.join.forEach(e => validate(e, refs));
    else if (!expr.field) throw new Error('無效稱謂運算式');
  }
  Object.values(config.labels).forEach(e => validate(e)); Object.values(config.direct).forEach(e => validate(e));
  config.rules.forEach(r => {
    if (!Array.isArray(r.patterns) || !r.patterns.every(pattern => typeof pattern === 'string' && pattern.split('/').every(type => Object.hasOwn(INVERSE, type)))) throw new Error('無效稱謂路徑');
    validate(r.label);
    for (const note of r.notes || []) if (typeof config.notes[typeof note === 'string' ? note : note.key] !== 'string') throw new Error('稱謂提示參照不存在');
  });
  const matches = (when, context) => Object.entries(when || {}).every(([key, value]) => field(context, key) === value);
  function rank(n) {
    if (!n) return '';
    const { digits, eldest, tens } = config.numerals;
    return n === 1 ? eldest : n < 10 ? digits[n] : n < 100 ? (n < 20 ? '' : digits[Math.floor(n / 10)]) + tens + (n % 10 ? digits[n % 10] : '') : String(n);
  }
  function contextFor(steps, byId) {
    const base = byId.get(steps[0].from);
    const stepsContext = steps.map((edge, i) => { const p = byId.get(edge.to); return { gender: p.gender, discipleOrderToBase: Math.sign(Model.compareDiscipleOrder(p, base)), rankPrefix: rank(p.siblingOrder), orderToBase: Math.sign(Model.compareOrder(p, base)), orderToPrevious: Math.sign(Model.compareOrder(p, i ? byId.get(steps[i - 1].to) : base)) }; });
    return { edge: { ...steps.at(-1), seniority: steps.at(-1).seniority || 'unknown' }, target: stepsContext.at(-1), steps: stepsContext };
  }
  function term(edge, byId) { return evaluate(config.direct[edge.type] ?? config.display.fallbackTerm, contextFor([edge], byId)); }
  function ruleNotes(rule, context) {
    return (rule?.notes || []).filter(note => typeof note === 'string' || matches(note.when, context))
      .map(note => config.notes[typeof note === 'string' ? note : note.key]);
  }
  const longestPattern = Math.max(1, ...config.rules.flatMap(rule => rule.patterns.map(pattern => pattern.split('/').length)));
  // Minimize the remaining chain, matching every fragment relative to its own
  // starting member. The original graph path and its intermediate members stay intact.
  function compactChain(steps, byId) {
    const best = new Array(steps.length + 1);
    best[steps.length] = { titles: [], notes: [], cost: 0, length: 0 };
    for (let start = steps.length - 1; start >= 0; start--) {
      for (let end = Math.min(steps.length, start + longestPattern); end > start; end--) {
        const fragment = steps.slice(start, end), context = contextFor(fragment, byId);
        const pattern = fragment.map(edge => edge.type).join('/');
        // Do not erase contract/sworn kinds inside compressed family fragments.
        const eligible = fragment.length === 1 || fragment.every(edge => !edge.kind || FAMILY_KINDS.has(edge.kind));
        const rule = eligible && config.rules.find(rule => rule.patterns.includes(pattern) && matches(rule.when, context));
        const title = rule ? evaluate(rule.label, context) : fragment.length === 1 ? term(fragment[0], byId) : '';
        if (!title) continue;
        const tail = best[end];
        const candidate = { titles: [title, ...tail.titles], notes: [...ruleNotes(rule, context), ...(context.target.gender === 'U' ? [config.notes.unknownGender] : []), ...tail.notes],
          cost: title.split(config.display.chainSeparator).length + tail.cost, length: title.length + tail.length };
        if (!best[start] || candidate.cost < best[start].cost || candidate.cost === best[start].cost && candidate.length < best[start].length) best[start] = candidate;
      }
    }
    return best[0];
  }
  function describe(path, byId) {
    const original = path.edges, steps = [], notes = [];
    for (let i = 0; i < original.length; i++) {
      const a = original[i], b = original[i + 1];
      if (a.type === 'parent' && b?.type === 'child' && FAMILY_KINDS.has(a.kind) && FAMILY_KINDS.has(b.kind)) { steps.push({ from: a.from, to: b.to, type: 'sibling' }); i++; }
      else steps.push(a);
    }
    const context = contextFor(steps, byId), pattern = steps.map(s => s.type).join('/');
    const rule = config.rules.find(r => r.patterns.includes(pattern) && matches(r.when, context));
    let confidence = 3;
    let title = rule ? evaluate(rule.label, context) : steps.length === 1 ? term(steps[0], byId) : '';
    notes.push(...ruleNotes(rule, context));
    if (notes.includes(config.notes.unknownSide)) confidence = 2;
    if (!title) {
      const compact = compactChain(steps, byId);
      title = compact.titles.join(config.display.chainSeparator);
      notes.push(...compact.notes, config.notes.fallback); confidence = 1;
    }
    const kinds = [...new Set(original.map(e => e.kind).filter(k => k && k !== '親生'))];
    if (kinds.length && original.length > 1) { title += config.display.nonBiologicalPrefix + kinds.join(config.display.nonBiologicalSeparator) + config.display.nonBiologicalSuffix; notes.push(config.notes.nonBiological); }
    if (context.target.gender === 'U') notes.push(config.notes.unknownGender);
    return { title, notes: [...new Set(notes.filter(Boolean))], confidence, cousinType: rule?.cousinType };
  }
  function indexGraph(graph) {
    const byId = new Map(graph.people.map(p => [p.id, p]));
    const adjacency = new Map(graph.people.map(p => [p.id, []]));
    const seen = new Set();
    for (const p of graph.people) for (const r of Model.relationshipsFor(graph, p.id)) {
      if (!byId.has(r.personId) || !INVERSE[r.type]) continue;
      const key = p.id < r.personId ? [p.id, r.personId, r.type, r.kind || ''].join('|') : [r.personId, p.id, INVERSE[r.type], r.kind || ''].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const forward = { from: p.id, to: r.personId, type: r.type, key, ...(r.kind ? { kind: r.kind } : {}), ...(r.seniority ? { seniority: r.seniority } : {}) };
      adjacency.get(p.id).push(forward);
      adjacency.get(r.personId).push({ ...forward, from: r.personId, to: p.id, type: INVERSE[r.type], ...(r.seniority ? { seniority: Model.inverseSeniority(r.seniority) } : {}) });
    }
    const priority = type => ['parent', 'grandparent', 'sibling', 'spouse', 'child', 'grandchild'].indexOf(type);
    adjacency.forEach(edges => edges.sort((a, b) => priority(a.type) - priority(b.type) || ({ M: 0, F: 1, U: 2 }[byId.get(a.to).gender] - { M: 0, F: 1, U: 2 }[byId.get(b.to).gender]) || a.to.localeCompare(b.to)));
    return { byId, adjacency };
  }
  function shortest(adjacency, start, end, familyOnly, limit = 12) {
    const distance = new Map([[start, 0]]), previous = new Map(), pending = new Set([start]);
    while (pending.size) {
      let current;
      for (const id of pending) if (current === undefined || distance.get(id) < distance.get(current)) current = id;
      pending.delete(current);
      if (current === end) break;
      for (const e of adjacency.get(current)) {
        if (familyOnly && (!FAMILY_TYPES.has(e.type) || (e.kind && !FAMILY_KINDS.has(e.kind)))) continue;
        const cost = distance.get(current) + weight(e.type), known = distance.get(e.to) ?? Infinity;
        if (cost < known) { distance.set(e.to, cost); previous.set(e.to, [e]); pending.add(e.to); }
        else if (cost === known) previous.get(e.to).push(e);
      }
    }
    if (!distance.has(end)) return { paths: [], truncated: false };
    const stack = [{ id: end, edges: [] }], paths = [];
    while (stack.length && paths.length < limit) {
      const item = stack.pop();
      if (item.id === start) {
        paths.push({ nodes: [start, ...item.edges.map(e => e.to)], edges: item.edges, familyRoute: familyOnly });
      } else {
        for (const edge of (previous.get(item.id) || []).slice().reverse()) stack.push({ id: edge.from, edges: [edge, ...item.edges] });
      }
    }
    return { paths, truncated: stack.length > 0 };
  }
  function query(graph, aId, bId) {
    const { byId, adjacency } = indexGraph(graph);
    if (!byId.has(aId) || !byId.has(bId)) return { status: 'missing', paths: [] };
    if (aId === bId) return { status: 'same', paths: [{ nodes: [aId], edges: [], title: config.display.self, notes: [] }] };
    let result = shortest(adjacency, bId, aId, true);
    if (!result.paths.length) result = shortest(adjacency, bId, aId, false);
    if (!result.paths.length) return { status: 'unconnected', paths: [], nodes: [bId, aId] };
    // A direct social relationship can coexist with a family relationship (e.g. father/teacher).
    const direct = adjacency.get(bId).filter(e => e.to === aId);
    for (const edge of direct) if (!result.paths.some(p => p.edges.length === 1 && p.edges[0].key === edge.key)) result.paths.push({ nodes: [bId, aId], edges: [edge], familyRoute: false });
    const paths = result.paths.map(p => ({ ...p, ...describe(p, byId) }));
    for (const path of paths) if (path.cousinType && path.edges.length > 1) {
      const recorded = direct.find(e => e.type === path.cousinType && ['older', 'younger'].includes(e.seniority));
      if (recorded) {
        const suffix = path.title.indexOf(config.display.nonBiologicalPrefix);
        path.title = term(recorded, byId) + (suffix < 0 ? '' : path.title.slice(suffix));
        path.notes = path.notes.filter(note => note !== config.notes.cousinAge);
        path.notes.push(config.notes.recordedCousinAge);
      }
      if (direct.some(e => Model.isCousin(e.type) && e.type !== path.cousinType)) path.notes.push(config.notes.cousinMismatch);
    }
    paths.sort((a, b) => Number(b.familyRoute) - Number(a.familyRoute) || b.confidence - a.confidence || a.edges.length - b.edges.length);
    return { status: 'connected', paths, truncated: result.truncated };
  }
  function project(graph, path, isolatedIds = []) {
    const ids = new Set(path ? path.nodes : isolatedIds), relations = new Map([...ids].map(id => [id, []]));
    for (const edge of path?.edges || []) relations.get(edge.from).push({ type: edge.type, personId: edge.to, ...(edge.kind ? { kind: edge.kind } : {}), ...(edge.seniority ? { seniority: edge.seniority } : {}) });
    const people = graph.people.filter(p => ids.has(p.id)).map(p => ({ ...p, relationships: relations.get(p.id) }));
    const focused = Model.build({ schemaVersion: 2, familyName: graph.familyName, people });
    // Display original generations, including gaps for explicit grandparent edges.
    const original = new Map(people.map(p => [p.id, p.gen]));
    focused.people.forEach(p => { p.gen = original.get(p.id); });
    return focused;
  }
  return { query, project };
  }
  return { create };
});
