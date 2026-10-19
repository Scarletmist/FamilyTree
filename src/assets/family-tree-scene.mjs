/* Serializable, unscaled geometry shared by navigation, SVG and print. */
const shapeAttributes = ['d','x','y','x1','x2','y1','y2','width','height','cx','cy','r','rx','ry','fill','stroke','stroke-width','stroke-dasharray','stroke-linejoin','stroke-linecap','marker-start','marker-end','markerWidth','markerHeight','refX','refY','orient','viewBox','id','points','transform'];
export function captureScene(canvas,{bands = []} = {}) {
  const origin = canvas.getBoundingClientRect();
  const relative = element => {
    const b = element.getBoundingClientRect();
    return {x:b.left - origin.left,y:b.top - origin.top,width:b.width,height:b.height};
  };
  const shape = element => ({tag:element.localName,
    attrs:Object.fromEntries(shapeAttributes.filter(key => element.hasAttribute(key)).map(key => [key,element.getAttribute(key)])),
    ...(element.localName === 'text' ? {text:element.textContent,inferred:element.dataset.inferred === 'true'} : {}),
    ...(element.children.length ? {children:[...element.children].map(shape)} : {})});
  const nodes = [...canvas.querySelectorAll('.person')].map(element => ({
    id:element.dataset.personId,...relative(element),archived:element.dataset.archived === 'true',
    lines:[...element.children].filter(child => child.textContent).map(child => ({text:child.textContent,
      size:child.classList.contains('person__name') ? 20 : 16,
      bold:child.classList.contains('person__name'),color:child.classList.contains('person__name') ? '#302c27' : '#655f57'}))
  }));
  const shapes = [...canvas.querySelector('.tree__connectors')?.children || []].map(element => {
    const record = shape(element);
    if (element.localName !== 'defs' && typeof element.getBBox === 'function') {
      const b = element.getBBox();
      // Include strokes and endpoint markers in cross-page clipping decisions.
      record.bounds = {x:b.x - 16,y:b.y - 16,width:b.width + 32,height:b.height + 32};
    }
    return record;
  });
  const placeholders = [...canvas.querySelectorAll('.intermediate-node')].map(element => ({...relative(element),text:'待補人物'}));
  return {width:Math.max(origin.width,canvas.scrollWidth),height:Math.max(origin.height,canvas.scrollHeight),nodes,shapes,bands,placeholders};
}

/* Retain actual recorded bridges, including archived ones, between scope members.
 * Connections are never replaced by a fabricated shortcut. */
export function projectOutputGraph(graph,{ids = null,includeArchived = false} = {}) {
  const byId = new Map(graph.people.map(p => [p.id,p]));
  const kept = new Set((ids || graph.people.filter(p => includeArchived || !p.archive).map(p => p.id)).filter(id => byId.has(id) && (includeArchived || !byId.get(id).archive)));
  const bridges = new Set(), neighbors = new Map(graph.people.map(p => [p.id,new Set()]));
  const connect = (a,b) => {if (a !== b && neighbors.has(a) && neighbors.has(b)) {neighbors.get(a).add(b);neighbors.get(b).add(a);}};
  for (const p of graph.people) for (const r of p.relationships || []) connect(p.id,r.personId);
  // Connect each component's terminals with a breadth-first spanning tree. This
  // is linear in the original graph, rather than one search per member pair.
  const visited = new Set();
  for (const root of kept) {
    if (visited.has(root)) continue;
    const parent = new Map([[root,null]]),queue = [root]; visited.add(root);
    for (let i = 0; i < queue.length; i++) for (const next of neighbors.get(queue[i])) if (!visited.has(next)) {
      visited.add(next); parent.set(next,queue[i]); queue.push(next);
    }
    for (const terminal of queue.filter(id => kept.has(id))) {
      let current = terminal;
      while (current !== null && current !== root) {
        if (!kept.has(current)) {kept.add(current);bridges.add(current);}
        current = parent.get(current);
      }
    }
  }
  const unions = (graph.unions || []).map(u => ({...u,partners:u.partners.filter(id => kept.has(id))}))
    .filter(u => u.partners.length).map(u => ({...u,married:u.married && u.partners.length > 1}));
  const unionIds = new Set(unions.map(u => u.id));
  return {graph:{...graph,
    people:graph.people.filter(p => kept.has(p.id)).map(p => ({...p,relationships:(p.relationships || []).filter(r => kept.has(r.personId))})),
    unions,descents:(graph.descents || []).filter(d => kept.has(d.child) && unionIds.has(d.union)),
    bonds:(graph.bonds || []).filter(b => b.members.every(id => kept.has(id))),
    inferredRelations:(graph.inferredRelations || []).filter(r => kept.has(r.from) && kept.has(r.personId)),
    mentorships:(graph.mentorships || []).filter(m => kept.has(m.teacher) && kept.has(m.student)),
    rankGroups:(graph.rankGroups || []).map(g => ({...g,members:g.members.filter(m => kept.has(m.personId))})).filter(g => g.members.length)
  },bridges};
}

export function buildSourceAppendix(graph,{hideNames = false} = {}) {
  if (hideNames) return [];
  const names = new Map(graph.people.map(p => [p.id,p.name])),seen = new Set(),records = [];
  for (const p of graph.people) for (const r of p.relationships || []) {
    if ((!r.source && !r.note) || !names.has(r.personId)) continue;
    const category = ({child:'parent',grandchild:'grandparent',student:'teacher'})[r.type] || r.type;
    const key = JSON.stringify([[p.id,r.personId].sort(),category,r.kind || '',r.source || '',r.note || '']);
    if (seen.has(key)) continue; seen.add(key);
    const typeLabel = {parent:'父母',child:'子女',spouse:'配偶',sibling:'手足',swornSibling:'契手足',grandparent:'祖父母',grandchild:'孫子女',teacher:'師父',student:'徒弟',fellowDisciple:'師兄弟姊妹',tangCousin:'堂親',biaoCousin:'表親'}[r.type] || '關係';
    records.push({label:`${names.get(r.personId)}是${p.name}的${typeLabel}${r.kind ? `（${r.kind}）` : ''}`,source:r.source || '未填寫',note:r.note || ''});
  }
  return records;
}
