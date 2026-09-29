export const NS = 'http://www.w3.org/2000/svg';

export const STYLES = {
  spouse: { color: '#aa3d55', width: 6, double: true, label: '婚姻 · 雙線' },
  family: { color: '#59616c', width: 2, label: '共同父母／手足 · 分叉線' },
  親生: { color: '#347045', width: 2.5, end: 'triangle', label: '親生 · 實線箭頭' },
  過繼: { color: '#b15a15', width: 2.5, dash: '12 5', end: 'diamond', label: '過繼 · 長虛線菱形' },
  養子女: { color: '#2963a3', width: 2.5, dash: '6 4', end: 'circle', label: '養子女 · 短虛線空心圓' },
  義子女: { color: '#854791', width: 2.5, dash: '10 4 2 4', end: 'square', label: '義子女 · 點劃線方形' },
  契子女: { color: '#187e80', width: 3, dash: '1 6', end: 'circle', label: '契子女 · 點線空心圓' },
  手足: { color: '#59616c', width: 2, both: true, end: 'circle', label: '手足 · 雙端空心圓' },
  契手足: { color: '#765138', width: 2.5, dash: '8 4 2 4', end: 'diamond', both: true, label: '契手足 · 雙端菱形' },
  師兄弟姊妹: { color: '#247c86', width: 2.5, dash: '5 4', both: true, end: 'square', label: '師兄弟姊妹 · 雙端方形虛線' },
  堂親: { color: '#a06a20', width: 2.5, dash: '10 5', end: 'diamond', both: true, label: '堂親（直接設定）· 雙端菱形長虛線' },
  表親: { color: '#a04476', width: 2.5, dash: '3 5', end: 'diamond', both: true, label: '表親（直接設定）· 雙端菱形短虛線' },
  師徒: { color: '#1756b0', width: 3, end: 'arrow', label: '師徒 · 師父 → 徒弟' },
  unknown: { color: '#666666', width: 2, dash: '12 2 2 2', label: '未知關係' }
};

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function svgElement(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

export function addMarkers(svg, prefix) {
  const defs = svgElement('defs');
  Object.entries(STYLES).forEach(([kind, style]) => {
    if (!style.end) return;
    const marker = svgElement('marker', {
      id: prefix + kind,
      viewBox: '0 0 12 12',
      refX: 10,
      refY: 6,
      markerWidth: 6,
      markerHeight: 6,
      orient: 'auto-start-reverse'
    });
    const shape = style.end === 'circle'
      ? svgElement('circle', { cx: 6, cy: 6, r: 4, fill: '#fbf8f3', stroke: style.color, 'stroke-width': 2 })
      : svgElement('path', {
          d: style.end === 'diamond'
            ? 'M 1 6 L 6 1 L 11 6 L 6 11 Z'
            : style.end === 'square'
              ? 'M 2 2 H 10 V 10 H 2 Z'
              : style.end === 'arrow'
                ? 'M 1 1 L 11 6 L 1 11 L 4 6 Z'
                : 'M 1 1 L 11 6 L 1 11 Z',
          fill: style.color
        });
    marker.appendChild(shape);
    defs.appendChild(marker);
  });
  svg.appendChild(defs);
}

export function applyStyle(node, kind, prefix) {
  const style = STYLES[kind] || STYLES.unknown;
  node.setAttribute('stroke', style.color);
  node.setAttribute('stroke-width', style.width);
  node.setAttribute('stroke-linecap', 'round');
  if (style.dash) node.setAttribute('stroke-dasharray', style.dash);
  if (style.end) node.setAttribute('marker-end', `url(#${prefix}${kind})`);
  if (style.both) node.setAttribute('marker-start', `url(#${prefix}${kind})`);
}

export function buildLegend() {
  const legend = document.getElementById('relationship-legend');
  if (!legend || legend.children.length) return;
  Object.entries(STYLES).filter(([kind]) => kind !== 'unknown').forEach(([kind, style], index) => {
    const item = element('span', 'legend__item');
    const svg = svgElement('svg', { viewBox: '0 0 64 24', 'aria-hidden': 'true' });
    const prefix = `legend-${index}-`;
    addMarkers(svg, prefix);
    const line = svgElement('path', {
      d: kind === 'family' ? 'M 32 2 V 10 M 8 21 V 10 H 56 V 21' : 'M 8 12 H 55',
      fill: 'none'
    });
    applyStyle(line, kind, prefix);
    svg.appendChild(line);
    if (style.double) svg.appendChild(svgElement('path', { d: 'M 8 12 H 55', stroke: '#fff', 'stroke-width': 2 }));
    item.append(svg, element('span', '', style.label));
    legend.appendChild(item);
  });
}
