export const DEFAULTS = Object.freeze({
  enabled: true, idleMinutes: 60, protectPinned: true, protectAudible: true,
  discardOnCollect: false, showWidget: true, animations: true, sites: []
});
export const GROUP_TITLE = '🐟 胖鱼 · 回收站';
export function webUrl(url = '') { return /^https?:\/\//i.test(url); }
export function hostname(url = '') { try { return new URL(url).hostname; } catch { return ''; } }
export function normalizeSite(value) {
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (!webUrl(url.href) || url.username || url.password || !url.hostname || url.hostname.includes('*')) throw new Error('请输入有效域名，例如 notion.so');
  return url.hostname.replace(/\.$/, '');
}
export function normalizeSettings(input = {}) {
  const result = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof DEFAULTS[key] === 'boolean' && typeof input[key] === 'boolean') result[key] = input[key];
  }
  const minutes = Number(input.idleMinutes ?? DEFAULTS.idleMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) throw new Error('闲置时间须为 1–10080 分钟的整数');
  result.idleMinutes = minutes;
  if (input.sites !== undefined && !Array.isArray(input.sites)) throw new Error('站点白名单格式不正确');
  result.sites = [...new Set((input.sites || []).map(normalizeSite).filter(Boolean))].slice(0, 200);
  return result;
}
export function siteProtected(tab, settings) {
  const host = hostname(tab.url).replace(/\.$/, '');
  return settings.sites.some(site => host === site || host.endsWith(`.${site}`));
}
export function protectionReason(tab, record, settings) {
  if (!webUrl(tab.url) || tab.incognito) return '不支持的页面';
  if (record?.whitelisted || siteProtected(tab, settings)) return '白名单保护';
  if (tab.active) return '正在使用';
  if (settings.protectPinned && tab.pinned) return '固定标签';
  if (settings.protectAudible && tab.audible) return '正在播放声音';
  return '';
}
export function eligible(tab, record, settings, now = Date.now()) {
  return settings.enabled && !!record && !record.trashedAt && !protectionReason(tab, record, settings)
    && now - record.lastActive >= settings.idleMinutes * 60000;
}
export function idleLabel(lastActive, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - lastActive) / 60000));
  if (minutes < 1) return '刚刚活跃';
  if (minutes < 60) return `${minutes} 分钟未使用`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时未使用`;
  return `${Math.floor(minutes / 1440)} 天未使用`;
}
