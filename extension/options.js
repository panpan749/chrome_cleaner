import { normalizeSettings } from './core.js';
import { request, toast } from './ui.js';
const $ = id => document.getElementById(id);
const definitions = [
  ['enabled','自动收纳','每分钟巡视一次，只收纳超过闲置时间的标签。','collection-settings'],
  ['protectPinned','留着固定的标签','你特意固定的标签，不会被收走。','collection-settings'],
  ['protectAudible','不打扰正在播放的声音','音乐和会议播放声音时，不自动收纳。','collection-settings'],
  ['showWidget','在网页上显示大肥鱼','按住桌宠或垃圾桶可一起拖动。关闭后可从浏览器工具栏打开垃圾桶；网页全屏时自动隐藏。','appearance-settings'],
  ['animations','眨眨眼，顺便收个标签','开启待机小动作和拖标签动画，也会尊重系统的“减少动态效果”设置。','appearance-settings']
];
for (const [key,title,description,section] of definitions) $(section).insertAdjacentHTML('beforeend', `<div class="setting-row"><div><label for="setting-${key}">${title}</label><p>${description}</p></div><input id="setting-${key}" class="switch" type="checkbox" role="switch"></div>`);
let current;
async function load() {
  current = (await request('GET_STATE')).settings;
  $('idle-minutes').value = current.idleMinutes; $('sites').value = current.sites.join('\n');
  for (const [key] of definitions) $(`setting-${key}`).checked = current[key];
}
$('settings-form').addEventListener('input', () => { $('save-status').textContent = '有尚未保存的修改'; });
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = document.querySelector('.save-button');
  if (button.disabled) return;
  const label = button.innerHTML; button.disabled = true; button.textContent = '正在保存…';
  $('save-status').textContent = '正在保存…';
  try {
    const patch = { ...current, idleMinutes: Number($('idle-minutes').value), sites: $('sites').value.split(/\n/).map(x => x.trim()).filter(Boolean) };
    for (const [key] of definitions) patch[key] = $(`setting-${key}`).checked;
    const { settings } = await request('SAVE_SETTINGS', { settings: normalizeSettings(patch) }); current = settings;
    $('sites').value = current.sites.join('\n'); $('save-status').textContent = '已保存，大肥鱼记住啦'; toast('习惯已保存');
  } catch (error) { $('save-status').textContent = `保存未确认：${error.message}`; toast(error.message,true); }
  finally { button.disabled = false; button.innerHTML = label; }
});
load().catch(error => toast(error.message,true));
