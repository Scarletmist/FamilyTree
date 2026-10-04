(() => {
  const preview = document.querySelector('#preview'), wrap = document.querySelector('#device-wrap'), stage = document.querySelector('.review-stage');
  const sizes = { portrait:[390,844,'直式'], landscape:[844,390,'橫式'], small:[320,740,'小尺寸'] };
  const descriptions = { browse:['瀏覽族譜，也讀得清楚','面板保留背景脈絡，頂部只固定精簡導覽。'], read:['讓資料成為畫面主角','完整閱讀暫停背景操作；縮回面板即可接續族譜瀏覽。'], compact:['留下一個清楚的入口','姓名與關係摘要留在畫面，點擊即可恢復較大的瀏覽面板。'] };
  let device = 'portrait', mode = 'browse';
  function resize() {
    const [width,height,label] = sizes[device];
    stage.dataset.device = device;
    const available = innerWidth > 1050 || device !== 'landscape' && innerWidth > 650 ? innerWidth - 350 : innerWidth - 32;
    const scale = Math.min(1, Math.max(180,available) / width);
    wrap.style.width = width * scale + 'px'; wrap.style.height = height * scale + 'px';
    preview.style.width = width + 'px'; preview.style.height = height + 'px'; preview.style.transform = 'scale(' + scale + ')';
    document.querySelector('#size-label').textContent = width + ' × ' + height + ' · ' + label;
    document.querySelector('#comparison').textContent = device === 'landscape' ? '原版同尺寸：約 83px' : device === 'portrait' ? '原版同尺寸：約 159px' : '檢查窄螢幕與長文字';
  }
  function displayMode(value) {
    mode = value; document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mode === mode)));
    document.querySelector('#mode-title').textContent = descriptions[mode][0];
    document.querySelector('#mode-description').textContent = descriptions[mode][1];
  }
  document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click',() => { device = button.dataset.device; document.querySelectorAll('[data-device]').forEach(item => item.setAttribute('aria-pressed',String(item === button))); resize(); }));
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click',() => { displayMode(button.dataset.mode); preview.contentWindow.postMessage({type:'detail-template-mode',mode},location.origin); }));
  addEventListener('message',event => { if(event.origin !== location.origin || event.source !== preview.contentWindow || event.data.type !== 'detail-template-state') return; displayMode(event.data.mode); document.querySelector('#content-height').textContent = event.data.height ? event.data.height + 'px' : '已收合'; });
  addEventListener('resize',resize); resize();
})();
