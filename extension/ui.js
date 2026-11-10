export async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '大肥鱼暂时没响应，请重新打开插件');
  return response.data;
}
let toastTimer;
export function toast(text, error = false) {
  const el = document.getElementById('toast'); el.textContent = text; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}
