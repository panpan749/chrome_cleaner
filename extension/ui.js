export async function request(type, data = {}) {
  let timer;
  try {
    const response = await Promise.race([
      chrome.runtime.sendMessage({ type, ...data }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('插件响应超时，请重新打开页面确认结果；若仍无响应，请重新加载插件。')), 10000); })
    ]);
    if (!response?.ok) throw new Error(response?.error || '大肥鱼暂时没响应，请重新打开插件');
    return response.data;
  } finally { clearTimeout(timer); }
}
let toastTimer;
export function toast(text, error = false) {
  const el = document.getElementById('toast'); el.textContent = text; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}
