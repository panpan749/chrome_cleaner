import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createChrome } from './chrome-fixture.js';

// Real Chromium rendering + interaction, real extension background code,
// simulated Chrome APIs. This does NOT claim native extension API coverage.
const fixture = createChrome(); globalThis.chrome = fixture.api;
const titles = ['Notion · 今天的灵感收集', 'Figma · 周末的小计划', '慢慢来，生活的答案不止一种', 'GitHub · 开源项目收藏', '一段适合专注的轻音乐', '本周任务 · 重要的事情', '日常的细节，也值得被记录', '设计中的留白与呼吸感'];
const hosts = ['notion.so','figma.com','read.cv','github.com','music.163.com','linear.app','sspai.com','design.fish.test'];
fixture.seed(titles.map((title,i)=>({id:i+1,title,url:`https://${hosts[i]}/article`,active:i===0,pinned:i===3,audible:i===4})));
// The newer-used tab comes later in native order and is collected first.
await fixture.api.storage.session.set({records:{
  7:{lastActive:Date.now()-120*60000,whitelisted:false},
  8:{lastActive:Date.now()-90*60000,whitelisted:false}
}});
await import('../extension/background.js');
await fixture.message('GET_STATE');
await fixture.message('SET_WHITELIST',{tabId:6,value:true});
await fixture.message('COLLECT',{tabId:8});await fixture.message('COLLECT',{tabId:7});
let revision=0; const requests=[]; fixture.api.storage.onChanged.addListener(()=>revision++);
const server = createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api') {
      let body='';for await(const chunk of req)body+=chunk;
      const input=JSON.parse(body);let result;
      if(input.kind==='message')requests.push(input.type);
      if(input.kind==='message') result=await fixture.message(input.type,input.data,input.tabId?{id:fixture.api.runtime.id,url:fixture.tabs.get(input.tabId).url,tab:fixture.tabs.get(input.tabId)}:undefined);
      if(input.kind==='storageGet')result=await fixture.api.storage.local.get(input.keys);
      if(input.kind==='storageSet')result=await fixture.api.storage.local.set(input.patch);
      if(input.kind==='query')result=await fixture.api.tabs.query(input.query);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,data:result??{}}));return;
    }
    if(url.pathname==='/events') {
      const since=Number(url.searchParams.get('since')||0),id=Number(url.searchParams.get('tabId'));
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({revision,cursor:fixture.notices.length,messages:fixture.notices.slice(since).filter(n=>n.id===id).map(n=>n.message)}));return;
    }
    if(url.pathname==='/fixture') {
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>我的阅读页面</title><body style="font:16px sans-serif;color:#43553d;background:#fafbf7;padding:80px"><h1>读一篇文章，留一点空白。</h1><p>这里是用于验证浮动开关的本地测试网页。</p><button id="read-button">继续阅读</button><div style="height:1400px"></div></body></html>');return;
    }
    const root=path.resolve('extension'),file=path.resolve(root,`.${decodeURIComponent(url.pathname)}`);
    if(!file.startsWith(`${root}/`))throw new Error('Invalid path');
    const content=await readFile(file);const type={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)];
    res.setHeader('Content-Type',type||'application/octet-stream');res.end(content);
  } catch(error) {res.statusCode=req.url==='/api'?200:404;res.end(JSON.stringify({ok:false,error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1});
await context.addInitScript(({base})=>{
  // Test-only visibility into the production closed shadow tree, for DOM assertions.
  // This override is never shipped; trusted-event guards remain enabled.
  const attachShadow=Element.prototype.attachShadow;
  Element.prototype.attachShadow=function(init){return attachShadow.call(this,this.id==='plump-fish-widget'?{...init,mode:'open'}:init);};
  const listeners=[],changes=[];const tabId=location.pathname==='/fixture'?1:null;
  async function api(body){const response=await fetch(`${base}/api`,{method:'POST',body:JSON.stringify(body)});return response.json();}
  window.chrome={
    runtime:{id:'test-fish',getURL:file=>`${base}/${file}`,sendMessage:message=>api({kind:'message',type:message.type,data:message,tabId}),onMessage:{addListener:fn=>listeners.push(fn)},openOptionsPage:()=>api({kind:'message',type:'OPEN_SETTINGS',data:{}})},
    storage:{local:{get:async keys=>(await api({kind:'storageGet',keys})).data,set:async patch=>api({kind:'storageSet',patch})},onChanged:{addListener:fn=>changes.push(fn)}},
    tabs:{query:async query=>(await api({kind:'query',query})).data}
  };
  let lastRevision=-1,cursor=0;
  setInterval(async()=>{try{const events=await(await fetch(`${base}/events?tabId=${tabId||0}&since=${cursor}`)).json();cursor=events.cursor;if(events.revision!==lastRevision){lastRevision=events.revision;changes.forEach(fn=>fn({}));}events.messages.forEach(message=>listeners.forEach(fn=>fn(message)));}catch{}},150);
},{base});
let count=0;const pass=name=>console.log(`PASS ${++count}: ${name}`);
await mkdir('artifacts',{recursive:true});
try {
  const page=await context.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/fixture`); await page.addScriptTag({path:'extension/content.js'});
  await page.locator('#plump-fish-widget .bin').waitFor();
  await page.waitForFunction(()=>document.querySelector('#plump-fish-widget').shadowRoot.querySelector('.bin-count').textContent==='2');
  const bounds=await page.locator('#plump-fish-widget').boundingBox();
  assert.equal(bounds.y,8); assert.equal(bounds.x+184,1440-14);
  assert.equal(await page.locator('.trash-panel').isVisible(),false);
  await page.screenshot({path:'artifacts/pet-idle.png'}); pass('大肥鱼和垃圾桶常驻右上角，初始不展开任何面板');
  await page.getByRole('switch',{name:'当前页面加入白名单'}).check();
  await page.waitForFunction(()=>document.querySelector('#plump-fish-widget').shadowRoot.querySelector('.quick-protection').classList.contains('protected'));
  assert.equal(await page.locator('.whitelist-drawer').isVisible(),false);
  assert.equal((await fixture.message('GET_STATE')).tabs.find(t=>t.id===1).whitelisted,true);
  assert.equal((await fixture.message('GET_STATE')).tabs.find(t=>t.id===2).whitelisted,false);
  await page.getByRole('switch',{name:'当前页面加入白名单'}).uncheck();
  await page.waitForFunction(()=>!document.querySelector('#plump-fish-widget').shadowRoot.querySelector('.quick-protection').classList.contains('protected'));
  pass('外露白名单开关可直接开启和取消，仅作用于当前页，无需打开面板');
  await page.locator('#read-button').click();
  assert.equal(await page.locator('#read-button').textContent(),'继续阅读'); pass('桌宠透明区域外的网页按钮正常可点击');
  await page.locator('.bin').evaluate(button=>button.click());
  assert.equal(await page.locator('.trash-panel').isVisible(),false); pass('网页脚本合成点击不能操作桌宠');
  await page.locator('.bin').click(); await page.locator('.trash-tab').first().waitFor();
  assert.equal(await page.locator('.trash-tab').count(),2);
  assert.deepEqual(await page.locator('.trash-tab').evaluateAll(tabs=>tabs.map(tab=>Number(tab.dataset.tabId))),[8,7]);
  const sortedPopup=await context.newPage();await sortedPopup.goto(`${base}/popup.html`);
  await sortedPopup.locator('.trash-tab').first().waitFor();
  assert.deepEqual(await sortedPopup.locator('.trash-tab').evaluateAll(tabs=>tabs.map(tab=>Number(tab.dataset.tabId))),[8,7]);
  await sortedPopup.close();await page.bringToFront();
  await page.screenshot({path:'artifacts/trash-popover.png'}); await page.screenshot({path:'artifacts/pet-preview.png',clip:{x:1080,y:0,width:360,height:460}}); pass('网页和工具栏垃圾桶只列出已收纳标签，均按最后交互时间倒序');
  await page.locator('.search input').fill('不存在的标签'); await page.getByText('这次没找到',{exact:true}).waitFor();
  await page.locator('.search input').fill('https://');
  assert.deepEqual(await page.locator('.trash-tab').evaluateAll(tabs=>tabs.map(tab=>Number(tab.dataset.tabId))),[8,7]);
  await page.locator('.search input').fill(''); pass('垃圾桶搜索保持交互时间排序，并支持空状态');
  await page.locator('.trash-tab[data-tab-id="7"]').click();
  await page.locator('.trash-panel').waitFor({state:'hidden'});
  const restored=(await fixture.message('GET_STATE')).tabs.find(t=>t.id===7);
  assert.equal(restored.trashedAt,undefined); assert.equal(restored.active,true); pass('点击标签一次完成取回与激活跳转');
  await page.locator('.drawer-handle').click(); await page.getByRole('switch',{name:'当前页面加入白名单'}).check();
  await page.waitForFunction(()=>document.querySelector('#plump-fish-widget').shadowRoot.querySelector('.protect-help').textContent.includes('已被保护'));
  assert.equal((await fixture.message('GET_STATE')).tabs.find(t=>t.id===1).whitelisted,true);
  await page.screenshot({path:'artifacts/whitelist-drawer.png',animations:'disabled'}); pass('保护说明与外露白名单开关保持同步');
  await page.locator('.settings-button').click();
  assert.ok(fixture.notices.some(n=>n.message.type==='OPTIONS_OPENED')); pass('小抽拉条可直接打开配置页');
  await page.locator('#read-button').click(); assert.equal(await page.locator('.whitelist-drawer').isVisible(),false); pass('点击网页空白收起面板，不妨碍网页操作');
  await page.locator('.bin').click(); await page.locator('.clear-button').click();
  await page.locator('.clear-confirm').waitFor(); await page.locator('.cancel-clear').click(); assert.ok(fixture.tabs.has(8));
  await page.locator('.clear-button').click();
  await fixture.message('COLLECT',{tabId:3}); // Collected after the confirmation snapshot.
  await page.locator('.confirm-clear').click(); await page.locator('.clear-confirm').waitFor({state:'hidden'});
  assert.equal(fixture.tabs.has(8),false); assert.ok(fixture.tabs.has(3)); pass('清空可取消，确认只关闭当时的标签，不误关新收纳项');
  await page.locator('.close-panel').click();
  fixture.notices.push({id:1,message:{type:'FISH_COLLECTED',count:1,titles:['设计中的留白与呼吸感']}});
  await page.locator('.stage.collecting').waitFor();
  assert.equal(await page.locator('.carried-title').textContent(),'设计中的留白与呼吸感');
  await page.locator('.sprite').evaluate(async el => {
    const image=new Image(); image.src=getComputedStyle(el).backgroundImage.slice(5,-2); await image.decode();
    el.getRootNode().querySelectorAll('*').forEach(node=>node.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=1700;}));
  });
  await page.screenshot({path:'artifacts/collecting.png'});
  await page.locator('.stage.collecting').waitFor({state:'detached'}); pass('收纳使用真实标题卡片、走路序列帧和入桶动画，完成后复位');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.no-motion').waitFor();
  fixture.notices.push({id:1,message:{type:'FISH_COLLECTED',count:1,titles:['不会动画']}});
  await page.waitForFunction(()=>document.querySelector('#plump-fish-widget').shadowRoot.querySelector('.fish-home').classList.contains('no-motion'));
  assert.equal(await page.locator('.stage.collecting').count(),0); pass('减少动态效果偏好关闭桌宠和搬运动画');
  await page.emulateMedia({reducedMotion:'no-preference'});
  const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));
  await options.goto(`${base}/options.html`);await options.waitForFunction(()=>document.getElementById('idle-minutes').value==='60');
  await options.locator('#idle-minutes').fill('90');await options.locator('#sites').fill('https://github.com/my-repo');
  await options.getByRole('button',{name:'记住这些习惯'}).click();await options.getByText('已保存，大肥鱼记住啦',{exact:true}).waitFor();
  await options.reload();await options.waitForFunction(()=>document.getElementById('idle-minutes').value==='90');
  assert.equal(await options.locator('#sites').inputValue(),'github.com');
  await options.screenshot({path:'artifacts/options.png',fullPage:true}); pass('只有配置页，设置与整站规则正确保存');
  await options.locator('#setting-showWidget').uncheck();await options.getByRole('button',{name:'记住这些习惯'}).click();
  await page.locator('#plump-fish-widget').waitFor({state:'hidden'});
  await options.locator('#setting-showWidget').check();await options.getByRole('button',{name:'记住这些习惯'}).click();
  await page.locator('#plump-fish-widget').waitFor({state:'visible'}); pass('显示桌宠开关实时生效');
  const popup=await context.newPage();await popup.setViewportSize({width:332,height:510});await popup.goto(`${base}/popup.html`);
  await popup.locator('.trash-tab').first().waitFor();assert.equal(await popup.locator('.stage').isVisible(),false);
  await popup.screenshot({path:'artifacts/toolbar-popup.png'}); pass('工具栏提供同样的小垃圾桶与白名单开关，不打开管理页');
  await page.setViewportSize({width:390,height:700});await page.locator('.bin').click();await page.locator('.trash-panel').waitFor();
  const narrow=await page.locator('.trash-panel').boundingBox();assert.ok(narrow.x>=0&&narrow.x+narrow.width<=390);
  await page.screenshot({path:'artifacts/pet-narrow.png'});pass('小窗口中垃圾桶弹层不越过视口');
  await page.locator('.close-panel').click(); await page.setViewportSize({width:1440,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const beforeDrag=await page.locator('#plump-fish-widget').boundingBox();
  const sweepsBefore=requests.filter(type=>type==='SWEEP').length;
  async function dragHandle(selector, dx, dy) {
    const handle=await page.locator(selector).boundingBox();
    const x=handle.x+handle.width/2,y=handle.y+handle.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:10});await page.mouse.up();
  }
  await dragHandle('.pet',-480,280);
  const moved=await page.locator('#plump-fish-widget').boundingBox();
  assert.ok(Math.abs(moved.x-(beforeDrag.x-480))<1&&Math.abs(moved.y-(beforeDrag.y+280))<1);
  assert.equal(requests.filter(type=>type==='SWEEP').length,sweepsBefore);
  assert.equal(await page.locator('.trash-panel').isVisible(),false);pass('拖动桌宠整体移动桌宠与垃圾桶，松手不会误触整理');
  await page.waitForFunction(async()=>!!(await chrome.storage.local.get('petPosition')).petPosition);
  const stored=(await fixture.api.storage.local.get('petPosition')).petPosition;
  assert.ok(stored.x>=0&&stored.x<=1&&stored.y>=0&&stored.y<=1);
  await page.reload();await page.addScriptTag({path:'extension/content.js'});
  await page.waitForFunction(({x,y})=>{const rect=document.querySelector('#plump-fish-widget')?.getBoundingClientRect();return rect&&Math.abs(rect.x-x)<1&&Math.abs(rect.y-y)<1;},moved);
  const another=await context.newPage();await another.setViewportSize({width:1440,height:900});
  await another.goto(`${base}/fixture`);await another.addScriptTag({path:'extension/content.js'});
  await another.waitForFunction(({x,y})=>{const rect=document.querySelector('#plump-fish-widget')?.getBoundingClientRect();return rect&&Math.abs(rect.x-x)<1&&Math.abs(rect.y-y)<1;},moved);
  pass('位置保存为相对坐标，刷新和新页面均恢复');
  await another.close();await page.bringToFront();
  const sweepResponse=page.waitForResponse(response=>response.url()===`${base}/api`&&response.request().postDataJSON()?.type==='SWEEP');
  await page.locator('.pet').click();await sweepResponse;
  assert.equal(requests.filter(type=>type==='SWEEP').length,sweepsBefore+1);pass('拖动后正常单击桌宠仍触发整理');
  const binBox=await page.locator('.bin').boundingBox();
  await page.mouse.move(binBox.x+20,binBox.y+25);await page.mouse.down();await page.mouse.move(2,898,{steps:12});await page.mouse.up();
  const corner=await page.locator('#plump-fish-widget').boundingBox();
  assert.ok(corner.x>=8&&corner.y>=8&&corner.x+corner.width<=1440&&corner.y+corner.height<=900);
  assert.equal(await page.locator('.trash-panel').isVisible(),false);pass('垃圾桶也能整体拖动，越界移动被限制且松手不误开小窗');
  await page.locator('.bin').click();await page.locator('.trash-panel').waitFor();
  const above=await page.locator('.trash-panel').boundingBox();
  assert.ok(above.x>=0&&above.y>=0&&above.x+above.width<=1440&&above.y+above.height<=900);
  assert.ok(above.y<corner.y);pass('移到左下角后垃圾桶小窗自动向上展开，保持可用');
  await page.screenshot({path:'artifacts/draggable-pet.png'});
  await page.locator('.close-panel').click();await page.locator('.drawer-handle').click();
  await page.setViewportSize({width:320,height:260});
  await page.waitForFunction(()=>{
    const host=document.querySelector('#plump-fish-widget');
    return [host,host.shadowRoot.querySelector('.whitelist-drawer')].every(element=>{
      const rect=element.getBoundingClientRect();
      return rect.x>=0&&rect.y>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight;
    });
  });
  const resized=await page.locator('#plump-fish-widget').boundingBox(),info=await page.locator('.whitelist-drawer').boundingBox();
  assert.ok(resized.x>=0&&resized.y>=0&&resized.x+resized.width<=320&&resized.y+resized.height<=260);
  assert.ok(info.x>=0&&info.y>=0&&info.x+info.width<=320&&info.y+info.height<=260);pass('窗口缩小时重新约束桌宠位置与说明弹层，避免拖丢或遮出屏幕');
  assert.deepEqual(errors,[]);pass('配置与桌宠浏览器交互无未捕获异常');
  console.log(`\n${count} browser UI checks passed (Chrome APIs simulated).`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
