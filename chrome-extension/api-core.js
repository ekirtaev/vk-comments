/* VK API transport and traversal. Does not persist credentials or raw error payloads. */
globalThis.VKApi = (() => {
  const fields = ['comment_id','parent_comment_id','thread_root_id','author_name','author_profile_url','user_id','date','text','is_reply','likes','comment_url'];
  class Stopped extends Error { constructor(){super('Остановлено пользователем.');this.name='Stopped';} }
  function parsePost(value) {
    let url;
    try { url=new URL(value.trim()); } catch(_){throw new Error('Вставь HTTPS-ссылку на пост VK.');}
    if(url.protocol!=='https:' || !['vk.com','www.vk.com','m.vk.com','vk.ru','www.vk.ru','m.vk.ru'].includes(url.hostname)) throw new Error('Нужна HTTPS-ссылка VK.');
    const match=(url.pathname+' '+(url.searchParams.get('w')||'')).match(/wall(-?\d+)_(\d+)/);
    if(!match)throw new Error('В ссылке не найден wallOWNER_POST.');
    return {owner:Number(match[1]),post:Number(match[2]),url:`https://vk.com/wall${match[1]}_${match[2]}`};
  }
  function errorText(code) {
    const messages={5:'Токен недействителен или истёк.',7:'Метод недоступен этому приложению или токену.',14:'VK требует CAPTCHA. Автоматический обход не выполняется.',15:'Нет доступа к посту.',27:'Токен сообщества не подходит.',28:'Доступ приложения ограничен.',29:'Превышен лимит запросов VK.',212:'Нет доступа к комментариям.'};
    return `VK: ошибка ${code}. ${messages[code]||'Запрос отклонён. Проверь доступ приложения.'}`;
  }
  class Client {
    constructor(token,{fetchImpl=globalThis.fetch,interval=400,waitImpl}={}){
      if(!token?.trim())throw new Error('Введи токен VK API.');
      this.token=token.trim();this.fetchImpl=fetchImpl;this.interval=interval;this.last=0;this.cancelled=false;
      this.waitImpl=waitImpl||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
      this.controller=null;
    }
    stop(){this.cancelled=true;this.controller?.abort();}
    clear(){this.token='';}
    async wait(ms){
      // Short slices let Stop interrupt long retry delays.
      for(let left=ms;left>0;left-=200){if(this.cancelled)throw new Stopped();await this.waitImpl(Math.min(200,left));}
      if(this.cancelled)throw new Stopped();
    }
    async call(method,params){
      for(let attempt=0;attempt<6;attempt++){
        await this.wait(Math.max(0,this.interval-(Date.now()-this.last)));
        this.controller=new AbortController();
        const timeout=setTimeout(()=>this.controller?.abort(),25000);
        this.last=Date.now();
        let data;
        try{
          const response=await this.fetchImpl('https://api.vk.com/method/'+method,{method:'POST',
            headers:{'Content-Type':'application/x-www-form-urlencoded'},
            body:new URLSearchParams({...params,access_token:this.token,v:'5.199'}).toString(),
            signal:this.controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
          if(!response.ok)throw new Error('HTTP');
          data=await response.json();
        }catch(_){
          if(this.cancelled)throw new Stopped();
          if(attempt===5)throw new Error('Сеть или ответ VK недоступны после 6 попыток. Собранные данные сохранены в памяти.');
        }finally{clearTimeout(timeout);this.controller=null;}
        if(!data){await this.wait(Math.min(2**attempt*1000,16000));continue;}
        if(data.error){
          const code=data.error.error_code;
          if([6,9,10,29].includes(code)&&attempt<5){await this.wait(Math.min(2**(attempt+1)*1000,30000));continue;}
          // Do not echo error_msg or request_params; VK may include credentials there.
          const error=new Error(errorText(code));error.vkCode=code;throw error;
        }
        if(!data.response || !Array.isArray(data.response.items))throw new Error('Неожиданный формат ответа VK: нет массива items.');
        return data.response;
      }
    }
  }
  class Collector {
    constructor(client,post,progress=()=>{}){
      this.client=client;this.post=post;this.progress=progress;this.comments=new Map();this.authors=new Map();
      this.report={source:'vk_api',post_url:post.url,started_at:new Date().toISOString(),status:'running',scopes:[],warnings:[],requests:0,
        completeness:'Не подтверждена: обход API не доказывает совпадение с интерфейсом VK.'};
    }
    add(item,root){
      if(!Number.isInteger(item.id))throw new Error('VK вернул комментарий без числового ID.');
      const old=this.comments.get(item.id)||{};
      this.comments.set(item.id,{...old,...item,...(root?{_root:root}:{})});
    }
    async page(root=null){
      let offset=0;const ids=new Set();
      const scope={root_id:root,expected:null,collected:0,status:'running'};this.report.scopes.push(scope);
      try{
        while(true){
          const params={owner_id:this.post.owner,post_id:this.post.post,count:100,offset,sort:'asc',need_likes:1,extended:1,preview_length:0,thread_items_count:root===null?10:0};
          if(root!==null)params.comment_id=root;
          this.report.requests++;
          const response=await this.client.call('wall.getComments',params);
          for(const profile of response.profiles||[])this.authors.set(profile.id,[profile.first_name,profile.last_name].filter(Boolean).join(' '));
          for(const group of response.groups||[])this.authors.set(-group.id,group.name||'');
          if(root===null && offset===0)this.report.api_count=response.count??null;
          if(response.current_level_count!==undefined){
            if(scope.expected!==null&&scope.expected!==response.current_level_count)this.report.warnings.push(`Изменился счётчик уровня ${root??'основные'}.`);
            scope.expected=response.current_level_count;
          }
          const items=response.items;
          if(items.length&&!items.some(c=>!ids.has(c.id))){scope.status='repeated_page';this.report.warnings.push(`Повторная страница уровня ${root??'основные'}; проход остановлен.`);break;}
          for(const item of items){this.add(item,root);ids.add(item.id);for(const reply of item.thread?.items||[])this.add(reply,item.id);}
          scope.collected=ids.size;
          this.progress({count:this.comments.size,message:`${root===null?'Основные комментарии':'Ответы ветки '+root}: ${ids.size}. Всего уникальных: ${this.comments.size}.`,requests:this.report.requests});
          if(!items.length){
            scope.status='exhausted';
            if(scope.expected!==null&&ids.size!==scope.expected)this.report.warnings.push(`Уровень ${root??'основные'}: получено ${ids.size}, API заявил ${scope.expected}.`);
            break;
          }
          offset+=items.length;
        }
      }catch(error){scope.status=error instanceof Stopped?'stopped':'failed';throw error;}
      return ids;
    }
    async run(){
      try{
        const roots=await this.page();
        for(const id of roots){
          const declared=this.comments.get(id).thread?.count||0;
          if(!declared && !this.comments.get(id).thread?.items?.length)continue;
          try{
            const replies=await this.page(id);
            if(replies.size!==declared)this.report.warnings.push(`Ветка ${id}: API заявил ${declared}, отдельный проход вернул ${replies.size}.`);
          }catch(error){if(error instanceof Stopped || [5,7,14,27,28,29].includes(error.vkCode))throw error;this.report.warnings.push(`Ветка ${id}: ${error.message}`);}
        }
        this.report.status=this.report.warnings.length||this.report.scopes.some(s=>s.status!=='exhausted')?'partial':'traversal_finished';
      }catch(error){this.report.status=error instanceof Stopped?'stopped':'failed';if(!(error instanceof Stopped))this.report.warnings.push(error.message);}
      finally{
        this.client.clear();this.report.finished_at=new Date().toISOString();this.report.unique_comments=this.comments.size;
        this.report.replies=this.rows().filter(c=>c.is_reply).length;
      }
      return this;
    }
    rows(){return [...this.comments.values()].sort((a,b)=>(a.date||0)-(b.date||0)||a.id-b.id).map(c=>{
      const root=c._root||c.parents_stack?.[0]||'';
      const parent=c.reply_to_comment||root;
      const uid=c.from_id;
      const timestamp=new Date(c.date*1000);
      return {comment_id:String(c.id),parent_comment_id:parent?String(parent):'',thread_root_id:root?String(root):'',
        author_name:this.authors.get(uid)||'',author_profile_url:uid===undefined?'':`https://vk.com/${uid<0?'club'+(-uid):'id'+uid}`,
        user_id:uid===undefined?'':String(uid),date:Number.isFinite(c.date)&&Number.isFinite(timestamp.getTime())?timestamp.toISOString():'',text:c.text??'',
        is_reply:!!parent,likes:c.likes?.count??'',comment_url:`${this.post.url}?reply=${c.id}`};
    });}
    snapshot(){return {report:{...this.report,snapshot_at:new Date().toISOString()},records:this.rows(),raw_comments:[...this.comments.values()],authors:Object.fromEntries(this.authors)};}
  }
  return {fields,parsePost,Client,Collector,Stopped};
})();
