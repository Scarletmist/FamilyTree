const assert = require('node:assert/strict');

const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const APP_PORT = Number(process.env.APP_PORT || 4191);
const appUrl = 'http://127.0.0.1:' + APP_PORT + '/family-tree.html';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function targetInfo() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const targets = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list').then(r => r.json());
      const target = targets.find(item => item.type === 'page' && item.url.startsWith(appUrl));
      if (target && target.webSocketDebuggerUrl) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error('找不到 FamilyTree Edge CDP target。');
}

class Client {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return promise;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text || 'Browser evaluate failed');
    }
    return result.result.value;
  }

  async waitFor(expression, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.evaluate('Boolean(' + expression + ')')) return;
      await sleep(50);
    }
    throw new Error('等待逾時：' + expression);
  }

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height
    });
    await this.send('Page.reload', { ignoreCache: true });
    await this.waitFor("document.readyState === 'complete' && window.FamilyApp?.graph?.()?.people?.length > 0 && document.querySelectorAll('.person').length > 0", 10000);
    await sleep(300);
  }

  close() {
    if (this.socket) this.socket.close();
  }
}

(async () => {
  const client = new Client((await targetInfo()).webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.viewport(1440, 900);
    await client.evaluate("document.getElementById('show-member-list').click()");
    await client.waitFor("document.querySelector('tr[data-person-id=\"p1\"]')");
    const generation = await client.evaluate("(() => { const memberRow=document.querySelector('tr[data-person-id=\"p1\"]'); const person=document.querySelector('.person[data-person-id=\"p1\"]'); const graph=FamilyApp.graph(); return {list:memberRow && memberRow.querySelector('td[data-label=\"代別\"]') && memberRow.querySelector('td[data-label=\"代別\"]').textContent.trim(), canvas:Number(person && person.closest('.generation') && person.closest('.generation').dataset.gen), offset:FamilyDisplayProjection.generationOffset(graph)}; })()");
    assert.equal(generation.list, '第 ' + generation.canvas + ' 代');
    assert.equal(generation.canvas, generation.offset + 1);
    console.log('P1-1 generation', generation);

    await client.viewport(390, 844);
    await client.evaluate("document.getElementById('mobile-tree-fit').click()");
    await sleep(500);
    const beforeQuery = await client.evaluate("(() => { const view=document.querySelector('.tree'); view.scrollLeft=Math.min(view.scrollWidth-view.clientWidth,42); view.scrollTop=Math.min(view.scrollHeight-view.clientHeight,37); const scale=new DOMMatrix(getComputedStyle(document.getElementById('tree-canvas')).transform).a; return {scale,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop}; })()");

    await client.evaluate("(() => { const set=(id,value)=>{ const select=document.getElementById(id); select.value=value; select.dispatchEvent(new Event('change',{bubbles:true})); }; set('relationship-a','p1'); set('relationship-b','p3'); document.getElementById('relationship-search').requestSubmit(); })()");
    await client.waitFor("document.getElementById('relationship-summary').hidden === false");
    await sleep(700);

    const query = await client.evaluate("(() => { const view=document.querySelector('.tree'); const summary=document.getElementById('relationship-summary').getBoundingClientRect(); const scale=new DOMMatrix(getComputedStyle(document.getElementById('tree-canvas')).transform).a; const nodes=['p1','p3'].map(id=>{ const r=document.querySelector('.person[data-person-id=\"'+id+'\"]').getBoundingClientRect(); return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight,overlapsSummary:!(r.right<=summary.left||r.left>=summary.right||r.bottom<=summary.top||r.top>=summary.bottom)}; }); return {scale,summary:{left:summary.left,right:summary.right,top:summary.top,bottom:summary.bottom},nodes,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop}; })()");
    assert.ok(beforeQuery.scale <= 0.45, beforeQuery);
    assert.ok(query.scale >= 0.65, query);
    assert.ok(query.nodes.every(node => node.visible), query);
    assert.ok(query.nodes.every(node => !node.overlapsSummary), query);
    console.log('P1-2 query', { beforeQuery, query });

    await client.evaluate("document.getElementById('relationship-reset').click()");
    await sleep(500);
    const restored = await client.evaluate("(() => { const view=document.querySelector('.tree'); return {scale:new DOMMatrix(getComputedStyle(document.getElementById('tree-canvas')).transform).a,scrollLeft:view.scrollLeft,scrollTop:view.scrollTop,summaryHidden:document.getElementById('relationship-summary').hidden}; })()");
    assert.ok(Math.abs(restored.scale - beforeQuery.scale) < 0.01, { beforeQuery, restored });
    assert.ok(Math.abs(restored.scrollLeft - beforeQuery.scrollLeft) <= 2, { beforeQuery, restored });
    assert.ok(Math.abs(restored.scrollTop - beforeQuery.scrollTop) <= 2, { beforeQuery, restored });
    assert.equal(restored.summaryHidden, true);
    console.log('P1-2 restore', restored);

    await client.viewport(844, 390);
    const compact = await client.evaluate("(() => { const tree=document.querySelector('.tree').getBoundingClientRect(); const header=document.querySelector('.page-header').getBoundingClientRect(); const legend=document.querySelector('.legend-panel'); const search=document.getElementById('relationship-search'); return {pointerFine:matchMedia('(pointer:fine)').matches,compactMedia:matchMedia('(max-width:950px) and (max-height:520px)').matches,treeHeight:tree.height,treeTop:tree.top,headerBottom:header.bottom,legendDisplay:getComputedStyle(legend).display,searchDisplay:getComputedStyle(search).display}; })()");
    assert.equal(compact.pointerFine, true, compact);
    assert.equal(compact.compactMedia, true, compact);
    assert.ok(compact.treeHeight >= 300, compact);
    assert.equal(compact.legendDisplay, 'none', compact);
    console.log('P1-3 compact', compact);
  } finally {
    client.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
