import { STYLES } from './family-tree-renderer.mjs';
export const escapeText = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const round = n => Math.round(n * 100) / 100;
export function wrapText(text,width,size = 16) {
  // Full text is always retained. The same conservative wrapping is used by
  // the measured HTML cards and portable SVG text; no ellipsis is exported.
  const lines = []; let line = '',used = 0;
  for (const char of String(text)) {
    const step = /[\u0000-\u00ff]/.test(char) ? size * .62 : size;
    if (char === '\n') {lines.push(line);line = '';used = 0;continue;}
    if (line && used + step > width) {lines.push(line);line = '';used = 0;}
    line += char; used += step;
  }
  lines.push(line); return lines;
}
function shapeMarkup(shape) {
  const attributes = Object.entries(shape.attrs).map(([k,v]) => `${k}="${escapeText(v)}"`).join(' ');
  const style = shape.tag === 'text' ? ' font-size="16" font-weight="500" stroke="#fbf8f3" stroke-width="4" paint-order="stroke"' : '';
  return `<${shape.tag} ${attributes}${style}>${escapeText(shape.text || '')}${(shape.children || []).map(shapeMarkup).join('')}</${shape.tag}>`;
}
const intersects = (a,b) => a.x + a.width >= b.x && a.x <= b.x + b.width && a.y + a.height >= b.y && a.y <= b.y + b.height;
export function diagramMarkup(scene,tile = {x:0,y:0,width:scene.width,height:scene.height}) {
  const backgrounds = scene.bands.filter(b => b.top + b.height >= tile.y && b.top <= tile.y + tile.height).map(b => {
    const top = Math.max(b.top,tile.y),bottom = Math.min(b.top + b.height,tile.y + tile.height);
    const label = bottom - top >= 40 ? `<text x="12" y="${round(top + 28)}" font-size="16" fill="#706354">${b.uncertain ? '未確定' : `第${b.gen}代`}</text>` : '';
    return `<rect x="0" y="${round(b.top)}" width="${round(scene.width)}" height="${round(b.height)}" fill="${b.gen % 2 ? '#faf7f1' : '#f4eee5'}"/>${label}`;
  }).join('');
  const cards = scene.nodes.filter(n => intersects(n,tile)).map(n => {
    let y = n.y + 24;
    const text = n.lines.map(line => wrapText(line.text,n.width - 24,line.size).map(value => {
      const out = `<text x="${round(n.x + 12)}" y="${round(y)}" font-size="${line.size}" font-weight="${line.bold ? 600 : 400}" fill="${line.color}">${escapeText(value)}</text>`;
      y += line.size * 1.4; return out;
    }).join('')).join('');
    return `<rect x="${round(n.x)}" y="${round(n.y)}" width="${round(n.width)}" height="${round(n.height)}" rx="10" fill="#fffdf9" stroke="${n.archived ? '#a38b70' : '#c9bba6'}" stroke-width="1.5"/>${text}`;
  }).join('');
  const placeholders = scene.placeholders.filter(n => intersects(n,tile)).map(n => `<rect x="${round(n.x)}" y="${round(n.y)}" width="${round(n.width)}" height="${round(n.height)}" rx="6" fill="#fffaf0" stroke="#aa9376" stroke-dasharray="4 3"/><text x="${round(n.x + 4)}" y="${round(n.y + n.height / 2 + 6)}" font-size="16">待補</text>`).join('');
  return `<g font-family="'Microsoft JhengHei','Noto Sans CJK TC',sans-serif">${backgrounds}${scene.shapes.filter(s => !s.bounds || intersects(s.bounds,tile)).map(shapeMarkup).join('')}${cards}${placeholders}</g>`;
}
export function legendMarkup(x,y) {
  const kinds = ['spouse','親生','養子女','過繼','手足','堂親','表親','師徒'];
  return kinds.map((kind,i) => {const s = STYLES[kind],left = x + i % 4 * 180,top = y + Math.floor(i / 4) * 30;
    return `<path d="M ${left} ${top} h 30" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/><text x="${left + 40}" y="${top + 6}" font-size="16">${kind === 'spouse' ? '婚姻' : kind}</text>`;}).join('') + `<text x="${x}" y="${y + 70}" font-size="16">推導：由既有關係辨別 · 已封存／銜接人物會標示在卡片</text>`;
}
export function svgHeaderHeight(scene,title) {
  return 184 + Math.max(0,wrapText(title,Math.max(760,scene.width) - 48,24).length - 1) * 34;
}
export function serializeSVG(scene,{title = '家族族譜',scope = '全圖',appendix = []} = {}) {
  const width = Math.max(760,scene.width),header = svgHeaderHeight(scene,title);
  const titleLines = wrapText(title,width - 48,24),titleExtra = (titleLines.length - 1) * 34;
  const titleMarkup = titleLines.map((line,i) => `<text x="24" y="${36 + i * 34}" font-size="24" font-weight="600">${escapeText(line)}</text>`).join('');
  const records = []; let appendixHeight = 0;
  for (const record of appendix) for (const value of [record.label,'來源：' + record.source,...(record.note ? ['說明：' + record.note] : [])]) {
    for (const line of wrapText(value,width - 48,16)) {records.push(`<text x="24" y="${scene.height + header + 48 + appendixHeight}" font-size="16">${escapeText(line)}</text>`);appendixHeight += 24;}
    appendixHeight += 8;
  }
  const height = header + scene.height + (appendix.length ? appendixHeight + 80 : 24);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" role="img"><title>${escapeText(title)}</title><rect width="100%" height="100%" fill="#fffdf9"/><g font-family="'Microsoft JhengHei','Noto Sans CJK TC',sans-serif" fill="#302c27">${titleMarkup}<text x="24" y="${64 + titleExtra}" font-size="16">${escapeText(scope)} · ${scene.nodes.length} 位成員</text>${legendMarkup(24,88 + titleExtra)}<g transform="translate(0 ${header})">${diagramMarkup(scene)}</g>${appendix.length ? `<text x="24" y="${header + scene.height + 24}" font-size="20">關係來源與說明</text>${records.join('')}` : ''}</g></svg>`;
}

const PAPER = {A4:[210,297],A3:[297,420]};
export function paginateScene(scene,{paper = 'A4',orientation = 'landscape',title = '家族族譜'} = {}) {
  let [w,h] = PAPER[paper] || PAPER.A4; if (orientation === 'landscape') [w,h] = [h,w];
  const px = 96 / 25.4,width = (w - 24) * px;
  const headerHeight = Math.max(18,(wrapText(title,width,24).length * 36 + 32) / px);
  const height = (h - 24 - headerHeight - 12) * px,overlap = 32;
  const axis = (total,span,dimension) => {
    const tiles = []; let start = 0;
    while (true) {
      let end = Math.min(total,start + span);
      if (end < total) {
        // Move a page boundary earlier when that leaves every card intact.
        const candidates = scene.nodes.map(n => n[dimension] - 8).filter(c => c >= start + span * .6 && c <= end).sort((a,b) => b - a);
        const size = dimension === 'x' ? 'width' : 'height';
        const safe = candidates.find(c => scene.nodes.every(n => !(n[dimension] < c && n[dimension] + n[size] > c)));
        if (safe !== undefined) end = safe;
      }
      tiles.push({start,end}); if (end >= total) break;
      let next = Math.max(start + 1,end - overlap);
      const size = dimension === 'x' ? 'width' : 'height';
      const crossing = scene.nodes.filter(n => n[dimension] < next && n[dimension] + n[size] > next);
      if (crossing.length) {
        const earlier = Math.min(...crossing.map(n => n[dimension] - 8));
        if (earlier > start + span * .5) next = earlier;
      }
      start = next;
    }
    return tiles;
  };
  const xs = axis(scene.width,width,'x'),ys = axis(scene.height,height,'y'),pages = [];
  ys.forEach((row,r) => xs.forEach((col,c) => pages.push({number:pages.length + 1,row:r + 1,col:c + 1,
    x:col.start,y:row.start,width:col.end - col.start,height:row.end - row.start})));
  // Omit pages containing only generation backgrounds. Unmeasured external
  // shapes retain the full grid because their visible extent is unknown.
  const unknownGeometry = scene.shapes.some(s => s.tag !== 'defs' && !s.bounds);
  const content = [...scene.nodes,...scene.placeholders,...scene.shapes.filter(s => s.bounds).map(s => s.bounds)];
  if (!unknownGeometry && content.length) {
    const retained = pages.filter(page => content.some(box => intersects(box,page)));
    pages.splice(0,pages.length,...retained);
  }
  const byRow = new Map(),byCol = new Map();
  pages.forEach((page,i) => {
    page.number = i + 1;page.continues = {left:null,right:null,up:null,down:null};
    if (!byRow.has(page.row)) byRow.set(page.row,[]);
    if (!byCol.has(page.col)) byCol.set(page.col,[]);
    byRow.get(page.row).push(page);byCol.get(page.col).push(page);
    page.cutCards = scene.nodes.filter(n => intersects(n,page) && (n.x < page.x || n.y < page.y || n.x + n.width > page.x + page.width || n.y + n.height > page.y + page.height)).length;
  });
  for (const row of byRow.values()) row.forEach((page,i) => {page.continues.left = row[i-1]?.number ?? null;page.continues.right = row[i+1]?.number ?? null;});
  for (const col of byCol.values()) col.forEach((page,i) => {page.continues.up = col[i-1]?.number ?? null;page.continues.down = col[i+1]?.number ?? null;});
  return {pages,rows:ys.length,cols:xs.length,paper,orientation,paperWidth:w,paperHeight:h,chartWidth:width,chartHeight:height,headerHeight};
}
export function printDocument(scene,options) {
  const pagination = paginateScene(scene,options),{title = '家族族譜',scope = '全圖',appendix = []} = options;
  const {paperWidth:w,paperHeight:h,chartWidth,chartHeight,pages} = pagination;
  const printTitle = wrapText(title,chartWidth,24).map(escapeText).join('<br>');
  const indexColumns = Math.min(pagination.cols,4),indexChunks = [];
  const titleExtraMm = pagination.headerHeight - 18;
  const firstCount = Math.max(indexColumns,Math.floor((h - 24 - 132 - titleExtraMm) / 16) * indexColumns);
  const laterCount = Math.max(indexColumns,Math.floor((h - 24 - 28 - titleExtraMm) / 16) * indexColumns);
  let offset = 0;
  while (offset < pages.length) {
    const limit = indexChunks.length ? laterCount : firstCount;
    indexChunks.push(pages.slice(offset,offset + limit).map(p => `<a href="#page-${p.number}" class="index-cell">第 ${p.number} 頁 <small>（${p.row}列 ${p.col}欄）</small></a>`).join(''));
    offset += limit;
  }
  const tiles = pages.map(p => {
    const links = Object.entries(p.continues).filter(([,n]) => n).map(([direction,n]) => `<a href="#page-${n}">${({left:'← 左',right:'右 →',up:'↑ 上',down:'下 ↓'})[direction]}續第 ${n} 頁</a>`).join(' · ');
    return `<section class="print-page" id="page-${p.number}"><header><h1>${printTitle}</h1><p>${escapeText(scope)} · 第 ${p.row} 列／第 ${p.col} 欄</p></header><svg xmlns="http://www.w3.org/2000/svg" width="${p.width}" height="${p.height}" viewBox="${p.x} ${p.y} ${p.width} ${p.height}" role="img" aria-label="族譜第 ${p.number} 頁">${diagramMarkup(scene,p)}</svg><footer>第 ${p.number}／${pages.length} 頁 · ${links}${p.cutCards ? ' · 邊界人物請對照相鄰頁（重疊至少 32px）' : ''}</footer></section>`;
  }).join('');
  const indexPages = indexChunks.map((cells,index) => `<section class="print-page print-index"><h1>${printTitle}</h1>${index ? '<p>頁面索引（續）</p>' : ''}<p>${escapeText(scope)} · ${scene.nodes.length} 位成員 · ${pagination.rows} 列 × ${pagination.cols} 欄</p>${index === 0 ? `<p>頁面由左至右、由上至下排列，空白區域略過；以頁碼和接續標記連接，正文至少 12pt。</p><div class="index-map"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}"><rect width="100%" height="100%" fill="#faf7f1"/>${scene.nodes.map(n => `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" fill="#c8b699"/>`).join('')}${pages.map(p => `<rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="none" stroke="#655743" stroke-width="3"/>`).join('')}</svg></div>` : ''}<div class="index-grid">${cells}</div>${index === 0 ? `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(720,chartWidth)}" height="100" viewBox="0 0 ${Math.min(720,chartWidth)} 100">${legendMarkup(0,12)}</svg>` : ''}</section>`).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>
    @page{size:${w}mm ${h}mm;margin:12mm}*{box-sizing:border-box}body{margin:0;color:#302c27;font-family:'Microsoft JhengHei','Noto Sans CJK TC',sans-serif;font-size:12pt;line-height:1.5;background:#e9e5df}h1{font-size:18pt;margin:0}h2{font-size:16pt}p{margin:4px 0}a{color:inherit}svg{display:block;max-width:none} .print-page{width:${w - 24}mm;height:${h - 24}mm;background:white;position:relative;break-after:page;overflow:hidden;margin:20px auto;padding:0}header{height:${pagination.headerHeight}mm}footer{font-size:12pt;position:absolute;bottom:0;left:0;right:0}.print-index{padding:8mm;height:auto;min-height:${h - 24}mm}.index-grid{display:grid;gap:8px;grid-template-columns:repeat(${indexColumns},minmax(0,1fr));margin:20px 0}.index-cell{border:1px solid #b8ab98;padding:8px;text-align:center;font-size:12pt}.index-cell small{display:block;font-size:12pt;line-height:1.25}.index-map{position:relative}.index-map svg{width:100%;height:65mm}.appendix{width:${w - 24}mm;margin:20px auto;background:white;padding:0;overflow-wrap:anywhere}.appendix article{margin-bottom:8mm}.print-toolbar{position:sticky;top:0;background:#fff;padding:12px;z-index:2;display:flex;gap:16px;align-items:center}.print-toolbar button{font:inherit;padding:8px 18px;min-height:44px}.print-page:last-child{break-after:auto}@media print{body{background:white}.print-toolbar{display:none}.print-page,.appendix{margin:0}.print-page{break-inside:avoid}.print-index{height:${h - 24}mm;min-height:0;padding:0}.index-grid{gap:4px}.appendix{break-before:page}}
    .print-toolbar{flex-wrap:wrap;gap:8px 16px}.print-toolbar button{display:inline-flex;align-items:center;gap:8px;flex:none;white-space:nowrap}.print-toolbar button svg{width:20px;height:20px;flex:none}.print-toolbar>span{flex:1 1 260px}@media(max-width:700px){.print-toolbar>span{flex-basis:100%}.print-toolbar button svg{display:none}}
    </style></head><body><div class="print-toolbar"><button type="button" id="print-document" aria-label="列印或另存PDF"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h.01" /></svg>列印／PDF</button><span>請使用 100% 比例，關閉瀏覽器頁首與頁尾。</span></div>${indexPages}${tiles}${appendix.length ? `<section class="appendix"><h2>關係來源與說明</h2>${appendix.map(r => `<article><strong>${escapeText(r.label)}</strong><p>來源：${escapeText(r.source)}</p>${r.note ? `<p>說明：${escapeText(r.note)}</p>` : ''}</article>`).join('')}</section>` : ''}</body></html>`;
}
