const fields = ['comment_id','parent_comment_id','author_name','author_profile_url','user_id','date','text','is_reply','likes','comment_url','date_display','parent_known','text_extracted'];
let tabId;
const statusEl = document.getElementById('status');
document.getElementById('api').addEventListener('click', () => chrome.tabs.create({url: chrome.runtime.getURL('api.html')}));
document.getElementById('pick').addEventListener('click', async () => {
  try { await send('vk-pick'); statusEl.textContent = 'Щёлкни по тексту одного комментария на странице, затем снова открой расширение.'; window.close(); }
  catch(error) { statusEl.textContent = error.message; }
});
document.getElementById('diagnostics').addEventListener('click', async () => {
  try { const data = await send('vk-diagnostics'); download(JSON.stringify(data,null,2),'application/json','VK_markup_diagnostics.json'); }
  catch(error) { statusEl.textContent = error.message; }
});
function download(data, mime, name) {
  const url = URL.createObjectURL(new Blob([data], {type: mime}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function send(type) {
  if (!tabId) throw new Error('Открой пост VK или видео VK Видео и снова нажми значок расширения.');
  const answer = await chrome.tabs.sendMessage(tabId, {type});
  if (answer.error) throw new Error(answer.error);
  return answer;
}
async function refresh() {
  try {
    const result = await send('vk-status');
    statusEl.textContent = result.message;
    document.getElementById('start').disabled = result.running;
    document.getElementById('stop').disabled = !result.running;
    for (const id of ['csv','xlsx']) document.getElementById(id).disabled = !result.count;
    document.getElementById('report').disabled = false;
  } catch (error) { statusEl.textContent = error.message; }
}
for (const id of ['start','stop','csv','xlsx','report']) {
  document.getElementById(id).addEventListener('click', async () => {
    try {
      if (id === 'start' || id === 'stop') { await send('vk-' + id); await refresh(); return; }
      const data = await send('vk-export');
      const name = 'VK_comments_' + new Date().toISOString().replace(/[:.]/g,'-');
      if (id === 'report') download(JSON.stringify(data, null, 2), 'application/json', name + '.json');
      else if (id === 'csv') {
        const cell = value => {
          let text = String(value ?? '');
          if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
          return '"' + text.replaceAll('"','""') + '"';
        };
        const rows = [fields, ...data.records.map(r => fields.map(k => r[k]))];
        download('\ufeff' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8', name + '.csv');
      } else download(VKXlsx.create(fields, data.records, data.report), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', name + '.xlsx');
    } catch (error) { statusEl.textContent = error.message; }
  });
}
(async () => {
  try {
    const [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    const url = new URL(tab.url);
    if (!['vk.com','www.vk.com','vk.ru','www.vk.ru','vkvideo.ru','www.vkvideo.ru'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Открой HTTPS-страницу поста VK или видео на vkvideo.ru.');
    tabId = tab.id;
    await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
    await refresh();
    setInterval(refresh, 1500);
  } catch(error) { statusEl.textContent = error.message; }
})();
