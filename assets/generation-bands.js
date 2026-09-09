/* Decorative generation bands, measured from the actual rendered family rows. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FamilyGenerationBands = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Divide the empty space between adjacent rows in half. This keeps every
  // person in its own generation while allowing the connector gutters to grow.
  function calculate(rows, totalHeight) {
    if (!rows.length) return [];
    const height = Math.max(0, totalHeight);
    const bands = [];
    let start = 0;
    rows.forEach((row, index) => {
      const next = rows[index + 1];
      const end = next
        ? Math.max(start, Math.min(height, (row.bottom + next.top) / 2))
        : height;
      bands.push({ gen: row.gen, top: start, height: end - start, ...(row.uncertain ? { uncertain: true } : {}) });
      start = end;
    });
    return bands;
  }

  function render(canvas, rows) {
    const origin = canvas.getBoundingClientRect();
    const measured = rows.map(row => {
      const rect = row.getBoundingClientRect();
      return { gen: Number(row.dataset.gen), top: rect.top - origin.top, bottom: rect.bottom - origin.top, uncertain: row.dataset.uncertain === 'true' };
    });
    const bands = calculate(measured, origin.height);
    const backgrounds = document.createElement('div');
    backgrounds.className = 'tree__generation-bands';
    backgrounds.setAttribute('aria-hidden', 'true');
    const labels = document.createElement('div');
    labels.className = 'tree__generation-labels';
    labels.setAttribute('aria-hidden', 'true');
    for (const band of bands) {
      const tone = ((band.gen - 1) % 4 + 4) % 4 + 1;
      const position = { top: band.top + 'px', height: band.height + 'px' };
      const background = document.createElement('div');
      background.className = 'tree__generation-band';
      background.dataset.gen = String(band.gen);
      if (band.uncertain) background.dataset.uncertain = 'true';
      background.dataset.tone = String(tone);
      Object.assign(background.style, position);
      backgrounds.appendChild(background);
      const track = document.createElement('div');
      track.className = 'tree__generation-label-track';
      track.dataset.gen = String(band.gen);
      if (band.uncertain) track.dataset.uncertain = 'true';
      track.dataset.tone = String(tone);
      Object.assign(track.style, position);
      const label = document.createElement('span');
      label.className = 'tree__generation-label';
      label.textContent = band.uncertain ? '未確定' : `第${band.gen}代`;
      track.appendChild(label);
      labels.appendChild(track);
    }
    return { backgrounds, labels, bands };
  }

  return { calculate, render };
});
