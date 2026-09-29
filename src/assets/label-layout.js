/* Place measured label rectangles near their preferred anchors, without collisions. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FamilyLabelLayout = api;
})(globalThis, function () {
  const overlaps = (a, b, gap = 6) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  function place(labels, obstacles, bounds) {
    const occupied = obstacles.slice(), result = [];
    for (const label of labels) {
      const clampX = x => Math.max(bounds.left, Math.min(bounds.right - label.width, x));
      const origin = { ...label, x: clampX(label.x), y: Math.max(bounds.top, label.y) };
      const candidates = [origin];
      // Search near the original label first; vertical steps retain comfortable text spacing.
      const stepY = label.height + 10;
      for (let ring = 1; ring <= 12; ring++) {
        for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          candidates.push({ ...label, x: clampX(origin.x + dx * 24), y: origin.y + dy * stepY });
        }
      }
      candidates.sort((a, b) => (a.x - label.x) ** 2 + (a.y - label.y) ** 2 - ((b.x - label.x) ** 2 + (b.y - label.y) ** 2));
      let found = candidates.find(p => p.y >= bounds.top && p.y + p.height <= bounds.bottom && !occupied.some(o => overlaps(p, o)));
      // Extremely dense diagrams may need extra space below, but labels are never hidden.
      if (!found) found = { ...origin, y: Math.max(bounds.top, ...occupied.map(o => o.y + o.height)) + 12 };
      occupied.push(found); result.push(found);
    }
    return result;
  }
  return { place, overlaps };
});
