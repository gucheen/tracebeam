import { chooseLogPath, listenForFileDrop, openLog, queryLogs, refreshLog, updateFieldConfig } from './backend';
import { escapeHtml as esc, formatBytes as bytes, formatTime } from './format';
import { defaultFields, type Entry, type FieldConfig, type FileInfo, type LogQuery, type QueryResult as Result, type RecentFile } from './types';
import './style.css';
const savedFields = localStorage.getItem('tracebeam.fields');
let fieldConfig: FieldConfig = defaultFields;
try { if(savedFields) fieldConfig={...defaultFields,...JSON.parse(savedFields)}; } catch { localStorage.removeItem('tracebeam.fields'); }

const $ = <T extends HTMLElement>(s:string) => document.querySelector<T>(s)!;
const followKey='tracebeam.followLatest';
const state = { info:null as FileInfo|null, levels:new Set<string>(), scopes:new Set<string>(), page:0, limit:250, regex:false, caseSensitive:false, followLatest:localStorage.getItem(followKey)==='true', timer:0 };
const recentKey='tracebeam.recentFiles';
let recentFiles:RecentFile[]=[];
try { recentFiles=JSON.parse(localStorage.getItem(recentKey)||'[]').filter((item:RecentFile)=>item?.path&&item?.name).slice(0,10); } catch { localStorage.removeItem(recentKey); }
const parseFields = (id:string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value.split(',').map(v=>v.trim()).filter(Boolean);

function applyTheme(theme:string){ document.documentElement.dataset.theme=theme; localStorage.setItem('tracebeam.theme',theme); $('#theme').textContent=theme==='light'?'☾':'☀'; }
applyTheme(localStorage.getItem('tracebeam.theme') || 'dark');

function setStatus(message:string,error=false){
  const element=$('#resultMeta'); element.textContent=message; element.classList.toggle('error',error);
}

function setFollowLatest(enabled:boolean){
  state.followLatest=enabled; localStorage.setItem(followKey,String(enabled));
  const button=$('#follow'); button.classList.toggle('active',enabled); button.setAttribute('aria-pressed',String(enabled));
  button.title=enabled?'Following new logs — click to stop':'Follow new logs';
  if(enabled&&state.info)query({jumpToLatest:true,scrollToEnd:true});
}

function populateFieldForm(){
  document.querySelector<HTMLInputElement>('#timeFields')!.value=fieldConfig.timeFields.join(', ');
  document.querySelector<HTMLInputElement>('#levelFields')!.value=fieldConfig.levelFields.join(', ');
  document.querySelector<HTMLInputElement>('#scopeFields')!.value=fieldConfig.scopeFields.join(', ');
  document.querySelector<HTMLInputElement>('#messageFields')!.value=fieldConfig.messageFields.join(', ');
}

async function saveFieldConfig(){
  fieldConfig={timeFields:parseFields('timeFields'),levelFields:parseFields('levelFields'),scopeFields:parseFields('scopeFields'),messageFields:parseFields('messageFields')};
  localStorage.setItem('tracebeam.fields',JSON.stringify(fieldConfig));
  const latest=await updateFieldConfig(fieldConfig);
  if(latest){state.info=latest;state.page=0;state.levels.clear();state.scopes.clear();renderInfo();await query()}
  ($('#fieldDialog') as HTMLDialogElement).close();
}

async function chooseFile(){ const path=await chooseLogPath(); if(path)await load(path); }
async function load(path:string){
  try { setStatus('Opening log…'); const info=await openLog(path); state.info=info; rememberFile(info); state.page=0; state.levels.clear(); state.scopes.clear(); renderInfo(); await query(); closeHistory(); }
  catch(e){ $('#resultMeta').textContent=String(e); }
}
function rememberFile(info:FileInfo){
  recentFiles=[{path:info.path,name:info.name,openedAt:Date.now()},...recentFiles.filter(item=>item.path!==info.path)].slice(0,10);
  localStorage.setItem(recentKey,JSON.stringify(recentFiles)); renderHistory();
}
function renderHistory(){
  const menu=$('#historyMenu');
  menu.innerHTML=`<div class="history-head"><b>RECENTLY OPENED</b>${recentFiles.length?'<button id="clearHistory">Clear</button>':''}</div>${recentFiles.length?recentFiles.map((item,index)=>`<button class="history-item" data-index="${index}" title="${esc(item.path)}"><span>${esc(item.name)}</span><small>${esc(item.path)}</small></button>`).join(''):'<div class="history-empty">No recent files</div>'}`;
  menu.querySelectorAll<HTMLButtonElement>('.history-item').forEach(button=>button.onclick=()=>load(recentFiles[Number(button.dataset.index)].path));
  const clear=menu.querySelector<HTMLButtonElement>('#clearHistory'); if(clear)clear.onclick=()=>{recentFiles=[];localStorage.removeItem(recentKey);renderHistory()};
}
function closeHistory(){ $('#historyMenu').hidden=true; $('#history').setAttribute('aria-expanded','false'); }
function toggleHistory(){ const menu=$('#historyMenu'); menu.hidden=!menu.hidden; $('#history').setAttribute('aria-expanded',String(!menu.hidden)); }
function renderInfo(){
  const i=state.info!; $('#filename').textContent=i.name; $('#file').setAttribute('title',i.path); $('#total').textContent=i.total.toLocaleString(); $('#size').textContent=bytes(i.size);
  $('#levels').innerHTML=i.levels.map(v=>check(v,'level')).join(''); $('#scopes').innerHTML=i.scopes.length?i.scopes.map(v=>check(v,'scope')).join(''):'<span class="muted">No scopes found</span>';
}
function check(v:string,type:string){ return `<label class="check"><input type="checkbox" data-type="${type}" value="${esc(v)}"><span class="level-dot ${v.toLowerCase()}"></span><span title="${esc(v)}">${esc(v)}</span></label>`; }
let queryToken=0;
async function query(options:{jumpToLatest?:boolean;scrollToEnd?:boolean}={}){
  if(!state.info)return; const token=++queryToken; const search=document.querySelector<HTMLInputElement>('#search')!; const q={ text:search.value, regex:state.regex, caseSensitive:state.caseSensitive, levels:[...state.levels], scopes:[...state.scopes], offset:state.page*state.limit, limit:state.limit };
  const result=await queryLogs(q satisfies LogQuery); if(token!==queryToken)return;
  const pages=Math.max(1,Math.ceil(result.matched/state.limit));
  if(options.jumpToLatest&&state.page!==pages-1){state.page=pages-1;return query({scrollToEnd:options.scrollToEnd})}
  if(state.page>=pages){state.page=pages-1;return query(options)}
  $('#resultMeta').textContent=result.error?result.error:`${result.matched.toLocaleString()} matches · ${result.elapsedMs} ms`; $('#resultMeta').classList.toggle('error',!!result.error);
  renderRows(result);
  $('#page').textContent=`${state.page+1} / ${pages}`; $('#prev').toggleAttribute('disabled',state.page===0); $('#next').toggleAttribute('disabled',state.page>=pages-1);
  const start=result.matched?state.page*state.limit+1:0, end=Math.min((state.page+1)*state.limit,result.matched); $('#range').textContent=`${start.toLocaleString()}–${end.toLocaleString()} of ${result.matched.toLocaleString()}`; $('#perf').textContent=`Searched ${result.total.toLocaleString()} events in ${result.elapsedMs} ms`;
  if(options.scrollToEnd){const rows=$('#rows');rows.scrollTop=rows.scrollHeight}
}
function renderRows(result:Result){
  const rows=$('#rows'); if(!result.items.length){rows.innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h2>No matching events</h2><p>Try a different query or clear filters</p></div>';return}
  const search = document.querySelector<HTMLInputElement>('#search')!;
  rows.innerHTML=result.items.map(e=>`<button class="row" data-id="${e.id}"><time title="${esc(e.timestamp)}">${esc(formatTime(e.timestamp))}</time><span><b class="badge ${e.level.toLowerCase()}">${esc(e.level)}</b></span><span class="scope">${esc(e.scope||'—')}</span><span class="message">${highlight(e.message,search.value)}</span></button>`).join('');
  rows.querySelectorAll<HTMLButtonElement>('.row').forEach((el,idx)=>el.onclick=()=>showDetail(result.items[idx]));
}
function highlight(s:string,q:string){ if(!q||state.regex)return esc(s); const safe=esc(s), needle=esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return safe.replace(new RegExp(needle,state.caseSensitive?'g':'gi'),m=>`<mark>${m}</mark>`); }
function showDetail(e:Entry){ $('#detailLevel').textContent=e.level; $('#detailLevel').className=`badge ${e.level.toLowerCase()}`; $('#detailTime').textContent=e.timestamp; try{$('#json').textContent=JSON.stringify(JSON.parse(e.raw),null,2)}catch{$('#json').textContent=e.raw} ($('#detail') as HTMLDialogElement).showModal(); }
function debounce(){ window.clearTimeout(state.timer); state.timer=window.setTimeout(()=>{state.page=0;query()},140); }

async function showDemo(){
  if(!new URLSearchParams(location.search).has('demo'))return;
  const raw=await fetch(new URL('../examples/demo.jsonl',import.meta.url)).then(response=>response.text());
  const items:Entry[]=raw.trim().split('\n').map((line,id)=>{
    const value=JSON.parse(line);
    return {id,timestamp:String(value.timestamp||''),level:String(value.level||'other').toUpperCase(),scope:String(value.scope||''),message:String(value.message||''),raw:line};
  });
  state.info={path:'examples/demo.jsonl',name:'demo.jsonl',size:new Blob([raw]).size,total:items.length,levels:[...new Set(items.map(item=>item.level))].sort(),scopes:[...new Set(items.map(item=>item.scope))].sort()};
  renderInfo(); renderRows({items,matched:items.length,total:items.length,elapsedMs:1});
  $('#resultMeta').textContent=`${items.length} matches · 1 ms`; $('#range').textContent=`1–${items.length} of ${items.length}`; $('#page').textContent='1 / 1'; $('#perf').textContent=`Searched ${items.length} events in 1 ms`;
}

renderHistory();
setFollowLatest(state.followLatest);
$('#open').onclick=chooseFile; $('#history').onclick=e=>{e.stopPropagation();toggleHistory()}; $('#historyMenu').onclick=e=>e.stopPropagation(); document.addEventListener('click',closeHistory); $('#close').onclick=()=>($('#detail') as HTMLDialogElement).close(); $('#copy').onclick=()=>navigator.clipboard.writeText($('#json').textContent||'');
$('#settings').onclick=()=>{populateFieldForm();($('#fieldDialog') as HTMLDialogElement).showModal()};
$('#settingsClose').onclick=()=>($('#fieldDialog') as HTMLDialogElement).close();
$('#saveFields').onclick=saveFieldConfig;
$('#resetFields').onclick=()=>{fieldConfig=structuredClone(defaultFields);populateFieldForm()};
$('#theme').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
$('#follow').onclick=()=>setFollowLatest(!state.followLatest);
$('#search').addEventListener('input',debounce); $('#regex').onclick=()=>{state.regex=!state.regex;$('#regex').classList.toggle('active',state.regex);$('#regex').setAttribute('aria-pressed',String(state.regex));debounce()}; $('#case').onclick=()=>{state.caseSensitive=!state.caseSensitive;$('#case').classList.toggle('active',state.caseSensitive);$('#case').setAttribute('aria-pressed',String(state.caseSensitive));debounce()};
$('#prev').onclick=()=>{if(state.page){state.page--;query()}}; $('#next').onclick=()=>{state.page++;query()};
$('#clear').onclick=()=>{state.levels.clear();state.scopes.clear();document.querySelectorAll<HTMLInputElement>('.check input').forEach(x=>x.checked=false);state.page=0;query()};
document.addEventListener('change',e=>{const x=e.target as HTMLInputElement;if(!x.matches('.check input'))return;const set=x.dataset.type==='level'?state.levels:state.scopes;x.checked?set.add(x.value):set.delete(x.value);state.page=0;query()});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseFile()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}if(e.key==='Escape'&&($('#detail') as HTMLDialogElement).open)($('#detail') as HTMLDialogElement).close()});
listenForFileDrop(load);
updateFieldConfig(fieldConfig).catch(()=>{});
showDemo().catch(error=>{$('#resultMeta').textContent=String(error)});
window.setInterval(async()=>{if(!state.info)return;try{const latest=await refreshLog();if(latest.total!==state.info.total||latest.size!==state.info.size){state.info=latest;renderInfo();query(state.followLatest?{jumpToLatest:true,scrollToEnd:true}:{})}}catch{}},750);
