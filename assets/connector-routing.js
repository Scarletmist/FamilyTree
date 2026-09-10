/* Orthogonal routes through free card gaps. Only leave the card area when necessary. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyConnectorRouting = api;
})(globalThis, function () {
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
  function route(start, end, cards) {
    const obstacles = cards.map(r => ({ left: r.left - 8, right: r.right + 8, top: r.top - 8, bottom: r.bottom + 8 }));
    const xs = new Set([start[0], end[0], (start[0] + end[0]) / 2]);
    const ys = new Set([start[1], end[1], (start[1] + end[1]) / 2]);
    obstacles.forEach(r => { xs.add(r.left); xs.add(r.right); ys.add(r.top); ys.add(r.bottom); });
    let best = null, score = Infinity;
    function consider(points) {
      const simple = simplify(points);
      let length = 0;
      for (let i = 1; i < simple.length; i++) {
        if (obstacles.some(r => intersects(simple[i - 1], simple[i], r))) return;
        length += Math.abs(simple[i][0] - simple[i - 1][0]) + Math.abs(simple[i][1] - simple[i - 1][1]);
      }
      const value = length + Math.max(0, simple.length - 2) * 8;
      if (value < score) { score = value; best = simple; }
    }
    for (const x of xs) consider([start, [x, start[1]], [x, end[1]], end]);
    for (const y of ys) consider([start, [start[0], y], [end[0], y], end]);
    // Endpoints are in clear row gutters. An exterior lane is always a candidate.
    if (!best) throw new Error('連線端點位於卡片內，無法安全繪製。');
    return best;
  }
  return { route, intersects };
});
