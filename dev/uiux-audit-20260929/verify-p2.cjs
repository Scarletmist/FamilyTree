const assert = require('node:assert/strict');

const CDP_PORT = Number(process.env.CDP_PORT || 43272);
const APP_PORT = Number(process.env.APP_PORT || 43271);
const appUrl = 'http://127.0.0.1:' + APP_PORT + '/family-tree.html';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function targetInfo() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list').then(r => r.json());
      const target = targets.find(item => item.type === 'page' && item.url.startsWith(appUrl));
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await sleep(100);
  }
  throw new Error('找不到 FamilyTree Edge CDP target。');
}

class Client {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
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
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluate failed');
    return result.result.value;
  }
  async waitFor(expression, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await this.evaluate('Boolean(' + expression + ')')) return;
      await sleep(50);
    }
    throw new Error('等待逾時：' + expression);
  }
  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await this.send('Page.reload', { ignoreCache: true });
    await this.waitFor("document.readyState === 'complete' && window.FamilyApp?.graph?.()?.people?.length > 0 && document.querySelectorAll('.person').length > 0");
    await sleep(350);
  }
  close() { this.socket?.close(); }
}

(async () => {
  const client = new Client((await targetInfo()).webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.viewport(1440, 900);
    const desktop = await client.evaluate(`(() => {
      const p1=document.querySelector('.person[data-person-id="p1"]');
      const legend=document.querySelector('.legend-panel');
      return {legendOpen:legend.open,card:p1.textContent,workspace:document.querySelector('.tree').getBoundingClientRect().height};
    })()`);
    assert.equal(desktop.legendOpen, false, desktop);
    assert(!desktop.card.includes('未填寫'), desktop);
    console.log('P2 desktop', desktop);

    await client.viewport(390, 844);
    await client.evaluate("document.getElementById('add-member').click()");
    await client.waitFor("document.getElementById('member-dialog').open");
    const form = await client.evaluate(`(() => {
      const dialog=document.getElementById('member-dialog');
      const scroll=dialog.querySelector('.form-scroll').getBoundingClientRect();
      const relations=dialog.querySelector('.member-relations-section').getBoundingClientRect();
      const optional=dialog.querySelector('.member-optional-fields');
      const ranking=dialog.querySelector('.member-ranking-fields');
      return {
        optionalOpen:optional.open,rankingOpen:ranking.open,
        relationsTop:relations.top,relationsBottom:relations.bottom,
        scrollTop:scroll.top,scrollBottom:scroll.bottom,
        relationVisible:relations.top < scroll.bottom && relations.bottom > scroll.top,
        optionalSummary:optional.querySelector('summary').textContent.trim()
      };
    })()`);
    assert.equal(form.optionalOpen, false, form);
    assert.equal(form.rankingOpen, false, form);
    assert.equal(form.relationVisible, true, form);
    assert(form.relationsTop < 500, form);
    console.log('P2 mobile form', form);
    await client.evaluate("document.getElementById('member-dialog').close()");

    const toolbar = await client.evaluate(`(() => {
      const controls=document.querySelector('.tree-controls');
      const show=id=>getComputedStyle(document.getElementById(id)).display!=='none';
      const text=id=>document.getElementById(id).innerText.trim();
      return {client:controls.clientWidth,scroll:controls.scrollWidth,cloud:show('cloud-sync'),members:text('show-member-list'),add:text('add-member'),more:text('portrait-more-open')};
    })()`);
    assert.equal(toolbar.cloud, false, toolbar);
    assert(toolbar.scroll <= toolbar.client + 1, toolbar);
    assert(toolbar.members.includes('成員') && toolbar.add.includes('新增') && toolbar.more.includes('更多'), toolbar);
    console.log('P2 mobile toolbar', toolbar);

    await client.evaluate("document.getElementById('portrait-more-open').click()");
    await client.waitFor("document.getElementById('landscape-more-sheet').open");
    const more = await client.evaluate(`(() => {
      const cloud=document.querySelector('#landscape-more-sheet [data-action="cloud"]');
      return {cloudVisible:getComputedStyle(cloud).display!=='none',cloudText:cloud.textContent.trim()};
    })()`);
    assert.equal(more.cloudVisible, true, more);
    assert(more.cloudText.includes('Google Drive'), more);
    console.log('P2 mobile more', more);
    await client.evaluate("document.getElementById('landscape-more-sheet').close()");

    await client.evaluate("document.getElementById('show-member-list').click()");
    await client.waitFor("document.getElementById('member-list-dialog').open");
    const list = await client.evaluate(`(() => {
      const row=document.querySelector('tr[data-person-id="p1"]');
      const loc=row.querySelector('td[data-label="所在地"]');
      const pos=row.querySelector('td[data-label="職位"]');
      return {locationDisplay:getComputedStyle(loc).display,positionDisplay:getComputedStyle(pos).display,rowText:row.innerText};
    })()`);
    assert.equal(list.locationDisplay, 'none', list);
    assert.equal(list.positionDisplay, 'none', list);
    console.log('P2 mobile list', list);
    await client.evaluate("document.getElementById('member-list-dialog').close()");

    await client.evaluate("window.editFamilyMember('p8')");
    await client.waitFor("document.getElementById('member-dialog').open");
    const editOptional = await client.evaluate("document.querySelector('#member-dialog .member-optional-fields').open");
    assert.equal(editOptional, true);
    await client.evaluate("document.getElementById('member-dialog').close()");

    const query = await client.evaluate(`(() => {
      const set=(id,value)=>{const s=document.getElementById(id);s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));};
      set('relationship-b','p1'); set('relationship-a','p3');
      const a=document.getElementById('relationship-a'),b=document.getElementById('relationship-b');
      return {aText:a.selectedOptions[0].textContent,bText:b.selectedOptions[0].textContent,hint:document.querySelector('.relationship-direction').textContent};
    })()`);
    assert(query.aText.includes('第 ') && query.bText.includes('第 '), query);
    assert(query.hint.includes('陳文彬') && query.hint.includes('陳阿土') && !query.hint.includes('A 是 B'), query);
    console.log('P2 query labels', query);

    await client.evaluate("document.querySelector('.person[data-person-id=\"p1\"]').click()");
    await client.waitFor("document.getElementById('relationship-details').hidden === false");
    await client.evaluate("(() => { const panel=document.getElementById('relationship-details'); if(panel.dataset.collapsed==='true') panel.querySelector('.relationship-details__tab')?.click(); })()");
    await client.waitFor("document.querySelector('#relationship-details .relationship-details__top')?.getBoundingClientRect().height > 0");
    const details = await client.evaluate(`(() => {
      const panel=document.getElementById('relationship-details');
      const top=panel.querySelector('.relationship-details__top').getBoundingClientRect();
      const visible=selector=>{const e=panel.querySelector(selector);return !!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;};
      return {topHeight:top.height,editLabel:visible('.edit-member .details-action__label'),addLabel:visible('.add-relative .details-action__label'),more:visible('.relationship-details__more-summary'),query:visible('.query-relationship'),locate:visible('.details-locate')};
    })()`);
    console.log('P2 member details collapsed', details);
    assert(details.topHeight <= 120 && details.editLabel && details.addLabel && details.more, JSON.stringify(details));
    assert.equal(details.query, false, details); assert.equal(details.locate, false, details);
    await client.evaluate("document.querySelector('#relationship-details .relationship-details__more-summary').click()");
    const detailMore = await client.evaluate(`(() => { const panel=document.getElementById('relationship-details'); const visible=s=>{const e=panel.querySelector(s);return !!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0;}; return {query:visible('.query-relationship'),locate:visible('.details-locate')}; })()`);
    assert(detailMore.query && detailMore.locate, detailMore);
    console.log('P2 member details', {details,detailMore});

    await client.viewport(844, 390);
    const landscape = await client.evaluate(`(() => {
      const tree=document.querySelector('.tree').getBoundingClientRect();
      const cloud=document.getElementById('cloud-sync');
      const more=document.getElementById('landscape-more-open');
      return {treeHeight:tree.height,cloudDisplay:getComputedStyle(cloud).display,moreDisplay:getComputedStyle(more).display};
    })()`);
    assert(landscape.treeHeight >= 300, landscape);
    assert.equal(landscape.cloudDisplay, 'none', landscape);
    assert.notEqual(landscape.moreDisplay, 'none', landscape);
    await client.evaluate("document.getElementById('landscape-more-open').click()");
    await client.waitFor("document.getElementById('landscape-more-sheet').open");
    const landscapeCloud = await client.evaluate("getComputedStyle(document.querySelector('#landscape-more-sheet [data-action=\"cloud\"]')).display");
    assert.notEqual(landscapeCloud, 'none');
    console.log('P2 landscape', landscape);

    console.log('P2 browser verification PASS');
  } finally {
    client.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
