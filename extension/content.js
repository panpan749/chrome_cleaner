(() => {
  const popup = document.documentElement.hasAttribute('data-fish-popup');
  if (document.getElementById('plump-fish-widget')) return;
  const host = document.createElement('div'); host.id = 'plump-fish-widget';
  host.style.cssText = popup ? 'display:block;' : 'all:initial;position:fixed;top:8px;right:14px;width:184px;height:132px;z-index:2147483646;pointer-events:none;color-scheme:light;';
  // Keep cross-tab titles and controls private from the host website.
  const shadow = host.attachShadow({ mode: popup ? 'open' : 'closed' });
  for (const type of ['click','change','input','keydown','pointerdown','pointermove','pointerup','pointercancel']) {
    shadow.addEventListener(type, event => { if (!event.isTrusted) event.stopImmediatePropagation(); }, true);
  }
  const paths = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>', arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
    down: '<path d="m7 9 5 5 5-5"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  shadow.innerHTML = `<section class="fish-home ${popup ? 'popup-mode' : ''}" aria-label="大肥鱼标签桌宠">
    <div class="stage"><button class="pet" type="button" aria-label="大肥鱼：点击整理，拖动移动" title="点击整理闲置标签；按住拖动可移动桌宠和垃圾桶"><span class="sprite"></span></button>
      <span class="carried-tab" hidden><span class="tab-dot"></span><span class="carried-title"></span><span>×</span></span>
      <button class="bin" type="button" aria-label="打开垃圾桶" aria-expanded="false" title="点击打开垃圾桶；按住拖动可整体移动"><span class="bin-lid"></span><span class="bin-body"><span></span><span></span><span></span></span><span class="bin-count" hidden>0</span></button>
      <div class="quick-controls"><label class="quick-protection" title="保护当前页：打开后不会自动收纳">${icon('shield')}<input class="protect-switch quick-switch" type="checkbox" role="switch" aria-label="当前页面加入白名单"></label><button class="drawer-handle" type="button" aria-label="展开保护说明与设置" aria-expanded="false" title="保护说明与配置">${icon('down')}</button></div>
      <div class="speech" role="status" hidden></div></div>
    <section class="whitelist-drawer" aria-label="当前页保护说明" hidden><div class="drawer-top"><span>${icon('shield')}保护这个页面</span><input class="protect-switch drawer-switch" type="checkbox" role="switch" aria-label="当前页面加入白名单" ${popup ? '' : 'hidden'}></div><p class="protect-help">打开后，大肥鱼就不会收走这个标签。</p><div class="drawer-bottom"><span class="running-label">每隔一分钟，悄悄巡视</span><button class="settings-button" aria-label="打开配置页面" title="配置">${icon('settings')}</button></div></section>
    <section class="trash-panel" aria-label="垃圾桶中的标签" hidden><header class="trash-header"><div><h2>大肥鱼的垃圾桶 <span class="total">0</span></h2><p>点一个标签，就还给你。</p></div><button class="close-panel icon-button" aria-label="收起垃圾桶">${icon('close')}</button></header>
      <label class="search">${icon('search')}<input type="search" aria-label="搜索垃圾桶" placeholder="找找收起来的标签…"></label><div class="trash-list"></div>
      <footer class="trash-footer"><span>标签还在，随时取回</span><button class="clear-button" type="button">清空垃圾桶</button></footer>
      <section class="clear-confirm" role="alertdialog" aria-label="确认清空垃圾桶" hidden><strong>真的要清空吗？</strong><p class="clear-description"></p><div><button class="cancel-clear" type="button">再等等</button><button class="confirm-clear" type="button">关闭这些标签</button></div></section></section>
    <p class="surface-status" role="status" hidden></p></section>`;
  const $ = selector => shadow.querySelector(selector);
  const panel = $('.trash-panel'), drawer = $('.whitelist-drawer'), sprite = $('.sprite');
  let settings, currentId, trash = [], lastActivity = 0, pendingClear = [], isBusy = false, disposed = false;
  let noticeTimer, walkTimer, animationTimer, blinkTimer, refreshTimer, paradeEnd;
  let savedPosition = null, drag = null, suppressClickUntil = 0, positionDirty = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), controller = new AbortController();
  const pet = $('.pet'), bin = $('.bin');
  function limits() {
    return { left: 8, top: 8, right: Math.max(8, innerWidth - 184 - 8), bottom: Math.max(8, innerHeight - 132 - 8) };
  }
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function positionPanels() {
    if (popup || !host.isConnected || host.style.display === 'none') return;
    const anchor = host.getBoundingClientRect();
    $('.trash-list').style.maxHeight = `${Math.max(48, Math.min(330, innerHeight - 170))}px`;
    for (const floating of [panel, drawer, $('.surface-status'), $('.speech')]) {
      if (floating.hidden) continue;
      const width = floating.offsetWidth, height = floating.offsetHeight;
      const left = clamp(anchor.right - width, 8, Math.max(8, innerWidth - width - 8));
      const below = anchor.bottom + 12;
      const top = below + height <= innerHeight - 8 ? below : clamp(anchor.top - height - 12, 8, Math.max(8, innerHeight - height - 8));
      floating.style.left = `${left - anchor.left}px`; floating.style.right = 'auto'; floating.style.top = `${top - anchor.top}px`;
    }
  }
  function moveTo(left, top) {
    const bounds = limits();
    host.style.left = `${clamp(left, bounds.left, bounds.right)}px`;
    host.style.top = `${clamp(top, bounds.top, bounds.bottom)}px`; host.style.right = 'auto';
    positionPanels();
  }
  function applyPosition() {
    if (popup) return;
    const bounds = limits();
    moveTo(savedPosition ? bounds.left + savedPosition.x * (bounds.right - bounds.left) : innerWidth - 198,
      savedPosition ? bounds.top + savedPosition.y * (bounds.bottom - bounds.top) : 8);
  }
  async function loadPosition() {
    if (popup) return;
    const { petPosition } = await chrome.storage.local.get('petPosition');
    if (drag || disposed) return;
    savedPosition = Number.isFinite(petPosition?.x) && Number.isFinite(petPosition?.y)
      ? { x: clamp(petPosition.x, 0, 1), y: clamp(petPosition.y, 0, 1) } : null;
    applyPosition();
  }
  function finishDrag(cancel = false) {
    if (!drag) return;
    const finished = drag; drag = null; $('.stage').classList.remove('dragging');
    if (finished.target.hasPointerCapture(finished.pointerId)) finished.target.releasePointerCapture(finished.pointerId);
    if (!finished.moved) return;
    suppressClickUntil = performance.now() + 400;
    if (cancel) moveTo(finished.left, finished.top);
    else {
      const bounds = limits(), rect = host.getBoundingClientRect();
      savedPosition = { x: (rect.left - bounds.left) / (bounds.right - bounds.left || 1), y: (rect.top - bounds.top) / (bounds.bottom - bounds.top || 1) };
      chrome.storage.local.set({ petPosition: savedPosition }).catch(() => announce('位置未保存，请刷新后重试', true));
    }
    scheduleIdle();
  }
  if (!popup) {
    for (const target of [pet, bin]) {
      target.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || drag) return;
        const rect = host.getBoundingClientRect(); suppressClickUntil = 0;
        drag = { target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
        target.setPointerCapture(event.pointerId);
      });
      target.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < 6) return;
        if (!drag.moved) { drag.moved = true; stopParade(); clearTimeout(animationTimer); pet.classList.remove('idle-stretch'); $('.stage').classList.add('dragging'); }
        event.preventDefault(); moveTo(drag.left + dx, drag.top + dy);
      });
      target.addEventListener('pointerup', event => { if (event.pointerId === drag?.pointerId) finishDrag(); });
      target.addEventListener('pointercancel', event => { if (event.pointerId === drag?.pointerId) finishDrag(true); });
      target.addEventListener('lostpointercapture', event => { if (event.pointerId === drag?.pointerId) finishDrag(); });
    }
    shadow.addEventListener('click', event => {
      if (event.detail && performance.now() < suppressClickUntil && event.composedPath().some(node => node === pet || node === bin)) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0;
      }
    }, true);
    window.addEventListener('resize', () => { finishDrag(true); applyPosition(); }, { signal: controller.signal });
    window.addEventListener('blur', () => finishDrag(true), { signal: controller.signal });
  }
  async function send(type, data = {}) {
    if (disposed) return;
    let timer;
    try {
      const result = await Promise.race([
        chrome.runtime.sendMessage({ type, ...data }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('插件响应超时，请重新打开小窗确认结果；若仍无响应，请重新加载插件并刷新网页。')), 10000); })
      ]);
      if (!result?.ok) throw new Error(result?.error || '大肥鱼暂时没响应，请刷新网页'); return result.data;
    }
    catch (error) { if (!chrome.runtime?.id) dispose(); throw error; }
    finally { clearTimeout(timer); }
  }
  function dispose() {
    finishDrag(true);
    disposed = true; controller.abort(); [noticeTimer, animationTimer, blinkTimer, refreshTimer, paradeEnd].forEach(clearTimeout); clearInterval(walkTimer); host.remove();
    chrome.runtime.onMessage.removeListener?.(onMessage); chrome.storage.onChanged.removeListener?.(onStorageChanged);
  }
  function announce(text, error = false) {
    const notice = $('.surface-status'); notice.textContent = text; notice.classList.toggle('error', error); notice.hidden = false;
    positionPanels();
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 3800);
  }
  function showSpeech(text) { $('.speech').textContent = text; $('.speech').hidden = false; positionPanels(); }
  function setCount(count) {
    $('.bin-count').textContent = count > 99 ? '99+' : count; $('.bin-count').hidden = !count;
    $('.bin').classList.toggle('has-tabs', count > 0); $('.bin').setAttribute('aria-label', `打开垃圾桶，${count} 个标签`);
  }
  async function refreshWidget() {
    let supported = true;
    if (popup) { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); currentId = active?.id; supported = /^https?:/.test(active?.url || ''); }
    const widget = await send('GET_WIDGET', popup ? { tabId: currentId } : {}); if (!widget || disposed) return;
    settings = widget.settings;
    if (!popup) host.style.display = settings.showWidget && !document.fullscreenElement ? 'block' : 'none';
    for (const toggle of shadow.querySelectorAll('.protect-switch')) {
      toggle.checked = !!(widget.whitelisted || widget.siteProtected); toggle.disabled = isBusy || !supported || !!widget.siteProtected;
    }
    $('.quick-protection').classList.toggle('protected', !!(widget.whitelisted || widget.siteProtected));
    $('.quick-protection').title = widget.siteProtected ? '此网站已被整站保护，请在配置中修改' : widget.whitelisted ? '已保护当前页，点击取消白名单' : '点击加入白名单，保护当前页';
    $('.protect-help').textContent = !supported ? '这个页面不支持保护，打开普通网页试试。' : widget.siteProtected ? '已启用整站保护，可在配置里修改。' : widget.whitelisted ? '这个标签已被保护，放心放着吧。' : '打开后，大肥鱼就不会收走这个标签。';
    $('.running-label').textContent = settings.enabled ? `${settings.idleMinutes} 分钟没用，就收好` : '大肥鱼休息中';
    setCount(widget.trashCount); $('.fish-home').classList.toggle('no-motion', !settings.animations || reducedMotion.matches);
    if (!settings.animations || reducedMotion.matches) stopParade();
    positionPanels();
  }
  function renderTrash() {
    $('.total').textContent = trash.length; $('.clear-button').disabled = !trash.length;
    const query = $('.search input').value.trim().toLowerCase(), visible = trash.filter(tab => `${tab.title} ${tab.url}`.toLowerCase().includes(query));
    const list = $('.trash-list'); list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; const symbol = document.createElement('span'); symbol.textContent = '⋆';
      const title = document.createElement('strong'); title.textContent = query ? '这次没找到' : '还没有收起的标签';
      const help = document.createElement('p'); help.textContent = query ? '换个名字或网址试试。' : '你安心浏览，闲置的交给我。';
      empty.append(symbol, title, help); list.append(empty); positionPanels(); return;
    }
    for (const tab of visible) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trash-tab'; button.dataset.tabId = tab.id; button.title = `取回并打开：${tab.title}`;
      const mark = document.createElement('span'); mark.className = 'site-mark'; let domain = ''; try { domain = new URL(tab.url).hostname; } catch {}
      mark.textContent = domain.replace(/^www\./, '').charAt(0).toUpperCase() || '·';
      const text = document.createElement('span'); text.className = 'tab-copy'; const title = document.createElement('strong'); title.textContent = tab.title;
      const url = document.createElement('small'); url.textContent = domain; text.append(title, url);
      const arrow = document.createElement('span'); arrow.className = 'restore-arrow'; arrow.innerHTML = icon('arrow'); button.append(mark, text, arrow); list.append(button);
    }
    positionPanels();
  }
  async function refreshTrash() { const result = await send('GET_TRASH'); if (!result) return; trash = result.tabs; renderTrash(); setCount(trash.length); }
  async function openTrash() {
    panel.hidden = false; $('.bin').setAttribute('aria-expanded','true'); if (!popup) { drawer.hidden = true; $('.drawer-handle').setAttribute('aria-expanded','false'); }
    positionPanels();
    try { await refreshTrash(); } catch (error) { announce(error.message, true); }
  }
  function closeTrash() { if (popup) return; panel.hidden = true; $('.clear-confirm').hidden = true; $('.bin').setAttribute('aria-expanded','false'); }
  function toggleDrawer() { drawer.hidden = !drawer.hidden; $('.drawer-handle').setAttribute('aria-expanded',String(!drawer.hidden)); if (!drawer.hidden) { closeTrash(); positionPanels(); refreshWidget().catch(error => announce(error.message,true)); } }
  async function operate(fn) {
    if (isBusy) return; isBusy = true; $('.fish-home').setAttribute('aria-busy','true');
    try { await fn(); await refreshWidget(); if (!panel.hidden) await refreshTrash(); } catch (error) { announce(error.message,true); }
    finally { isBusy = false; $('.fish-home').removeAttribute('aria-busy'); refreshWidget().catch(() => {}); }
  }
  function stopParade() {
    clearInterval(walkTimer); clearTimeout(paradeEnd); walkTimer = undefined; $('.stage').classList.remove('collecting'); sprite.classList.remove('walking'); sprite.style.removeProperty('background-position'); $('.carried-tab').hidden = true; $('.speech').hidden = true;
  }
  async function parade(message) {
    if (popup || drag || document.hidden || host.style.display === 'none' || !settings?.animations || reducedMotion.matches) return;
    const image = new Image(); image.src = chrome.runtime.getURL('assets/dafeiyu-walk.png'); await image.decode();
    if (disposed || drag || document.hidden || !settings?.animations || reducedMotion.matches) return;
    stopParade(); clearTimeout(animationTimer); $('.carried-title').textContent = message.titles?.[0] || '闲置标签'; $('.carried-tab').hidden = false;
    showSpeech(message.count > 1 ? `${message.count} 个，统统收好～` : '这个先替你收好～'); sprite.classList.add('walking'); let frame = 0;
    const step = () => { sprite.style.backgroundPosition = `${-(frame % 4) * 112}px ${-Math.floor(frame / 4) * 112}px`; frame = (frame + 1) % 16; };
    step(); walkTimer = setInterval(step, 90); void $('.stage').offsetWidth; $('.stage').classList.add('collecting');
    paradeEnd = setTimeout(() => { stopParade(); scheduleIdle(); }, 3400);
  }
  function scheduleIdle() {
    clearTimeout(animationTimer); animationTimer = setTimeout(() => {
      if (!popup && !drag && settings?.animations && !reducedMotion.matches && !document.hidden && !walkTimer) {
        sprite.classList.add('blink'); clearTimeout(blinkTimer); blinkTimer = setTimeout(() => sprite.classList.remove('blink'), 180);
        $('.pet').classList.remove('idle-stretch'); void $('.pet').offsetWidth; $('.pet').classList.add('idle-stretch');
      }
      scheduleIdle();
    }, 6000 + Math.random() * 7000);
  }
  $('.bin').addEventListener('click', () => panel.hidden ? openTrash() : closeTrash()); $('.drawer-handle').addEventListener('click', toggleDrawer);
  $('.close-panel').addEventListener('click', closeTrash); $('.search input').addEventListener('input', renderTrash);
  $('.settings-button').addEventListener('click', () => send('OPEN_SETTINGS').catch(error => announce(error.message,true)));
  for (const toggle of shadow.querySelectorAll('.protect-switch')) toggle.addEventListener('change', () => {
    const value = toggle.checked;
    for (const item of shadow.querySelectorAll('.protect-switch')) item.disabled = true;
    operate(async () => { await send('SET_WHITELIST', { ...(popup ? { tabId: currentId } : {}), value }); });
  });
  $('.pet').addEventListener('click', () => operate(async () => {
    if (!settings.enabled) return announce('大肥鱼在休息，去配置里开启自动收纳吧'); const { count } = await send('SWEEP');
    if (!count) { showSpeech('没有闲置标签，再陪你一会儿。'); clearTimeout(paradeEnd); paradeEnd = setTimeout(() => { $('.speech').hidden = true; }, 3000); }
  }));
  $('.trash-list').addEventListener('click', event => {
    const button = event.target.closest('.trash-tab'); if (!button) return;
    operate(async () => { await send('RESTORE_TRASH', { tabId: Number(button.dataset.tabId) }); closeTrash(); if (popup) window.close(); });
  });
  $('.clear-button').addEventListener('click', () => { pendingClear = trash.map(tab => tab.id); $('.clear-description').textContent = `将关闭这 ${pendingClear.length} 个标签，未保存的内容可能丢失。`; $('.clear-confirm').hidden = false; $('.cancel-clear').focus(); });
  $('.cancel-clear').addEventListener('click', () => { $('.clear-confirm').hidden = true; $('.clear-button').focus(); });
  $('.confirm-clear').addEventListener('click', () => operate(async () => { const { count, kept } = await send('EMPTY_TRASH', { tabIds: pendingClear }); $('.clear-confirm').hidden = true; announce(`已关闭 ${count} 个标签${kept ? `，保留 ${kept} 个受保护的标签` : ''}`); }));
  document.addEventListener('pointerdown', event => { if (!popup && !event.composedPath().includes(host)) { closeTrash(); drawer.hidden = true; $('.drawer-handle').setAttribute('aria-expanded','false'); } }, { passive: true, signal: controller.signal });
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('.clear-confirm').hidden) $('.clear-confirm').hidden = true; else { closeTrash(); drawer.hidden = true; $('.drawer-handle').setAttribute('aria-expanded','false'); $('.bin').focus(); } } });
  function activity(event) { if (!event.isTrusted || document.hidden || Date.now() - lastActivity < 15000 || event.composedPath().includes(host)) return; lastActivity = Date.now(); send('ACTIVITY').catch(() => {}); }
  if (!popup) {
    for (const type of ['pointerdown','keydown','scroll']) document.addEventListener(type, activity, { capture: true, passive: true, signal: controller.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopParade(); else { send('ACTIVITY').catch(() => {}); refreshWidget().catch(() => {}); } }, { signal: controller.signal });
    document.addEventListener('fullscreenchange', () => refreshWidget().catch(() => {}), { signal: controller.signal });
  }
  function onMessage(message) { if (message.type === 'REFRESH_WIDGET') refreshWidget().catch(() => {}); if (message.type === 'FISH_COLLECTED') { parade(message).catch(() => {}); refreshWidget().catch(() => {}); if (!panel.hidden) refreshTrash().catch(() => {}); } }
  function onStorageChanged(changes, area) { if (area === 'session') return;
    positionDirty ||= !!changes?.petPosition || !changes || !Object.keys(changes).length;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => {
    if (positionDirty) { positionDirty = false; loadPosition().catch(() => {}); }
    refreshWidget().catch(() => {}); if (!panel.hidden) refreshTrash().catch(() => {});
  }, 180); }
  chrome.runtime.onMessage.addListener(onMessage); chrome.storage.onChanged.addListener(onStorageChanged);
  reducedMotion.addEventListener('change', () => refreshWidget().catch(() => {}), { signal: controller.signal });
  async function mount() {
    const css = await (await fetch(chrome.runtime.getURL('pet.css'))).text(), sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replaceAll('__IDLE__', chrome.runtime.getURL('assets/dafeiyu-idle.png')).replaceAll('__WALK__', chrome.runtime.getURL('assets/dafeiyu-walk.png'))); shadow.adoptedStyleSheets = [sheet];
    (popup ? document.body : document.documentElement).append(host); await loadPosition(); await refreshWidget();
    if (popup) { drawer.hidden = false; await openTrash(); } else { scheduleIdle(); send('ACTIVITY').catch(() => {}); }
  }
  mount().catch(error => { if (popup) document.body.textContent = `加载失败：${error.message}`; else dispose(); });
})();
