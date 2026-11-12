// A contract-oriented Chrome API fixture for unit/integration tests only.
// The production extension never imports this file.
export function createChrome() {
  const event = () => {
    const listeners = [];
    return { addListener: fn => listeners.push(fn), removeListener: fn => { const i=listeners.indexOf(fn); if(i>=0) listeners.splice(i,1); }, emit: (...args) => listeners.forEach(fn=>fn(...args)), listeners };
  };
  const copy = value => structuredClone(value);
  const storageChanges = event();
  const storageArea = name => {
    let data = {};
    return {
      async get(keys) { return copy(keys == null ? data : Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))); },
      async set(patch) { const changes = {}; for (const [key,value] of Object.entries(patch)) { changes[key]={oldValue:data[key],newValue:copy(value)}; data[key]=copy(value); } storageChanges.emit(changes,name); },
      async clear() { data = {}; }
    };
  };
  const tabs = new Map(), groups = new Map(), notices = [], alarms = new Map(); let nextGroup = 100, nextWindow = 100, nextTab = 10000;
  const windows = new Map();
  const api = {
    runtime: { id:'test-fish', getURL:file=>`chrome-extension://test-fish/${file}`, onMessage:event(), onInstalled:event(), openOptionsPage:async()=>{ notices.push({id:null,message:{type:'OPTIONS_OPENED'}}); } },
    scripting: { executeScript:async()=>[] },
    storage: { local:storageArea('local'), session:storageArea('session'), onChanged:storageChanges },
    alarms: { create:async(name,options)=>alarms.set(name,options), onAlarm:event() },
    windows: {
      async get(id) { if(!windows.has(id)) throw new Error('No window'); return copy(windows.get(id)); },
      async getAll() { return copy([...windows.values()]); },
      async update(id,patch) { const window=await api.windows.get(id); Object.assign(window,patch); windows.set(id,window); return copy(window); },
      async create(options) {
        const id=nextWindow++; windows.set(id,{id,state:'normal',focused:!!options.focused,type:'normal',incognito:false});
        if(options.tabId) await api.tabs.move(options.tabId,{windowId:id,index:-1});
        else await api.tabs.create({url:options.url,windowId:id,active:true});
        return api.windows.get(id);
      }
    },
    tabs: {
      onCreated:event(), onRemoved:event(), onUpdated:event(), onActivated:event(), onReplaced:event(),
      async get(id) { if(!tabs.has(id)) throw new Error('No tab'); return copy(tabs.get(id)); },
      async query(query) { return copy([...tabs.values()].filter(tab=>Object.entries(query).every(([k,v])=>k==='lastFocusedWindow'||k==='currentWindow'||tab[k]===v))); },
      async update(id,patch) {
        if(!tabs.has(id)) throw new Error('No tab');
        const tab = tabs.get(id);
        if(patch.active) { for(const t of tabs.values()) if(t.windowId===tab.windowId)t.active=false; }
        Object.assign(tab,patch); api.tabs.onUpdated.emit(id,patch,copy(tab));
        if(patch.active) api.tabs.onActivated.emit({tabId:id,windowId:tab.windowId}); return copy(tab);
      },
      async move(id,options) {
        const tab=tabs.get(id); if(!tab) throw new Error('No tab');
        tab.windowId=options.windowId; tab.groupId=-1; tab.active=false;
        api.tabs.onUpdated.emit(id,{groupId:-1},copy(tab)); return copy(tab);
      },
      async group(options) {
        const ids = [].concat(options.tabIds), first=tabs.get(ids[0]); if(!first) throw new Error('No tab');
        const groupId = options.groupId ?? nextGroup++;
        if(!groups.has(groupId)) groups.set(groupId,{id:groupId,title:'',windowId:first.windowId,collapsed:false});
        for(const id of ids) { const tab=tabs.get(id); if(tab.windowId!==groups.get(groupId).windowId) throw new Error('Wrong window'); tab.groupId=groupId; tab.pinned=false; api.tabs.onUpdated.emit(id,{groupId},copy(tab)); }
        return groupId;
      },
      async ungroup(ids) { for(const id of [].concat(ids)) { const tab=tabs.get(id); if(!tab) throw new Error('No tab'); tab.groupId=-1; api.tabs.onUpdated.emit(id,{groupId:-1},copy(tab)); } },
      async discard(id) { const tab=tabs.get(id); if(tab.active) throw new Error('Cannot discard active tab'); tab.discarded=true; return copy(tab); },
      async remove(ids) { for(const id of [].concat(ids)) { if(!tabs.has(id)) throw new Error('No tab'); tabs.delete(id); api.tabs.onRemoved.emit(id,{isWindowClosing:false}); } },
      async sendMessage(id,message) { notices.push({id,message}); },
      async create(options) { const id=nextTab++; const tab={id,windowId:1,active:true,groupId:-1,...options};tabs.set(id,tab);api.tabs.onCreated.emit(copy(tab));return copy(tab); }
    },
    tabGroups: {
      async query(query) { return copy([...groups.values()].filter(group=>Object.entries(query).every(([k,v])=>group[k]===v))); },
      async get(id) { if(!groups.has(id)) throw new Error('No group');return copy(groups.get(id)); },
      async update(id,patch) { if(!groups.has(id)) throw new Error('No group');Object.assign(groups.get(id),patch);return copy(groups.get(id)); }
    }
  };
  function seed(values) { for(const value of values) { windows.set(value.windowId||1,{id:value.windowId||1,state:'normal',type:'normal',incognito:false}); tabs.set(value.id,{url:`https://site${value.id}.test/`,title:`标签 ${value.id}`,windowId:1,active:false,pinned:false,audible:false,incognito:false,groupId:-1,discarded:false,...value}); } }
  async function message(type,data={},sender={id:api.runtime.id,url:api.runtime.getURL('options.html')}) {
    const response=await new Promise(resolve=>{ for(const listener of api.runtime.onMessage.listeners)listener({type,...data},sender,resolve); });
    if(!response?.ok) throw new Error(response?.error||'No response'); return response.data;
  }
  return { api,tabs,groups,notices,alarms,seed,message };
}
