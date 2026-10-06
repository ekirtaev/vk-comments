(() => {
  if (globalThis.__vkCommentsInstalled) return;
  globalThis.__vkCommentsInstalled = true;
  const state = { running: false, stop: false, records: new Map(), report: null, message: 'Готов к запуску.' };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const commentSelector = '[id^="reply"], [data-comment-id], [data-reply-id]';
  let selectedMarkup = null, pickHandler = null;
  const escapeHtml = text => String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  function safeMarkup(node, depth=0) {
    if (node.nodeType === 3) return escapeHtml(node.textContent.slice(0,1500));
    if (node.nodeType !== 1 || /^(SCRIPT|STYLE|INPUT|TEXTAREA|SELECT|IFRAME|SVG|IMG|VIDEO|AUDIO|FORM)$/.test(node.tagName)) return '';
    const attrs=[];
    for (const name of ['id','class','role','title','aria-label','data-testid','data-comment-id','data-reply-id','data-parent-comment-id','data-post-id','data-time','datetime']) {
      const value=node.getAttribute(name); if(value!==null)attrs.push(`${name}="${escapeHtml(value.slice(0,400))}"`);
    }
    if(node.tagName==='A') {
      try {
        const url=new URL(node.getAttribute('href')||'',location.href);
        if(['vk.com','www.vk.com','vk.ru','www.vk.ru'].includes(url.hostname)) {
          const clean=new URL(url.origin+url.pathname);
          for(const key of ['reply','thread','w'])if(url.searchParams.has(key))clean.searchParams.set(key,url.searchParams.get(key));
          attrs.push(`href="${escapeHtml(clean.href)}"`);
        }
      }catch(_){}
    }
    const content=depth<7?[...node.childNodes].slice(0,24).map(child=>safeMarkup(child,depth+1)).join(''):'';
    return `<${node.tagName.toLowerCase()} ${attrs.join(' ')}>${content}</${node.tagName.toLowerCase()}>`;
  }
  function diagnostics() {
    const post=postId(), root=scope(post);
    return {version:'0.3.0',post_url:`https://vk.com/wall${post.key}`,created_at:new Date().toISOString(),
      counts:{legacy_candidates:root.querySelectorAll(commentSelector).length,
        modern_texts:root.querySelectorAll('[data-testid="comment-text"]').length,
        reply_links:root.querySelectorAll('a[href*="reply="]').length,
        thread_links:root.querySelectorAll('a[href*="thread="]').length},
      buttons:loaders(root).slice(0,20).map(el=>({text:el.textContent.trim().slice(0,160),class:el.className})),
      permalink_samples:[...root.querySelectorAll('a[href*="reply="]')].slice(0,6).map(link=>{
        let node=link, best=link;
        for(let i=0;node&&node!==root&&i<12;i++,node=node.parentElement){
          const count=node.querySelectorAll('[data-testid="comment-text"]').length;
          if(count>1)break;
          best=node;if(count===1)break;
        }
        return safeMarkup(best).slice(0,16000);
      }),
      selected_comment:selectedMarkup,
      note:'Только выбранный фрагмент страницы и признаки разметки. Проверь содержимое перед отправкой. Cookies, токены, поля форм и скрипты не собираются.'};
  }
  function pickComment() {
    if(pickHandler)document.removeEventListener('click',pickHandler,true);
    pickHandler=event=>{
      event.preventDefault();event.stopPropagation();
      let node=event.target instanceof Element?event.target:null;
      if(!node)return;
      const samples=[];
      for(let i=0;node&&node!==document.body&&i<10;i++,node=node.parentElement){
        if(node.querySelectorAll('[data-testid="comment-text"]').length>1)break;
        samples.push(safeMarkup(node).slice(0,16000));
      }
      selectedMarkup={samples,selected_at:new Date().toISOString()};
      document.removeEventListener('click',pickHandler,true);pickHandler=null;
      state.message='Фрагмент комментария выбран. Нажми «Скачать диагностику» и проверь файл перед отправкой.';
    };
    document.addEventListener('click',pickHandler,true);
  }
  function postId() {
    const url = new URL(location.href);
    const match = (url.pathname + ' ' + (url.searchParams.get('w') || '')).match(/wall(-?\d+)_(\d+)/);
    if (!match) throw new Error('Открой отдельный пост по ссылке вида https://vk.com/wall-123_456.');
    return { owner: match[1], post: match[2], key: `${match[1]}_${match[2]}` };
  }
  function scope(post) {
    const exact = document.getElementById('post' + post.key);
    if (exact) return exact;
    // Only the standalone post route can use the page as a scope. A feed is ambiguous.
    if (new URL(location.href).pathname.match(/^\/wall-?\d+_\d+\/?$/)) return document.body;
    throw new Error('Контейнер выбранного поста не найден. Открой пост на отдельной странице, вне ленты.');
  }
  function idOf(el, post) {
    const native = (el.id || '').match(/^reply(-?\d+)_(\d+)$/);
    if (native) return native[1] === post.owner ? native[2] : null;
    const data = el.getAttribute('data-comment-id') || el.getAttribute('data-reply-id');
    if (data && /^\d+$/.test(data)) return data;
    if (data) {
      const pair = data.match(/^(-?\d+)_(\d+)$/);
      if (pair && pair[1] === post.owner) return pair[2];
    }
    return null;
  }
  function permalink(link, post) {
    try {
      const url=new URL(link.href,location.href);
      if(!['vk.com','www.vk.com','vk.ru','www.vk.ru'].includes(url.hostname))return null;
      const wall=(url.pathname+' '+(url.searchParams.get('w')||'')).match(/wall(-?\d+)_(\d+)/);
      if(!wall||wall[1]!==post.owner||wall[2]!==post.post)return null;
      const id=url.searchParams.get('reply'), thread=url.searchParams.get('thread');
      if(!id||!/^\d+$/.test(id))return null;
      return {id,root:thread&&/^\d+$/.test(thread)&&thread!==id?thread:''};
    }catch(_){return null;}
  }
  function candidates(root,post) {
    const result=[...root.querySelectorAll(commentSelector)].map(el=>({el,id:idOf(el,post),modern:false})).filter(item=>item.id);
    for(const textEl of root.querySelectorAll('[data-testid="comment-text"]')){
      let container=textEl.parentElement;
      for(let depth=0;container&&depth<18;depth++,container=container.parentElement){
        if(container.querySelectorAll('[data-testid="comment-text"]').length!==1)break;
        const links=[...container.querySelectorAll('a[href*="reply="]')].filter(link=>!textEl.contains(link)).map(link=>({link,ref:permalink(link,post)})).filter(item=>item.ref);
        const ids=new Set(links.map(item=>item.ref.id));
        // Never assign the ID of another comment mentioned inside the text.
        if(ids.size===1){
          const item=links[0];result.push({el:container,id:item.ref.id,root:item.ref.root,link:item.link,textEl,modern:true});break;
        }
        if(container===root)break;
      }
    }
    return result;
  }
  function collect(root, post) {
    let added = 0;
    for (const candidate of candidates(root,post)) {
      const {el,id}=candidate;
      const own = selector => [...el.querySelectorAll(selector)].find(child => candidate.modern || child.closest(commentSelector) === el) || null;
      const textEl = candidate.textEl || own('.wall_reply_text, .reply_text, [data-testid="comment-text"]');
      const author = own('.author, .reply_author, [data-testid="comment-author"]') || (candidate.modern?[...el.querySelectorAll('a[href]')].find(link=>{
        if(!link.textContent.trim()||permalink(link,post))return false;
        try{const url=new URL(link.href,location.href);return ['vk.com','www.vk.com','vk.ru','www.vk.ru'].includes(url.hostname)&&/^\/[a-zA-Z0-9_.]+\/?$/.test(url.pathname)&&!['/feed','/im','/login','/away.php'].includes(url.pathname);}catch(_){return false;}
      }):null);
      const dateEl = own('time, .rel_date, .reply_date') || candidate.link;
      const likeEl = own('.like_count, .like_btn_count, [data-testid="like-count"]');
      const parentLink = own('a[href*="reply="]');
      let parent = el.getAttribute('data-parent-comment-id') || candidate.root || '';
      if (!parent && parentLink) {
        try {
          const value = new URL(parentLink.href).searchParams.get('reply');
          if (value && value !== id) parent = value;
        } catch (_) {}
      }
      if (!parent) {
        const ancestor = el.parentElement?.closest(commentSelector);
        if (ancestor) parent = idOf(ancestor, post) || '';
      }
      const profileUrl = author?.href || '';
      const user = profileUrl.match(/\/(id|club|public)(\d+)(?:[/?#]|$)/);
      const unix = dateEl?.getAttribute('data-time') || dateEl?.getAttribute('data-timestamp');
      const parsedDate=unix&&/^\d+$/.test(unix)?new Date(Number(unix)*1000):null;
      const date = parsedDate&&Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : dateEl?.getAttribute('datetime') || '';
      const rawLikes = (likeEl?.textContent || '').trim();
      const likes = /^\d+$/.test(rawLikes) ? Number(rawLikes) : '';
      const old = state.records.get(id);
      const record = {
        comment_id: id, parent_comment_id: parent,
        author_name: (author?.textContent || '').trim(), author_profile_url: profileUrl,
        user_id: user ? (user[1] === 'id' ? '' : '-') + user[2] : '', date,
        text: textEl?.innerText ?? '', is_reply: parent ? true : '', likes,
        comment_url: `https://vk.com/wall${post.key}?reply=${id}`,
        date_display: (dateEl?.textContent || '').trim(), parent_known: !!parent,
        text_extracted: !!textEl
      };
      // Keep metadata/text already extracted if a later virtualized element has blanks.
      if (old) for (const key of Object.keys(record)) if (record[key] === '' && old[key] !== '') record[key] = old[key];
      if (!old) added++;
      state.records.set(id, record);
    }
    return added;
  }
  function loaders(root) {
    return [...root.querySelectorAll('button, a, [role="button"]')].filter(el => {
      if (!visible(el) || el.closest('#vk-comments-extension')) return false;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const fullText=/^(показать полностью|читать полностью|show more|read more)$/i.test(text)&&!!el.parentElement?.querySelector('[data-testid="comment-text"], [data-testid="showmoretext-in"]');
      return /^(показать|загрузить|ещ[её]|предыдущие|следующие|show|load|view|more|читать)/i.test(text)
        && (/(комментар|ответ|comment|repl)/i.test(text)||fullText)
        && !/(скрыть|свернуть|hide|collapse)/i.test(text)
        && (el.tagName !== 'A' || !el.getAttribute('href') || el.getAttribute('href').startsWith('#') || el.getAttribute('href').startsWith('javascript:'));
    });
  }
  function advance(root) {
    const containers = new Set([document.scrollingElement]);
    let ancestor = root;
    while (ancestor instanceof Element) {
      if (ancestor.scrollHeight > ancestor.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(ancestor).overflowY)) containers.add(ancestor);
      ancestor = ancestor.parentElement;
    }
    for (const el of root.querySelectorAll('*')) {
      if (visible(el) && el.clientHeight > 120 && el.scrollHeight > el.clientHeight + 50 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) containers.add(el);
    }
    let moved = false;
    for (const el of containers) {
      if (!el) continue;
      const before = el.scrollTop;
      el.scrollTop += Math.max(250, el.clientHeight * .7);
      moved ||= Math.abs(el.scrollTop - before) > 2;
    }
    return moved;
  }
  async function run() {
    if (state.running) return;
    const post = postId();
    let root = scope(post);
    state.records.clear();
    state.stop = false; state.running = true;
    state.report = { post_url: `https://vk.com/wall${post.key}`, started_at: new Date().toISOString(),
      status: 'running', completeness: 'Не подтверждена', warnings: [], rounds: 0 };
    state.message = 'Сбор начат. Не обновляй вкладку.';
    let idle = 0, loaderCursor = 0;
    try {
      for (let round = 0; round < 2000; round++) {
        if (state.stop) { state.report.status = 'stopped'; break; }
        if (postId().key !== post.key) throw new Error('Открыт другой пост: сбор остановлен.');
        root = scope(post);
        const before = state.records.size;
        collect(root, post);
        const buttons = loaders(root);
        // One loading action at a time avoids racing several independent requests.
        if (buttons.length) buttons[loaderCursor++ % buttons.length].click();
        const moved = advance(root);
        await sleep(3500 + Math.min(idle * 1000, 5000));
        root = scope(post);
        collect(root, post);
        idle = state.records.size > before || moved ? 0 : idle + 1;
        state.report.rounds = round + 1;
        state.message = `Собрано ${state.records.size} уникальных записей.\nОжиданий без прогресса: ${idle}/8.`;
        if (idle >= 8) {
          state.report.status = state.records.size ? 'no_progress' : 'unsupported_markup';
          state.report.warnings.push('Новых ID нет после 8 ожиданий. Это не подтверждает полный сбор. Возможны скрытые ветки, другой интерфейс или задержка VK.');
          break;
        }
        if (round === 1999) state.report.status = 'round_limit';
      }
    } catch (error) {
      state.report.status = 'error';
      state.report.warnings.push(error.message);
    } finally {
      state.running = false;
      state.report.finished_at = new Date().toISOString();
      state.report.unique_comments = state.records.size;
      state.report.missing_text = [...state.records.values()].filter(r => !r.text_extracted).length;
      state.report.unknown_parent = [...state.records.values()].filter(r => !r.parent_known).length;
      state.message = `Сбор остановлен: ${state.report.status}.\nЗаписей: ${state.records.size}. Полнота не подтверждена.\nСкачай результат и отчёт.`;
    }
  }
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'vk-diagnostics') {
      try { sendResponse(diagnostics()); } catch(error) { sendResponse({error:error.message}); }
    } else if(request.type === 'vk-pick') {
      try { postId(); scope(postId()); pickComment(); sendResponse({ok:true}); } catch(error) { sendResponse({error:error.message}); }
    } else if (request.type === 'vk-start') {
      try { postId(); scope(postId()); run(); sendResponse({ ok: true }); }
      catch (error) { sendResponse({ error: error.message }); }
    } else if (request.type === 'vk-stop') {
      state.stop = true; sendResponse({ ok: true });
    } else if (request.type === 'vk-status') {
      sendResponse({ running: state.running, count: state.records.size, message: state.message });
    } else if (request.type === 'vk-export') {
      sendResponse({ report: { ...state.report, snapshot_at: new Date().toISOString(), running: state.running }, records: [...state.records.values()] });
    }
  });
})();
