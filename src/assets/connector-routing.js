/* Orthogonal routes through free card gaps, with lane separation and crossing bridges. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyConnectorRouting = api;
})(globalThis, function () {
  const LANE_GAP = 18;

  function intersects(a, b, r) {
    return a[0] === b[0]
      ? a[0] > r.left && a[0] < r.right && Math.max(a[1], b[1]) > r.top && Math.min(a[1], b[1]) < r.bottom
      : a[1] > r.top && a[1] < r.bottom && Math.max(a[0], b[0]) > r.left && Math.min(a[0], b[0]) < r.right;
  }

  function simplify(points) {
    const result = [];
    for (const p of points) {
      if (result.length && result.at(-1)[0] === p[0] && result.at(-1)[1] === p[1]) continue;
      while (result.length > 1) {
        const a = result.at(-2), b = result.at(-1);
        if (!(a[0] === b[0] && b[0] === p[0] || a[1] === b[1] && b[1] === p[1])) break;
        // Do not erase a necessary reversal.
        if ((b[0] - a[0]) * (p[0] - b[0]) < 0 || (b[1] - a[1]) * (p[1] - b[1]) < 0) break;
        result.pop();
      }
      result.push(p);
    }
    return result;
  }

  function segments(points, meta = {}) {
    const simple = simplify(points);
    const result = [];
    for (let i = 1; i < simple.length; i++) {
      const a = simple[i - 1], b = simple[i];
      if (a[0] !== b[0] && a[1] !== b[1]) throw new Error('連線 routing 僅支援水平或垂直線段。');
      if (a[0] === b[0] && a[1] === b[1]) continue;
      result.push({
        x1: a[0], y1: a[1], x2: b[0], y2: b[1],
        axis: a[0] === b[0] ? 'v' : 'h',
        min: a[0] === b[0] ? Math.min(a[1], b[1]) : Math.min(a[0], b[0]),
        max: a[0] === b[0] ? Math.max(a[1], b[1]) : Math.max(a[0], b[0]),
        fixed: a[0] === b[0] ? a[0] : a[1],
        index: i - 1,
        ...meta
      });
    }
    return result;
  }

  function overlapLength(a, b) {
    if (!a || !b || a.axis !== b.axis || Math.abs(a.fixed - b.fixed) > 0.01) return 0;
    return Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
  }

  function crossingPoint(a, b, clearance = 0.5) {
    if (!a || !b || a.axis === b.axis) return null;
    const h = a.axis === 'h' ? a : b;
    const v = a.axis === 'v' ? a : b;
    const x = v.fixed, y = h.fixed;
    if (x <= h.min + clearance || x >= h.max - clearance || y <= v.min + clearance || y >= v.max - clearance) return null;
    return { x, y };
  }

  function crossingCount(candidate, occupied) {
    let count = 0;
    for (const a of segments(candidate)) for (const b of occupied) if (crossingPoint(a, b)) count++;
    return count;
  }

  function overlapCost(candidate, occupied) {
    let total = 0;
    for (const a of segments(candidate)) for (const b of occupied) {
      if (a.axis !== b.axis) continue;
      const distance = Math.abs(a.fixed - b.fixed);
      const overlap = Math.max(0, Math.min(a.max, b.max) - Math.max(a.min, b.min));
      if (overlap > 0.5 && distance < LANE_GAP - .01) total += 100000 + overlap * (LANE_GAP - distance) * 1000;
    }
    return total;
  }

  // Choose one attachment column for the entire child stem. Moving only its
  // middle leaves a misleading short horizontal stub at the junction.
  function attachmentX(preferred, left, right, top, bottom, occupied = []) {
    const vertical = occupied.filter(s => s.axis === 'v' && Math.min(s.max, bottom) > Math.max(s.min, top));
    const candidates = [preferred, left, right, ...vertical.flatMap(s => [s.fixed - LANE_GAP, s.fixed + LANE_GAP])];
    return candidates.filter(x => x >= left && x <= right && vertical.every(s => Math.abs(x - s.fixed) >= LANE_GAP - .01))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b)[0] ?? preferred;
  }

  function route(start, end, cards, occupied = []) {
    const obstacles = cards.map(r => ({ left: r.left - 8, right: r.right + 8, top: r.top - 8, bottom: r.bottom + 8 }));
    const xs = new Set([start[0], end[0], (start[0] + end[0]) / 2]);
    const ys = new Set([start[1], end[1], (start[1] + end[1]) / 2]);
    obstacles.forEach(r => { xs.add(r.left); xs.add(r.right); ys.add(r.top); ys.add(r.bottom); });
    // Existing connector lanes are candidates too, but use neighboring lanes so unrelated
    // connections do not sit exactly on top of each other.
    occupied.forEach(s => {
      if (s.axis === 'v') { xs.add(s.fixed - LANE_GAP); xs.add(s.fixed + LANE_GAP); }
      else { ys.add(s.fixed - LANE_GAP); ys.add(s.fixed + LANE_GAP); }
    });
    let best = null, score = Infinity;
    function consider(points) {
      const simple = simplify(points);
      let length = 0;
      for (let i = 1; i < simple.length; i++) {
        if (obstacles.some(r => intersects(simple[i - 1], simple[i], r))) return;
        length += Math.abs(simple[i][0] - simple[i - 1][0]) + Math.abs(simple[i][1] - simple[i - 1][1]);
      }
      const overlap = overlapCost(simple, occupied);
      const crossings = crossingCount(simple, occupied);
      const value = length + Math.max(0, simple.length - 2) * 8 + crossings * 6 + overlap;
      if (value < score) { score = value; best = simple; }
    }
    for (const x of xs) consider([start, [x, start[1]], [x, end[1]], end]);
    for (const y of ys) consider([start, [start[0], y], [end[0], y], end]);
    // A one-lane route can be forced to share a horizontal/vertical lane when the
    // other endpoint is behind cards. Only in that case, try a bounded set of
    // three-bend combinations: move to a neighboring lane first, then use a
    // separate safe cross-lane near either endpoint.
    if (best && overlapCost(best, occupied) > 0) {
      const nearest = (values, anchors, limit = 28) => [...values]
        .sort((a, b) => Math.min(...anchors.map(x => Math.abs(a - x))) - Math.min(...anchors.map(x => Math.abs(b - x))))
        .slice(0, limit);
      const xChoices = nearest(xs, [start[0], end[0], (start[0] + end[0]) / 2]);
      const yChoices = nearest(ys, [start[1], end[1], (start[1] + end[1]) / 2]);
      for (const y of yChoices) for (const x of xChoices) {
        consider([start, [start[0], y], [x, y], [x, end[1]], end]);
        consider([start, [x, start[1]], [x, y], [end[0], y], end]);
      }
    }
    // Endpoints are in clear row gutters. An exterior lane is always a candidate.
    if (!best) throw new Error('連線端點位於卡片內，無法安全繪製。');
    return best;
  }

  function crossings(points, occupied, clearance = 8) {
    const found = [];
    const own = segments(points);
    for (const a of own) {
      for (const b of occupied) {
        const point = crossingPoint(a, b, clearance);
        if (!point) continue;
        if (!found.some(p => Math.abs(p.x - point.x) < 0.1 && Math.abs(p.y - point.y) < 0.1)) found.push(point);
      }
    }
    return found;
  }

  function fmt(value) {
    const n = Math.round(value * 100) / 100;
    return String(Object.is(n, -0) ? 0 : n);
  }

  function bridgePath(points, crossingPoints = [], radius = 7) {
    const simple = simplify(points);
    if (!simple.length) return '';
    if (simple.length === 1) return `M ${fmt(simple[0][0])} ${fmt(simple[0][1])}`;
    let d = `M ${fmt(simple[0][0])} ${fmt(simple[0][1])}`;
    for (let i = 1; i < simple.length; i++) {
      const a = simple[i - 1], b = simple[i];
      const horizontal = a[1] === b[1];
      const direction = horizontal ? Math.sign(b[0] - a[0]) : Math.sign(b[1] - a[1]);
      const start = horizontal ? a[0] : a[1];
      const end = horizontal ? b[0] : b[1];
      const segmentMin = Math.min(start, end), segmentMax = Math.max(start, end);
      const positions = crossingPoints
        .filter(p => horizontal
          ? Math.abs(p.y - a[1]) < 0.1 && p.x > segmentMin + 2 && p.x < segmentMax - 2
          : Math.abs(p.x - a[0]) < 0.1 && p.y > segmentMin + 2 && p.y < segmentMax - 2)
        .map(p => horizontal ? p.x : p.y)
        .sort((x, y) => x - y);
      // Merge very close crossings into one wider rounded bridge.
      const groups = [];
      for (const pos of positions) {
        const last = groups.at(-1);
        if (last && pos - last.at(-1) <= radius * 2 + 3) last.push(pos);
        else groups.push([pos]);
      }
      if (direction < 0) { groups.reverse(); groups.forEach(group => group.reverse()); }
      for (const group of groups) {
        const groupMin = Math.min(...group), groupMax = Math.max(...group);
        const available = Math.min(groupMin - segmentMin, segmentMax - groupMax) - 1;
        if (available < 2) continue;
        const localRadius = Math.min(radius, available);
        const first = group[0], last = group.at(-1);
        const before = first - direction * localRadius;
        const after = last + direction * localRadius;
        if (horizontal) {
          d += ` L ${fmt(before)} ${fmt(a[1])}`;
          const rx = Math.abs(after - before) / 2;
          const sweep = direction > 0 ? 0 : 1;
          d += ` A ${fmt(rx)} ${fmt(localRadius)} 0 0 ${sweep} ${fmt(after)} ${fmt(a[1])}`;
        } else {
          d += ` L ${fmt(a[0])} ${fmt(before)}`;
          const ry = Math.abs(after - before) / 2;
          const sweep = direction > 0 ? 1 : 0;
          d += ` A ${fmt(localRadius)} ${fmt(ry)} 0 0 ${sweep} ${fmt(a[0])} ${fmt(after)}`;
        }
      }
      d += ` L ${fmt(b[0])} ${fmt(b[1])}`;
    }
    return d;
  }

  function sharedSegments(paths) {
    const lines = new Map();
    paths.forEach(p => segments(p.points).forEach(s => {
      const key = `${s.axis}:${s.fixed}`;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ ...s, people: p.people });
    }));
    const result = [];
    for (const entries of lines.values()) {
      const cuts = [...new Set(entries.flatMap(s => [s.min, s.max]))].sort((a, b) => a - b);
      for (let i = 1; i < cuts.length; i++) {
        const lo = cuts[i - 1], hi = cuts[i];
        const covering = entries.filter(s => s.min <= lo && s.max >= hi);
        if (!covering.length) continue;
        const s = covering[0];
        const point = v => s.axis === 'h' ? [v, s.fixed] : [s.fixed, v];
        result.push({ points: [point(lo), point(hi)], people: [...new Set(covering.flatMap(s => s.people))] });
      }
    }
    return result;
  }
  return { route, intersects, simplify, segments, overlapLength, crossingPoint, crossings, bridgePath, sharedSegments, attachmentX };
});
