import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';

// Native Chrome extension integration. Requires a browser that permits unpacked extensions.
const extension = path.resolve('extension');
const profile = await mkdtemp(path.join(os.tmpdir(),'dafeiyu-native-'));
await mkdir('artifacts',{recursive:true});
const context = await chromium.launchPersistentContext(profile,{
  executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,
  viewport:{width:1440,height:900},ignoreDefaultArgs:['--disable-extensions'],
  args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
});
let checks=0;const pass=name=>console.log(`PASS ${++checks}: ${name}`);
try {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000}).catch(()=>{
    throw new Error('扩展后台未启动。请检查浏览器是否允许开发者扩展；云环境系统 Chromium 的管理员策略禁止加载扩展，不能在该浏览器验证原生 API。');
  });
  const id=new URL(worker.url()).hostname;
  await context.route('https://**.fish.test/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>测试标签</title><h1>离线测试页面</h1><button>继续阅读</button>'}));
  const pages=[];
  for(let i=1;i<=5;i++){const page=await context.newPage();await page.goto(`https://tab${i}.fish.test/`);await page.locator('#plump-fish-widget').waitFor();pages.push(page);}
  const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
  const send=(type,data={})=>options.evaluate(async({type,data})=>{const response=await chrome.runtime.sendMessage({type,...data});if(!response?.ok)throw new Error(response?.error);return response.data;},{type,data});
  let state=await send('GET_STATE');assert.equal(state.tabs.length,5);pass('原生扩展加载、现有标签同步和内容脚本注入');
  const ids=Array.from({length:5},(_,i)=>state.tabs.find(t=>t.url===`https://tab${i+1}.fish.test/`).id);
  await pages[0].bringToFront();await pages[0].mouse.click(1378,130);
  await options.waitForFunction(async tabId=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).data.tabs.find(t=>t.id===tabId)?.whitelisted,ids[0]);
  assert.equal((await send('GET_STATE')).tabs.find(t=>t.id===ids[0]).whitelisted,true);pass('垃圾桶下方的外露开关直接保护当前标签');
  await worker.evaluate(tabId=>chrome.tabs.update(tabId,{pinned:true}),ids[1]);
  await pages[2].evaluate(()=>{window.keptValue='页面未刷新';});
  await send('SAVE_SETTINGS',{settings:{discardOnCollect:true}});await pages[4].bringToFront();
  await worker.evaluate(()=>{globalThis.actualNow=Date.now;Date.now=()=>actualNow()+61*60000;});
  const result=await send('SWEEP');await worker.evaluate(()=>{Date.now=actualNow;});
  assert.equal(result.count,2);state=await send('GET_STATE');assert.ok(state.tabs.filter(t=>t.trashedAt).every(t=>!t.discarded));
  const groups=await worker.evaluate(()=>chrome.tabGroups.query({}));assert.ok(!groups.some(g=>g.title.includes('回收站')));
  const storageWindowId=state.tabs.find(t=>t.trashedAt).windowId;
  assert.equal((await worker.evaluate(id=>chrome.windows.get(id),storageWindowId)).state,'minimized');
  assert.ok(state.tabs.filter(t=>t.trashedAt).every(t=>t.windowId===storageWindowId));
  pass('收纳到独立最小化窗口，不创建顶部回收站、不休眠');
  await pages[4].mouse.click(1396,81); await pages[4].mouse.click(1250,290);
  state=await send('GET_STATE');assert.equal(state.tabs.find(t=>t.id===ids[2]).active,true);assert.equal(state.tabs.find(t=>t.id===ids[2]).trashedAt,undefined);assert.equal(await pages[2].evaluate(()=>window.keptValue),'页面未刷新');
  assert.equal(state.tabs.find(t=>t.id===ids[2]).windowId,state.tabs.find(t=>t.id===ids[4]).windowId);pass('点击垃圾桶移回当前窗口，保留页面内存状态');
  await pages[4].bringToFront();
  const pending=(await send('GET_TRASH')).tabs.map(tab=>tab.id);
  assert.ok((await send('GET_STATE')).tabs.some(t=>t.id===ids[3]));
  await send('EMPTY_TRASH',{tabIds:pending});
  assert.ok(!(await send('GET_STATE')).tabs.some(t=>t.id===ids[3]));pass('原生清空真正关闭确认快照内的标签');
  await options.bringToFront();await options.locator('#idle-minutes').fill('90');await options.getByRole('button',{name:'记住这些习惯'}).click();await options.getByText('已保存，大肥鱼记住啦',{exact:true}).waitFor();
  await options.reload();await options.waitForFunction(()=>document.getElementById('idle-minutes').value==='90');pass('配置页面保存并恢复设置');
  await send('COLLECT',{tabId:ids[2]});await worker.evaluate(()=>chrome.storage.session.clear());
  const cdp=await context.newCDPSession(options);await cdp.send('ServiceWorker.enable');await cdp.send('ServiceWorker.stopAllWorkers');
  assert.ok((await send('GET_STATE')).tabs.find(t=>t.id===ids[2])?.trashedAt);pass('后台重启并丢失会话记录后，从收纳窗口恢复垃圾桶');
  await pages[4].bringToFront();await pages[4].mouse.click(1396,81);await pages[4].screenshot({path:'artifacts/native-trash.png'});
  console.log(`${checks} native Chrome extension checks passed.`);
} finally {await context.close();await rm(profile,{recursive:true,force:true});}
