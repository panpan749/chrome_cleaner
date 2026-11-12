import test from 'node:test';
import assert from 'node:assert/strict';
import { createChrome } from './chrome-fixture.js';
import { GROUP_TITLE } from '../extension/core.js';

test('后台生命周期、收纳、恢复与关闭流程（Chrome API 合约模拟）', async t => {
  const fixture = createChrome(); globalThis.chrome=fixture.api;
  fixture.seed([{id:1},{id:2,active:true},{id:3,pinned:true},{id:4,audible:true},{id:5,url:'https://keep.example.com'},{id:6},{id:7,windowId:2},{id:8,url:'chrome://settings/'}]);
  const send=fixture.message;
  await import(`../extension/background.js?test=${Date.now()}`);
  await t.test('启动扫描已有标签并注册分钟闹钟', async()=> {
    const state=await send('GET_STATE');assert.equal(state.tabs.length,7);
    assert.equal(fixture.alarms.get('fish-sweep').periodInMinutes,1);
    assert.equal(state.settings.discardOnCollect,false);
  });
  await t.test('页面消息绑定发送标签，禁止内容脚本读取所有普通标签', async()=> {
    const sender={id:fixture.api.runtime.id,url:'https://site1.test/',tab:{id:1,url:'https://site1.test/'}};
    await send('SET_WHITELIST',{tabId:6,value:true},sender);
    const state=await send('GET_STATE');assert.equal(state.tabs.find(t=>t.id===1).whitelisted,true);assert.equal(state.tabs.find(t=>t.id===6).whitelisted,false);
    await assert.rejects(send('GET_STATE',{},sender),/不受支持/);
  });
  await t.test('过期扫描保护当前、固定、音频、白名单；移到最小化窗口', async()=> {
    await send('SAVE_SETTINGS',{settings:{sites:['example.com']}});
    const original=Date.now;Date.now=()=>original()+61*60000;
    try { assert.equal((await send('SWEEP')).count,2); } finally {Date.now=original;}
    const state=await send('GET_STATE');assert.deepEqual(state.tabs.filter(t=>t.trashedAt).map(t=>t.id),[6,7]);
    assert.ok(state.tabs.filter(t=>t.trashedAt).every(t=>!t.discarded));
    const groups=await fixture.api.tabGroups.query({title:GROUP_TITLE});assert.equal(groups.length,0);assert.equal(fixture.tabs.get(6).windowId,fixture.tabs.get(7).windowId);assert.equal((await fixture.api.windows.get(fixture.tabs.get(6).windowId)).state,'minimized');
  });
  await t.test('取回和重新收纳；始终保留页面运行状态', async()=> {
    await send('RESTORE',{tabId:6});assert.equal(fixture.tabs.get(6).groupId,-1);
    await send('SAVE_SETTINGS',{settings:{discardOnCollect:true}});await send('COLLECT',{tabId:6});assert.equal(fixture.tabs.get(6).discarded,false);
  });
  await t.test('取回恢复原分组', async()=> {
    await send('RESTORE',{tabId:6});
    const previous=await fixture.api.tabs.group({tabIds:6});await fixture.api.tabGroups.update(previous,{title:'工作'});
    await send('COLLECT',{tabId:6});await send('RESTORE',{tabId:6});assert.equal(fixture.tabs.get(6).groupId,previous);
  });
  await t.test('收纳窗口内部激活不取回，显式点击才取回', async()=> {
    await fixture.api.tabs.update(7,{active:true});
    assert.ok((await send('GET_STATE')).tabs.find(t=>t.id===7).trashedAt);
    await send('RESTORE_TRASH',{tabId:7});
    assert.equal((await send('GET_STATE')).tabs.find(t=>t.id===7).trashedAt,undefined);
  });
  await t.test('整站规则新增后自动恢复垃圾桶中的对应标签',async()=> {
    await send('COLLECT',{tabId:6});await send('SAVE_SETTINGS',{settings:{sites:['site6.test']}});
    assert.equal((await send('GET_STATE')).tabs.find(t=>t.id===6).trashedAt,undefined);
  });
  await t.test('暂停阻止扫描，仍可手动收纳；重新启用不丢设置',async()=> {
    await send('SAVE_SETTINGS',{settings:{enabled:false,sites:[]}});const original=Date.now;Date.now=()=>original()+120*60000;
    try{assert.equal((await send('SWEEP')).count,0);}finally{Date.now=original;}
    await send('COLLECT',{tabId:6});assert.ok((await send('GET_STATE')).tabs.find(t=>t.id===6).trashedAt);
    await send('SAVE_SETTINGS',{settings:{enabled:true}});
  });
  await t.test('清空只关闭确认列表中的标签，并保护后来加入白名单的标签',async()=> {
    await send('SET_WHITELIST',{tabId:1,value:false});await send('COLLECT',{tabId:1});
    await send('SET_WHITELIST',{tabId:6,value:true});
    const result=await send('EMPTY_TRASH',{tabIds:[6]});assert.equal(result.count,0);assert.ok(fixture.tabs.has(6));assert.ok(fixture.tabs.has(1));
    const cleared=await send('EMPTY_TRASH',{tabIds:[1,1,999]});assert.equal(cleared.count,1);assert.equal(fixture.tabs.has(1),false);
    await assert.rejects(send('EMPTY_TRASH'),/确认/);
  });
  await t.test('移动失败时回滚，不留下虚假回收站状态',async()=> {
    fixture.seed([{id:9}]);const update=fixture.api.tabs.move;fixture.api.tabs.move=async()=>{throw new Error('Group update failed');};
    try {await assert.rejects(send('COLLECT',{tabId:9}),/Group update failed/);}finally{fixture.api.tabs.move=update;}
    assert.equal((await send('GET_STATE')).tabs.find(t=>t.id===9).trashedAt,undefined);assert.equal(fixture.tabs.get(9).groupId,-1);
  });
  await t.test('失效配置拒绝保存，现有设置仍可使用',async()=> {
    await assert.rejects(send('SAVE_SETTINGS',{settings:{idleMinutes:0}}),/闲置时间/);
    assert.equal((await send('GET_STATE')).settings.idleMinutes,60);
  });
  await t.test('移除标签清除会话记录，浏览器内部页不展示',async()=> {
    await fixture.api.tabs.remove(9);const state=await send('GET_STATE');assert.ok(!state.tabs.some(t=>t.id===9||t.id===8));
    assert.equal((await fixture.api.storage.session.get('records')).records[9],undefined);
  });
  await t.test('网页垃圾桶只返回已收纳标签，并可跨窗口取回且激活',async()=> {
    fixture.seed([{id:10,windowId:3},{id:11}]); await send('COLLECT',{tabId:10});
    const sender={id:fixture.api.runtime.id,url:'https://site11.test/',tab:fixture.tabs.get(11)};
    const bin=await send('GET_TRASH',{},sender);assert.ok(bin.tabs.some(t=>t.id===10));assert.ok(bin.tabs.every(t=>t.trashedAt));assert.ok(!bin.tabs.some(t=>t.id===11));
    await send('RESTORE_TRASH',{tabId:10},sender);
    assert.equal(fixture.tabs.get(10).active,true);assert.equal(fixture.tabs.get(10).groupId,-1);
    assert.equal((await send('GET_STATE')).tabs.find(t=>t.id===10).trashedAt,undefined);
    assert.ok((await fixture.api.storage.local.get('trashRevision')).trashRevision);
  });
  await t.test('网页小窗不能用取回消息跳转任意未收纳标签',async()=> {
    const sender={id:fixture.api.runtime.id,url:'https://site11.test/',tab:fixture.tabs.get(11)};
    await assert.rejects(send('RESTORE_TRASH',{tabId:2},sender),/已被取回或关闭/);
    await assert.rejects(send('SAVE_SETTINGS',{settings:{enabled:false}},sender),/不受支持/);
  });
  await t.test('网页不响应通知时，保存、白名单、收纳和后续垃圾桶请求仍可完成',async()=> {
    const originalSend=fixture.api.tabs.sendMessage, originalNow=Date.now;
    let release;const unresponsive=new Promise(resolve=>{release=resolve;});
    const notifications=[];
    fixture.api.tabs.sendMessage=(id,message)=>{notifications.push(message.type);return unresponsive;};
    async function responsive(promise) {
      let timer;
      try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('后台请求被网页通知阻塞')),500);})]); }
      finally {clearTimeout(timer);}
    }
    try {
      const saved=await responsive(send('SAVE_SETTINGS',{settings:{idleMinutes:90}}));
      assert.equal(saved.settings.idleMinutes,90);
      assert.equal((await fixture.api.storage.local.get('settings')).settings.idleMinutes,90);
      assert.ok(Array.isArray((await responsive(send('GET_TRASH'))).tabs));
      await responsive(send('SET_WHITELIST',{tabId:11,value:true}));
      assert.equal((await responsive(send('GET_WIDGET',{tabId:11}))).whitelisted,true);
      fixture.seed([{id:12}]);await responsive(send('GET_STATE'));
      Date.now=()=>originalNow()+91*60000;
      assert.ok((await responsive(send('SWEEP'))).count>0);
      assert.ok((await responsive(send('GET_TRASH'))).tabs.some(tab=>tab.id===12));
      assert.ok(notifications.includes('REFRESH_WIDGET'));assert.ok(notifications.includes('FISH_COLLECTED'));
    } finally {Date.now=originalNow;fixture.api.tabs.sendMessage=originalSend;release();}
  });
});

test('旧分组迁移到收纳窗口，丢失会话后仍可识别并跨窗口取回', async()=>{
  const fixture=createChrome(); globalThis.chrome=fixture.api;
  fixture.seed([{id:21},{id:22,active:true,windowId:2}]);
  const group=await fixture.api.tabs.group({tabIds:21});
  await fixture.api.tabGroups.update(group,{title:GROUP_TITLE});
  await import(`../extension/background.js?migration=${Date.now()}`);
  let state=await fixture.message('GET_STATE');
  const stored=state.tabs.find(t=>t.id===21);
  assert.ok(stored.trashedAt); assert.notEqual(stored.windowId,1);
  assert.equal(fixture.tabs.get(21).discarded,false);
  await fixture.api.storage.session.clear();
  await import(`../extension/background.js?restart=${Date.now()}`);
  assert.ok((await fixture.message('GET_TRASH')).tabs.some(t=>t.id===21));
  const sender={id:fixture.api.runtime.id,url:'https://site22.test/',tab:fixture.tabs.get(22)};
  await fixture.message('RESTORE_TRASH',{tabId:21},sender);
  assert.equal(fixture.tabs.get(21).windowId,2);
  assert.equal(fixture.tabs.get(21).active,true);
  assert.equal((await fixture.message('GET_TRASH')).tabs.length,0);
});
