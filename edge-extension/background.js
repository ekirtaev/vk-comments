chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== 'vk-page-data') return;
  if (!sender.tab?.id || sender.frameId !== 0) { sendResponse({error: 'Нет активной вкладки.'}); return; }
  let url;
  try { url = new URL(sender.url); } catch (_) { sendResponse({error: 'Неизвестная страница.'}); return; }
  if (url.protocol !== 'https:' || !['vk.com','www.vk.com','vk.ru','www.vk.ru','vkvideo.ru','www.vkvideo.ru'].includes(url.hostname)) {
    sendResponse({error: 'Страница не поддерживается.'}); return;
  }
  chrome.scripting.executeScript({target: {tabId: sender.tab.id, frameIds: [0]}, world: 'MAIN', files: ['page-data.js']})
    .then(results => sendResponse(results[0]?.result || {error: 'Данные компонентов недоступны.'}))
    .catch(() => sendResponse({error: 'Не удалось прочитать данные компонентов страницы.'}));
  return true;
});
