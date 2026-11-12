import { DEFAULTS, GROUP_TITLE, normalizeSettings, eligible, protectionReason, siteProtected, webUrl } from './core.js';

let records = {}, settings = { ...DEFAULTS }, totalCollected = 0, ready = false, lastTrashSignature = '';
let storageWindowId = null;
const storageUrl = () => chrome.runtime.getURL('storage.html');
let tail = Promise.resolve();
const serial = (fn, report = true) => { const task = tail.then(fn); tail = task.catch(error => { if (report) console.error(error); }); return task; };
async function persist() {
  await chrome.storage.session.set({ records });
  // Session storage is private to trusted extension contexts. A non-sensitive local
  // revision tells all already-open content scripts when the bin contents change.
  const signature = Object.entries(records).filter(([, record]) => record.trashedAt).map(([id, record]) => `${id}:${record.trashedAt}`).sort().join(',');
  if (signature !== lastTrashSignature) { lastTrashSignature = signature; await chrome.storage.local.set({ trashRevision: Date.now() }); }
}
async function init() {
  if (ready) return;
  const [local, session, tabs, groups] = await Promise.all([
    chrome.storage.local.get(['settings', 'totalCollected']), chrome.storage.session.get('records'),
    chrome.tabs.query({}), chrome.tabGroups.query({ title: GROUP_TITLE })
  ]);
  settings = normalizeSettings(local.settings || DEFAULTS);
  totalCollected = local.totalCollected || 0;
  records = session.records || {};
  const marker = tabs.find(tab => tab.url === storageUrl());
  storageWindowId = marker?.windowId ?? null;
  const groupIds = new Set(groups.map(group => group.id));
  const alive = new Set(tabs.map(tab => String(tab.id)));
  for (const id of Object.keys(records)) if (!alive.has(id)) delete records[id];
  for (const tab of tabs) {
    if (!webUrl(tab.url) || tab.incognito) continue;
    records[tab.id] ||= { lastActive: Date.now(), whitelisted: false };
    if ((groupIds.has(tab.groupId) || tab.windowId === storageWindowId) && !records[tab.id].trashedAt) records[tab.id].trashedAt = Date.now();
    if (records[tab.id].trashedAt && !groupIds.has(tab.groupId) && tab.windowId !== storageWindowId) delete records[tab.id].trashedAt;
  }
  // Move legacy visible recycle groups without closing or reloading their tabs.
  for (const tab of tabs) if (groupIds.has(tab.groupId)) {
    const record = recordFor(tab);
    record.previousWindow = tab.windowId;
    record.previousGroup ??= -1;
    await moveToStorage(tab.id);
  }
  await persist();
  await chrome.alarms.create('fish-sweep', { periodInMinutes: 1 });
  ready = true;
}
async function getTab(id) { try { return await chrome.tabs.get(Number(id)); } catch { return null; } }
function recordFor(tab) { return records[tab.id] ||= { lastActive: Date.now(), whitelisted: false }; }
function notifyTab(id, message) {
  // UI notifications have no reply data. A frozen/unresponsive page must not
  // hold the serialized state queue and block saves or later bin requests.
  void chrome.tabs.sendMessage(id, message).catch(() => {});
}
async function broadcastSettings() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (webUrl(tab.url) && !tab.incognito && !tab.discarded && !tab.frozen) notifyTab(tab.id, { type: 'REFRESH_WIDGET' });
  }
}
async function moveToStorage(id) {
  if (storageWindowId !== null) {
    try { await chrome.windows.get(storageWindowId); } catch { storageWindowId = null; }
  }
  if (storageWindowId === null) {
    const window = await chrome.windows.create({ url: storageUrl(), focused: false, type: 'normal' });
    storageWindowId = window.id;
  }
  await chrome.tabs.move(Number(id), { windowId: storageWindowId, index: -1 });
  await chrome.windows.update(storageWindowId, { state: 'minimized' });
}
async function restore(id, activate = false, targetWindowId) {
  let tab = await getTab(id); const record = records[id];
  if (!tab || !record) return false;
  if (record.trashedAt) {
    if (tab.windowId === storageWindowId) {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      const available = windows.filter(window => window.id !== storageWindowId && !window.incognito);
      const target = available.find(window => window.id === targetWindowId)
        || available.find(window => window.id === record.previousWindow)
        || available.find(window => window.focused) || available[0];
      if (target) tab = await chrome.tabs.move(tab.id, { windowId: target.id, index: -1 });
      else {
        const window = await chrome.windows.create({ tabId: tab.id, focused: activate });
        tab = await chrome.tabs.get(tab.id);
      }
    }
    const previous = record.previousGroup;
    if (tab.groupId !== -1) await chrome.tabs.ungroup(tab.id);
    if (previous >= 0) {
      try { const group = await chrome.tabGroups.get(previous); if (group.windowId === tab.windowId && group.title !== GROUP_TITLE) await chrome.tabs.group({ tabIds: tab.id, groupId: previous }); } catch {}
    }
    delete record.trashedAt;
    delete record.previousGroup;
    delete record.previousWindow;
  }
  record.lastActive = Date.now();
  if (activate) {
    await chrome.tabs.update(tab.id, { active: true });
    const window = await chrome.windows.get(tab.windowId);
    await chrome.windows.update(tab.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
  }
  return true;
}
async function collect(id) {
  const tab = await getTab(id);
  if (!tab || tab.windowId === storageWindowId) return false;
  const record = recordFor(tab);
  if (record.trashedAt || protectionReason(tab, record, settings)) return false;
  record.trashedAt = Date.now(); record.previousGroup = tab.groupId; record.previousWindow = tab.windowId;
  await persist();
  try { await moveToStorage(tab.id); }
  catch (error) { await restore(id); await persist(); throw error; }
  // Keep the page running: never discard a collected tab.
  totalCollected++;
  await chrome.storage.local.set({ totalCollected });
  return true;
}
async function sweep() {
  const tabs = await chrome.tabs.query({}); let count = 0; const titles = [];
  for (const tab of tabs) {
    if (!webUrl(tab.url) || tab.incognito) continue;
    const record = recordFor(tab);
    if (eligible(tab, record, settings) && await collect(tab.id)) { count++; titles.push(tab.title || '闲置标签'); }
  }
  await persist();
  if (count && settings.animations) {
    const active = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active[0]) notifyTab(active[0].id, { type: 'FISH_COLLECTED', count, titles: titles.slice(0, 6) });
  }
  return count;
}
async function snapshot() {
  const tabs = await chrome.tabs.query({});
  const alive = new Set(tabs.map(t => String(t.id)));
  for (const id of Object.keys(records)) if (!alive.has(id)) delete records[id];
  return { settings, totalCollected, tabs: tabs.filter(t => webUrl(t.url) && !t.incognito).map(tab => {
    const record = recordFor(tab);
    return { id: tab.id, windowId: tab.windowId, title: tab.title || tab.url, url: tab.url,
      active: tab.active, pinned: tab.pinned, audible: !!tab.audible, discarded: tab.discarded,
      ...record, siteProtected: siteProtected(tab, settings), protection: protectionReason(tab, record, settings) };
  }) };
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('无效请求');
  const fromPage = !!sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''));
  const contentTypes = ['ACTIVITY', 'GET_WIDGET', 'SET_WHITELIST', 'GET_TRASH', 'RESTORE_TRASH', 'EMPTY_TRASH', 'SWEEP', 'OPEN_SETTINGS'];
  if (fromPage && (!webUrl(sender.tab.url) || sender.tab.incognito || !contentTypes.includes(message.type))) throw new Error('请求不受支持');
  const id = fromPage ? sender.tab.id : Number(message.tabId);
  switch (message.type) {
    case 'GET_STATE': return snapshot();
    case 'GET_WIDGET': { const tab = await getTab(id); return { settings, whitelisted: !!records[id]?.whitelisted, siteProtected: !!tab && siteProtected(tab, settings), trashCount: Object.values(records).filter(r => r.trashedAt).length }; }
    case 'GET_TRASH': { const state = await snapshot(); return { tabs: state.tabs.filter(tab => tab.trashedAt).sort((a, b) => b.lastActive - a.lastActive), settings }; }
    case 'RESTORE_TRASH': {
      const target = Number(message.tabId);
      if (!records[target]?.trashedAt) throw new Error('这个标签已被取回或关闭');
      if (!await restore(target, true, sender.tab?.windowId ?? message.windowId)) throw new Error('这个标签已关闭');
      await persist(); return {};
    }
    case 'ACTIVITY': {
      const tab = await getTab(id);
      if (tab?.active && tab.windowId !== storageWindowId && webUrl(tab.url)) { if (records[id]?.trashedAt) await restore(id); recordFor(tab).lastActive = Date.now(); await persist(); }
      return {};
    }
    case 'SET_WHITELIST': {
      const tab = await getTab(id); if (!tab || !webUrl(tab.url)) throw new Error('该标签已关闭或不支持');
      if (message.value) await restore(id);
      recordFor(tab).whitelisted = !!message.value;
      await persist(); notifyTab(id, { type: 'REFRESH_WIDGET' });
      return {};
    }
    case 'SAVE_SETTINGS': {
      settings = normalizeSettings({ ...settings, ...message.settings });
      await chrome.storage.local.set({ settings });
      for (const [tabId, record] of Object.entries(records)) {
        if (!record.trashedAt) continue;
        const tab = await getTab(tabId);
        if (tab && siteProtected(tab, settings)) await restore(tabId);
      }
      await persist(); await broadcastSettings(); return { settings };
    }
    case 'SWEEP': return { count: await sweep() };
    case 'COLLECT': { const collected = await collect(id); await persist(); if (!collected) throw new Error('该标签正在使用、受保护或已被收纳'); return {}; }
    case 'RESTORE': { if (!await restore(id, !!message.activate)) throw new Error('标签已关闭'); await persist(); return {}; }
    case 'RESTORE_ALL': {
      let count = 0; for (const [tabId, record] of Object.entries(records)) if (record.trashedAt && await restore(tabId)) count++;
      await persist(); return { count };
    }
    case 'EMPTY_TRASH': {
      let count = 0, kept = 0;
      // Only close the exact items the confirmation dialog showed.
      if (!Array.isArray(message.tabIds)) throw new Error('请先确认要关闭的标签');
      for (const tabId of new Set(message.tabIds.map(Number))) {
        const record = records[tabId]; if (!record?.trashedAt) continue;
        const tab = await getTab(tabId);
        if (!tab) { delete records[tabId]; continue; }
        if (protectionReason({ ...tab, active: tab.windowId === storageWindowId ? false : tab.active }, record, settings)) { await restore(tabId); kept++; continue; }
        await chrome.tabs.remove(tabId); delete records[tabId]; count++;
      }
      await persist(); return { count, kept };
    }
    case 'FOCUS': { const tab = await getTab(id); if (!tab) throw new Error('标签已关闭'); await restore(id, true); await persist(); return {}; }
    case 'OPEN_SETTINGS': await chrome.runtime.openOptionsPage(); return {};
    default: throw new Error('未知操作');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  serial(async () => { await init(); return handle(message, sender); }, false).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'fish-sweep') serial(async () => { await init(); await sweep(); }); });
chrome.tabs.onActivated.addListener(({ tabId }) => serial(async () => {
  await init(); const tab = await getTab(tabId);
  if (tab && tab.windowId !== storageWindowId && webUrl(tab.url) && !tab.incognito) { await restore(tabId); recordFor(tab).lastActive = Date.now(); await persist(); }
}));
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (!change.url && change.groupId === undefined) return;
  serial(async () => {
    await init(); if (!webUrl(tab.url) || tab.incognito) { delete records[id]; await persist(); return; }
    const record = recordFor(tab);
    const currentTab = await getTab(id);
    if (currentTab?.windowId === storageWindowId) return;
    if (change.url) { if (record.trashedAt) await restore(id); record.lastActive = Date.now(); }
    if (change.groupId !== undefined && record.trashedAt) {
      const current = await getTab(id);
      let group = null; if (current?.groupId >= 0) group = await chrome.tabGroups.get(current.groupId).catch(() => null);
      if (!group || group.title !== GROUP_TITLE) { delete record.trashedAt; delete record.previousGroup; record.lastActive = Date.now(); }
    }
    await persist();
  });
});
chrome.tabs.onRemoved.addListener(id => serial(async () => { await init(); delete records[id]; await persist(); }));
chrome.tabs.onCreated.addListener(tab => serial(async () => { await init(); if (webUrl(tab.url) && !tab.incognito) { recordFor(tab); await persist(); } }));
chrome.tabs.onReplaced.addListener((added, removed) => serial(async () => { await init(); if (records[removed]) { records[added] = records[removed]; delete records[removed]; await persist(); } }));
chrome.runtime.onInstalled.addListener(() => serial(async () => {
  await init();
  // Manifest content scripts cover future navigations; inject into pages already open at installation.
  for (const tab of await chrome.tabs.query({})) {
    if (webUrl(tab.url) && !tab.incognito && !tab.discarded) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).catch(() => {});
    }
  }
}));
serial(init);
