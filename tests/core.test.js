import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeSettings, normalizeSite, siteProtected, protectionReason, eligible, idleLabel } from '../extension/core.js';
const now = 10_000_000;
const tab = { id: 1, url: 'https://docs.example.com/project', active: false, pinned: false, audible: false };
const record = { lastActive: now - 3600000, whitelisted: false };
test('收纳阈值精确到边界，且受暂停和已收纳状态限制', () => {
  assert.equal(eligible(tab, record, DEFAULTS, now), true);
  assert.equal(eligible(tab, { ...record, lastActive: record.lastActive+1 }, DEFAULTS, now), false);
  assert.equal(eligible(tab, record, { ...DEFAULTS, enabled: false }, now), false);
  assert.equal(eligible(tab, { ...record, trashedAt: now-10 }, DEFAULTS, now), false);
  assert.equal(eligible(tab, undefined, DEFAULTS, now), false);
});
for (const [name, patch] of [['当前标签', { active: true }], ['固定标签', { pinned: true }], ['音频标签', { audible: true }], ['隐身标签', { incognito: true }], ['浏览器内部页', { url: 'chrome://settings/' }], ['文件页', { url: 'file:///tmp/test' }]]) {
  test(`${name}不会被自动收纳`, () => assert.equal(eligible({ ...tab, ...patch }, record, DEFAULTS, now), false));
}
test('关闭可选保护后，闲置固定和音频标签允许收纳', () => {
  assert.equal(eligible({ ...tab, pinned:true, audible:true }, record, { ...DEFAULTS, protectPinned:false, protectAudible:false }, now), true);
});
test('单标签白名单和网站规则都会保护标签', () => {
  assert.equal(eligible(tab, { ...record, whitelisted:true }, DEFAULTS, now), false);
  const settings = normalizeSettings({ sites: ['https://EXAMPLE.com/path'] });
  assert.equal(siteProtected(tab, settings), true);
  assert.equal(eligible(tab, record, settings, now), false);
  assert.equal(siteProtected({ url:'https://notexample.com' }, settings), false);
  assert.equal(siteProtected({ url:'https://example.com.evil.test' }, settings), false);
  assert.equal(siteProtected({ url:'https://example.com./' }, settings), true);
});
test('设置校验：范围、整数、布尔类型、唯一域名', () => {
  for (const idleMinutes of [0, -1, 1.5, 10081, Infinity, 'oops']) assert.throws(() => normalizeSettings({ idleMinutes }));
  assert.equal(normalizeSettings({ idleMinutes:'120' }).idleMinutes, 120);
  assert.equal(normalizeSettings({ enabled:'false' }).enabled, true);
  assert.deepEqual(normalizeSettings({ sites:['example.com','https://example.com/a','EXAMPLE.COM'] }).sites, ['example.com']);
  assert.throws(() => normalizeSettings({sites:'example.com'}));
});
test('域名校验排除不支持协议、凭据和通配符', () => {
  for (const value of ['javascript:alert(1)', 'ftp://example.com', 'https://user:pass@example.com', '*.example.com']) assert.throws(() => normalizeSite(value));
  assert.equal(normalizeSite(' Example.com. '), 'example.com');
  assert.equal(normalizeSite('https://example.com:8080/a'), 'example.com');
});
test('优先展示白名单理由，空 URL 安全处理', () => {
  assert.equal(protectionReason({ ...tab, active:true }, { ...record, whitelisted:true }, DEFAULTS), '白名单保护');
  assert.equal(protectionReason({}, record, DEFAULTS), '不支持的页面');
});
test('闲置时间不会显示负值，支持分钟、小时和天', () => {
  assert.equal(idleLabel(now+100, now), '刚刚活跃');
  assert.equal(idleLabel(now-120000, now), '2 分钟未使用');
  assert.equal(idleLabel(now-3600000, now), '1 小时未使用');
  assert.equal(idleLabel(now-86400000, now), '1 天未使用');
});
