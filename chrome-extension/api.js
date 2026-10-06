const el=id=>document.getElementById(id);
let activeClient=null,collector=null,busy=false;
function controls(){
  for(const id of ['url','token','check','start'])el(id).disabled=busy;
  el('stop').disabled=!busy;
  for(const id of ['csv','xlsx'])el(id).disabled=busy||!collector?.comments.size;
  el('json').disabled=busy||!collector;
}
function showReport(){
  el('details').textContent=collector?JSON.stringify(collector.report,null,2):'';
}
function inputs(){return {post:VKApi.parsePost(el('url').value),token:el('token').value};}
el('check').addEventListener('click',async()=>{
  if(busy)return;
  try{
    const {post,token}=inputs();activeClient=new VKApi.Client(token);busy=true;controls();
    el('status').textContent='Проверяю доступ к комментариям…';
    const response=await activeClient.call('wall.getComments',{owner_id:post.owner,post_id:post.post,count:1,sort:'asc',preview_length:0});
    el('status').textContent=`Доступ подтверждён. API сообщает count=${response.count??'не указан'}.\nЭто пробный запрос, полная выгрузка ещё не запускалась. Нажми Start.`;
  }catch(error){el('status').textContent=error.message;}
  finally{activeClient?.clear();activeClient=null;busy=false;controls();}
});
el('start').addEventListener('click',async()=>{
  if(busy)return;
  if(collector?.comments.size&&!confirm('Новая выгрузка заменит предыдущую в этой вкладке. Результат уже скачан?'))return;
  try{
    const {post,token}=inputs();activeClient=new VKApi.Client(token);
    collector=new VKApi.Collector(activeClient,post,progress=>{el('status').textContent=progress.message;});
    busy=true;controls();el('details').textContent='';el('status').textContent='Начат полный обход API…';
    await collector.run();
    el('status').textContent=`Статус: ${collector.report.status}. Записей: ${collector.comments.size}.\nМожно скачать результат. Полнота не подтверждена.`;
    showReport();
  }catch(error){el('status').textContent=error.message;}
  finally{activeClient?.clear();activeClient=null;el('token').value='';busy=false;controls();}
});
el('stop').addEventListener('click',()=>{activeClient?.stop();el('status').textContent='Останавливаю запросы. Собранное останется доступным для скачивания.';});
function download(data,mime,name){
  const url=URL.createObjectURL(new Blob([data],{type:mime}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
for(const kind of ['csv','xlsx','json'])el(kind).addEventListener('click',()=>{
  if(!collector||busy)return;
  try{
    const data=collector.snapshot(),name='VK_comments_API_'+new Date().toISOString().replace(/[:.]/g,'-');
    if(kind==='json')download(JSON.stringify(data,null,2),'application/json',name+'.json');
    else if(kind==='xlsx')download(VKXlsx.create(VKApi.fields,data.records,data.report),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',name+'.xlsx');
    else{
      const cell=value=>{let s=String(value??'');if(/^\s*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
      download('\ufeff'+[VKApi.fields,...data.records.map(r=>VKApi.fields.map(k=>r[k]))].map(row=>row.map(cell).join(';')).join('\r\n'),'text/csv;charset=utf-8',name+'.csv');
    }
  }catch(error){el('status').textContent='Ошибка экспорта: '+error.message;}
});
window.addEventListener('beforeunload',event=>{
  if(busy||collector?.comments.size){event.preventDefault();event.returnValue='';}
});
controls();
