(() => {
  const popup = document.documentElement.hasAttribute('data-fish-popup');
  if (document.getElementById('plump-fish-widget')) return;
  const host = document.createElement('div'); host.id = 'plump-fish-widget';
  host.style.cssText = popup ? 'display:block;' : 'all:initial;position:fixed;top:8px;right:14px;width:184px;height:132px;z-index:2147483646;pointer-events:none;color-scheme:light;';
  // Keep cross-tab titles and controls private from the host website.
  const shadow = host.attachShadow({ mode: popup ? 'open' : 'closed' });
  for (const type of ['click','change','input','keydown','pointerdown','pointerup']) {
    shadow.addEventListener(type, event => { if (!event.isTrusted) event.stopImmediatePropagation(); }, true);
  }
  const paths = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>', shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>', arrow: '<path d="M6 18 18 6M6 6h12v12"/>',
    down: '<path d="m7 9 5 5 5-5"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  shadow.innerHTML = `<section class="fish-home ${popup ? 'popup-mode' : ''}" aria-label="大肥鱼标签桌宠">
    <div class="stage"><button class="pet" type="button" aria-label="大肥鱼：整理闲置标签" title="戳一下，让大肥鱼整理闲置标签"><span class="sprite"></span></button>
      <span class="carried-tab" hidden><span class="tab-dot"></span><span class="carried-title"></span><span>×</span></span>
      <button class="bin" type="button" aria-label="打开垃圾桶" aria-expanded="false" title="点我看看收好的标签"><span class="bin-lid"></span><span class="bin-body"><span></span><span></span><span></span></span><span class="bin-count" hidden>0</span></button>
      <button class="drawer-handle" type="button" aria-label="展开当前页白名单开关" aria-expanded="false">${icon('shield')}${icon('down')}</button>
      <div class="speech" role="status" hidden></div></div>
    <section class="whitelist-drawer" aria-label="当前页白名单" hidden><div class="drawer-top"><span>${icon('shield')}保护这个页面</span><input class="protect-switch" type="checkbox" role="switch" aria-label="当前页面加入白名单"></div><p class="protect-help">打开后，大肥鱼就不会收走这个标签。</p><div class="drawer-bottom"><span class="running-label">每隔一分钟，悄悄巡视</span><button class="settings-button" aria-label="打开配置页面" title="配置">${icon('settings')}</button></div></section>
    <section class="trash-panel" aria-label="垃圾桶中的标签" hidden><header class="trash-header"><div><h2>大肥鱼的垃圾桶 <span class="total">0</span></h2><p>点一个标签，就还给你。</p></div><button class="close-panel icon-button" aria-label="收起垃圾桶">${icon('close')}</button></header>
      <label class="search">${icon('search')}<input type="search" aria-label="搜索垃圾桶" placeholder="找找收起来的标签…"></label><div class="trash-list"></div>
      <footer class="trash-footer"><span>标签还在，随时取回</span><button class="clear-button" type="button">清空垃圾桶</button></footer>
      <section class="clear-confirm" role="alertdialog" aria-label="确认清空垃圾桶" hidden><strong>真的要清空吗？</strong><p class="clear-description"></p><div><button class="cancel-clear" type="button">再等等</button><button class="confirm-clear" type="button">关闭这些标签</button></div></section></section>
    <p class="surface-status" role="status" hidden></p></section>`;
  const $ = selector => shadow.querySelector(selector);
  const panel = $('.trash-panel'), drawer = $('.whitelist-drawer'), sprite = $('.sprite');
  let settings, currentId, trash = [], lastActivity = 0, pendingClear = [], isBusy = false, disposed = false;
  let noticeTimer, walkTimer, animationTimer, blinkTimer, refreshTimer, paradeEnd;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), controller = new AbortController();
  async function send(type, data = {}) {
    if (disposed) return;
    try { const result = await chrome.runtime.sendMessage({ type, ...data }); if (!result?.ok) throw new Error(result?.error || '大肥鱼暂时没响应，请刷新网页'); return result.data; }
    catch (error) { if (!chrome.runtime?.id) dispose(); throw error; }
  }
  function dispose() {
    disposed = true; controller.abort(); [noticeTimer, animationTimer, blinkTimer, refreshTimer, paradeEnd].forEach(clearTimeout); clearInterval(walkTimer); host.remove();
    chrome.runtime.onMessage.removeListener?.(onMessage); chrome.storage.onChanged.removeListener?.(onStorageChanged);
  }
  function announce(text, error = false) {
    const notice = $('.surface-status'); notice.textContent = text; notice.classList.toggle('error', error); notice.hidden = false;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 3800);
  }
  function showSpeech(text) { $('.speech').textContent = text; $('.speech').hidden = false; }
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
    $('.protect-switch').checked = !!(widget.whitelisted || widget.siteProtected); $('.protect-switch').disabled = !supported || !!widget.siteProtected;
    $('.drawer-handle').classList.toggle('protected', $('.protect-switch').checked);
    $('.protect-help').textContent = !supported ? '这个页面不支持保护，打开普通网页试试。' : widget.siteProtected ? '已启用整站保护，可在配置里修改。' : widget.whitelisted ? '这个标签已被保护，放心放着吧。' : '打开后，大肥鱼就不会收走这个标签。';
    $('.running-label').textContent = settings.enabled ? `${settings.idleMinutes} 分钟没用，就收好` : '大肥鱼休息中';
    setCount(widget.trashCount); $('.fish-home').classList.toggle('no-motion', !settings.animations || reducedMotion.matches);
    if (!settings.animations || reducedMotion.matches) stopParade();
  }
  function renderTrash() {
    $('.total').textContent = trash.length; $('.clear-button').disabled = !trash.length;
    const query = $('.search input').value.trim().toLowerCase(), visible = trash.filter(tab => `${tab.title} ${tab.url}`.toLowerCase().includes(query));
    const list = $('.trash-list'); list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div'); empty.className = 'empty'; const symbol = document.createElement('span'); symbol.textContent = '⋆';
      const title = document.createElement('strong'); title.textContent = query ? '这次没找到' : '还没有收起的标签';
      const help = document.createElement('p'); help.textContent = query ? '换个名字或网址试试。' : '你安心浏览，闲置的交给我。';
      empty.append(symbol, title, help); list.append(empty); return;
    }
    for (const tab of visible) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trash-tab'; button.dataset.tabId = tab.id; button.title = `取回并打开：${tab.title}`;
      const mark = document.createElement('span'); mark.className = 'site-mark'; let domain = ''; try { domain = new URL(tab.url).hostname; } catch {}
      mark.textContent = domain.replace(/^www\./, '').charAt(0).toUpperCase() || '·';
      const text = document.createElement('span'); text.className = 'tab-copy'; const title = document.createElement('strong'); title.textContent = tab.title;
      const url = document.createElement('small'); url.textContent = domain; text.append(title, url);
      const arrow = document.createElement('span'); arrow.className = 'restore-arrow'; arrow.innerHTML = icon('arrow'); button.append(mark, text, arrow); list.append(button);
    }
  }
  async function refreshTrash() { const result = await send('GET_TRASH'); if (!result) return; trash = result.tabs; renderTrash(); setCount(trash.length); }
  async function openTrash() {
    panel.hidden = false; $('.bin').setAttribute('aria-expanded','true'); if (!popup) { drawer.hidden = true; $('.drawer-handle').setAttribute('aria-expanded','false'); }
    try { await refreshTrash(); } catch (error) { announce(error.message, true); }
  }
  function closeTrash() { if (popup) return; panel.hidden = true; $('.clear-confirm').hidden = true; $('.bin').setAttribute('aria-expanded','false'); }
  function toggleDrawer() { drawer.hidden = !drawer.hidden; $('.drawer-handle').setAttribute('aria-expanded',String(!drawer.hidden)); if (!drawer.hidden) { closeTrash(); refreshWidget().catch(error => announce(error.message,true)); } }
  async function operate(fn) {
    if (isBusy) return; isBusy = true; $('.fish-home').setAttribute('aria-busy','true');
    try { await fn(); await refreshWidget(); if (!panel.hidden) await refreshTrash(); } catch (error) { announce(error.message,true); }
    finally { isBusy = false; $('.fish-home').removeAttribute('aria-busy'); }
  }
  function stopParade() {
    clearInterval(walkTimer); clearTimeout(paradeEnd); walkTimer = undefined; $('.stage').classList.remove('collecting'); sprite.classList.remove('walking'); sprite.style.removeProperty('background-position'); $('.carried-tab').hidden = true; $('.speech').hidden = true;
  }
  async function parade(message) {
    if (popup || document.hidden || host.style.display === 'none' || !settings?.animations || reducedMotion.matches) return;
    const image = new Image(); image.src = chrome.runtime.getURL('assets/dafeiyu-walk.png'); await image.decode();
    if (disposed || document.hidden || !settings?.animations || reducedMotion.matches) return;
    stopParade(); clearTimeout(animationTimer); $('.carried-title').textContent = message.titles?.[0] || '闲置标签'; $('.carried-tab').hidden = false;
    showSpeech(message.count > 1 ? `${message.count} 个，统统收好～` : '这个先替你收好～'); sprite.classList.add('walking'); let frame = 0;
    const step = () => { sprite.style.backgroundPosition = `${-(frame % 4) * 112}px ${-Math.floor(frame / 4) * 112}px`; frame = (frame + 1) % 16; };
    step(); walkTimer = setInterval(step, 90); void $('.stage').offsetWidth; $('.stage').classList.add('collecting');
    paradeEnd = setTimeout(() => { stopParade(); scheduleIdle(); }, 3400);
  }
  function scheduleIdle() {
    clearTimeout(animationTimer); animationTimer = setTimeout(() => {
      if (!popup && settings?.animations && !reducedMotion.matches && !document.hidden && !walkTimer) {
        sprite.classList.add('blink'); clearTimeout(blinkTimer); blinkTimer = setTimeout(() => sprite.classList.remove('blink'), 180);
        $('.pet').classList.remove('idle-stretch'); void $('.pet').offsetWidth; $('.pet').classList.add('idle-stretch');
      }
      scheduleIdle();
    }, 6000 + Math.random() * 7000);
  }
  $('.bin').addEventListener('click', () => panel.hidden ? openTrash() : closeTrash()); $('.drawer-handle').addEventListener('click', toggleDrawer);
  $('.close-panel').addEventListener('click', closeTrash); $('.search input').addEventListener('input', renderTrash);
  $('.settings-button').addEventListener('click', () => send('OPEN_SETTINGS').catch(error => announce(error.message,true)));
  $('.protect-switch').addEventListener('change', () => operate(async () => { await send('SET_WHITELIST', { ...(popup ? { tabId: currentId } : {}), value: $('.protect-switch').checked }); }));
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
  function onStorageChanged(changes, area) { if (area === 'session') return; clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { refreshWidget().catch(() => {}); if (!panel.hidden) refreshTrash().catch(() => {}); }, 180); }
  chrome.runtime.onMessage.addListener(onMessage); chrome.storage.onChanged.addListener(onStorageChanged);
  reducedMotion.addEventListener('change', () => refreshWidget().catch(() => {}), { signal: controller.signal });
  async function mount() {
    const css = await (await fetch(chrome.runtime.getURL('pet.css'))).text(), sheet = new CSSStyleSheet();
    sheet.replaceSync(css.replaceAll('__IDLE__', chrome.runtime.getURL('assets/dafeiyu-idle.png')).replaceAll('__WALK__', chrome.runtime.getURL('assets/dafeiyu-walk.png'))); shadow.adoptedStyleSheets = [sheet];
    (popup ? document.body : document.documentElement).append(host); await refreshWidget();
    if (popup) { drawer.hidden = false; await openTrash(); } else { scheduleIdle(); send('ACTIVITY').catch(() => {}); }
  }
  mount().catch(error => { if (popup) document.body.textContent = `加载失败：${error.message}`; else dispose(); });
})();
