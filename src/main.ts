import { checkForUpdate, chooseLogPath, installUpdate, listenForFileDrop, openLog, queryLogs, refreshLog, updateFieldConfig } from './backend';
import { escapeHtml as esc, formatBytes as bytes, formatTime } from './format';
import { defaultFields, type Entry, type FieldConfig, type FileInfo, type LogQuery, type QueryResult as Result, type RecentFile, type UpdateInfo } from './types';
import './style.css';
const savedFields = localStorage.getItem('tracebeam.fields');
let fieldConfig: FieldConfig = defaultFields;
try { if(savedFields) fieldConfig={...defaultFields,...JSON.parse(savedFields)}; } catch { localStorage.removeItem('tracebeam.fields'); }

const $ = <T extends HTMLElement>(s:string) => document.querySelector<T>(s)!;
const followKey='tracebeam.followLatest';
const rowHeight=34;
const state = { info:null as FileInfo|null, levels:new Set<string>(), scopes:new Set<string>(), offset:0, limit:250, matched:0, regex:false, caseSensitive:false, followLatest:localStorage.getItem(followKey)==='true', searchTimer:0, scrollTimer:0 };
const selected = new Map<number,string>();
let visibleItems:Entry[]=[];
let visibleOffset=0;
let lastSelectedIndex:number|null=null;
let availableUpdate:UpdateInfo|null=null;
let updateBusy=false;
const recentKey='tracebeam.recentFiles';
let recentFiles:RecentFile[]=[];
try { recentFiles=JSON.parse(localStorage.getItem(recentKey)||'[]').filter((item:RecentFile)=>item?.path&&item?.name).slice(0,10); } catch { localStorage.removeItem(recentKey); }
const parseFields = (id:string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value.split(',').map(v=>v.trim()).filter(Boolean);

function applyTheme(theme:string){ document.documentElement.dataset.theme=theme; localStorage.setItem('tracebeam.theme',theme); $('#theme').textContent=theme==='light'?'☾':'☀'; }
applyTheme(localStorage.getItem('tracebeam.theme') || 'dark');

function setStatus(message:string,error=false){
  const element=$('#resultMeta'); element.textContent=message; element.classList.toggle('error',error);
}

function setUpdateButton(state:'idle'|'checking'|'available'|'installing'){
  const button=$('#update');button.classList.toggle('active',state==='available');button.toggleAttribute('disabled',state==='checking'||state==='installing');
  button.textContent=state==='checking'?'…':state==='available'?'↑':state==='installing'?'↓':'↻';
  button.title=state==='available'&&availableUpdate?`Install Tracebeam ${availableUpdate.version}`:state==='installing'?'Installing update…':'Check for updates';
}

async function checkUpdates(manual=false){
  if(updateBusy)return;
  if(!('__TAURI_INTERNALS__' in window)){if(manual)setStatus('Update checks are available in the desktop app');return}
  updateBusy=true;setUpdateButton('checking');
  try{
    availableUpdate=await checkForUpdate();
    if(availableUpdate){setUpdateButton('available');if(manual)setStatus(`Tracebeam ${availableUpdate.version} is available`)}
    else{setUpdateButton('idle');if(manual)setStatus('Tracebeam is up to date')}
  }catch(error){setUpdateButton('idle');if(manual)setStatus(`Update check failed: ${String(error)}`,true)}
  finally{updateBusy=false}
}

async function handleUpdateClick(){
  if(!availableUpdate){await checkUpdates(true);return}
  const notes=availableUpdate.notes?.trim();
  if(!window.confirm(`Install Tracebeam ${availableUpdate.version} now?${notes?`\n\n${notes}`:''}\n\nThe app will restart after installation.`))return;
  updateBusy=true;setUpdateButton('installing');setStatus(`Downloading Tracebeam ${availableUpdate.version}…`);
  try{await installUpdate()}catch(error){updateBusy=false;setUpdateButton('available');setStatus(`Update failed: ${String(error)}`,true)}
}

function setFollowLatest(enabled:boolean){
  state.followLatest=enabled; localStorage.setItem(followKey,String(enabled));
  const button=$('#follow'); button.classList.toggle('active',enabled); button.setAttribute('aria-pressed',String(enabled));
  button.title=enabled?'Following new logs — click to stop':'Follow new logs';
  if(enabled&&state.info)query({jumpToLatest:true,scrollToEnd:true});
}

function stopFollowingWhenScrolledAway(){
  const rows=$('#rows');
  const distanceFromBottom=rows.scrollHeight-rows.scrollTop-rows.clientHeight;
  if(state.followLatest&&distanceFromBottom>1)setFollowLatest(false);
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
  if(latest){state.info=latest;resetViewport();state.levels.clear();state.scopes.clear();renderInfo();await query()}
  ($('#fieldDialog') as HTMLDialogElement).close();
}

async function chooseFile(){ const path=await chooseLogPath(); if(path)await load(path); }
async function load(path:string){
  try { setStatus('Opening log…'); const info=await openLog(path); state.info=info; rememberFile(info); resetViewport(); state.levels.clear(); state.scopes.clear(); clearSelection(); renderInfo(); await query(); closeHistory(); }
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
  if(!state.info)return; const token=++queryToken; const search=document.querySelector<HTMLInputElement>('#search')!; const q={ text:search.value, regex:state.regex, caseSensitive:state.caseSensitive, levels:[...state.levels], scopes:[...state.scopes], offset:state.offset, limit:state.limit };
  const result=await queryLogs(q satisfies LogQuery); if(token!==queryToken)return;
  const lastOffset=Math.max(0,result.matched-state.limit);
  if(options.jumpToLatest&&state.offset!==lastOffset){state.offset=lastOffset;return query({scrollToEnd:options.scrollToEnd})}
  if(state.offset>lastOffset){state.offset=lastOffset;return query(options)}
  state.matched=result.matched;
  $('#resultMeta').textContent=result.error?result.error:`${result.matched.toLocaleString()} matches · ${result.elapsedMs} ms`; $('#resultMeta').classList.toggle('error',!!result.error);
  renderRows(result);
  $('#perf').textContent=`Searched ${result.total.toLocaleString()} events in ${result.elapsedMs} ms`;
  if(options.scrollToEnd){const rows=$('#rows');rows.scrollTop=rows.scrollHeight;updateViewportUi()}
}
function renderRows(result:Result){
  visibleItems=result.items;
  visibleOffset=state.offset;
  lastSelectedIndex=null;
  const rows=$('#rows');
  if(!result.items.length){rows.innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h2>No matching events</h2><p>Try a different query or clear filters</p></div>';updateViewportUi();return}
  const search=document.querySelector<HTMLInputElement>('#search')!;
  const content=result.items.map(e=>`<div class="row${selected.has(e.id)?' selected':''}" data-id="${e.id}"><label class="select-cell"><input type="checkbox" ${selected.has(e.id)?'checked':''} aria-label="Select log"><span></span></label><div class="row-content"><button class="entry-open" aria-label="Open log details"></button><time title="${esc(e.timestamp)}">${esc(formatTime(e.timestamp))}</time><span><b class="badge ${e.level.toLowerCase()}">${esc(e.level)}</b></span>${e.scope?`<button class="scope scope-filter" title="Filter by ${esc(e.scope)}">${esc(e.scope)}</button>`:'<span class="scope">—</span>'}<span class="message">${highlight(e.message,search.value)}</span></div></div>`).join('');
  rows.innerHTML=`<div class="virtual-spacer" style="height:${result.matched*rowHeight}px"><div class="virtual-window" style="transform:translateY(${state.offset*rowHeight}px)">${content}</div></div>`;
  rows.querySelectorAll<HTMLElement>('.row').forEach((row,idx)=>{
    const item=result.items[idx];
    row.querySelector<HTMLButtonElement>('.entry-open')!.onclick=()=>showDetail(item);
    row.querySelector<HTMLButtonElement>('.scope-filter')?.addEventListener('click',()=>filterByScope(item.scope));
    row.querySelector<HTMLInputElement>('.select-cell input')!.onclick=event=>selectItem(item,idx,(event as MouseEvent).shiftKey);
  });
  updateViewportUi();
}
function selectItem(item:Entry,index:number,range:boolean){
  const shouldSelect=!selected.has(item.id);
  const isCurrentRow=visibleItems[index]?.id===item.id;
  if(range&&isCurrentRow&&lastSelectedIndex!==null){const [start,end]=[lastSelectedIndex,index].sort((a,b)=>a-b);visibleItems.slice(start,end+1).forEach(entry=>shouldSelect?selected.set(entry.id,entry.raw):selected.delete(entry.id))}
  else shouldSelect?selected.set(item.id,item.raw):selected.delete(item.id);
  lastSelectedIndex=isCurrentRow?index:null;syncVisibleSelection();
}
function syncVisibleSelection(){
  document.querySelectorAll<HTMLElement>('#rows .row').forEach(row=>{const checked=selected.has(Number(row.dataset.id));row.classList.toggle('selected',checked);const input=row.querySelector<HTMLInputElement>('.select-cell input');if(input)input.checked=checked});
  updateSelectionUi();
}
function updateSelectionUi(){
  $('#selectionActions').hidden=selected.size===0;$('#selectionCount').textContent=`${selected.size} selected`;
  const entries=viewportEntries(), checkbox=$<HTMLInputElement>('#selectVisible'), count=entries.filter(item=>selected.has(item.id)).length;
  checkbox.checked=entries.length>0&&count===entries.length;checkbox.indeterminate=count>0&&count<entries.length;checkbox.disabled=entries.length===0;
}
function clearSelection(){selected.clear();lastSelectedIndex=null;syncVisibleSelection()}
async function copySelected(){if(!selected.size)return;const raw=[...selected.entries()].sort(([a],[b])=>a-b).map(([,value])=>value).join('\n');await navigator.clipboard.writeText(raw);setStatus(`Copied ${selected.size.toLocaleString()} raw log lines`)}
function filterByScope(scope:string){
  state.scopes.clear();state.scopes.add(scope);resetViewport();
  document.querySelectorAll<HTMLInputElement>('.check input[data-type="scope"]').forEach(input=>input.checked=input.value===scope);
  query();
}
function highlight(s:string,q:string){ if(!q||state.regex)return esc(s); const safe=esc(s), needle=esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return safe.replace(new RegExp(needle,state.caseSensitive?'g':'gi'),m=>`<mark>${m}</mark>`); }
function showDetail(e:Entry){ $('#detailLevel').textContent=e.level; $('#detailLevel').className=`badge ${e.level.toLowerCase()}`; $('#detailTime').textContent=e.timestamp; try{$('#json').textContent=JSON.stringify(JSON.parse(e.raw),null,2)}catch{$('#json').textContent=e.raw} ($('#detail') as HTMLDialogElement).showModal(); }
function resetViewport(){state.offset=0;state.matched=0;visibleItems=[];visibleOffset=0;const rows=$('#rows');if(rows)rows.scrollTop=0}
function viewportEntries(){
  const rows=$('#rows'), start=Math.floor(rows.scrollTop/rowHeight), end=Math.ceil((rows.scrollTop+rows.clientHeight)/rowHeight);
  return visibleItems.slice(Math.max(0,start-visibleOffset),Math.max(0,end-visibleOffset));
}
function updateViewportUi(){
  const rows=$('#rows');
  if(!state.matched)$('#range').textContent='0 of 0';
  else {const start=Math.min(state.matched,Math.floor(rows.scrollTop/rowHeight)+1),end=Math.min(state.matched,Math.ceil((rows.scrollTop+rows.clientHeight)/rowHeight));$('#range').textContent=`${start.toLocaleString()}–${end.toLocaleString()} of ${state.matched.toLocaleString()}`}
  updateSelectionUi();
}
function scheduleVirtualQuery(){
  updateViewportUi();
  if(!state.info||!visibleItems.length)return;
  const rows=$('#rows'), first=Math.floor(rows.scrollTop/rowHeight), visibleCount=Math.max(1,Math.ceil(rows.clientHeight/rowHeight));
  const loadedEnd=visibleOffset+visibleItems.length, nearStart=visibleOffset>0&&first<visibleOffset+40, nearEnd=loadedEnd<state.matched&&first+visibleCount>loadedEnd-40;
  if(!nearStart&&!nearEnd)return;
  const maxOffset=Math.max(0,state.matched-state.limit), nextOffset=Math.max(0,Math.min(maxOffset,first-Math.floor((state.limit-visibleCount)/2)));
  if(nextOffset===state.offset)return;
  window.clearTimeout(state.scrollTimer);state.scrollTimer=window.setTimeout(()=>{state.offset=nextOffset;query()},60);
}
function debounce(){ window.clearTimeout(state.searchTimer); state.searchTimer=window.setTimeout(()=>{resetViewport();query()},140); }

async function showDemo(){
  if(!new URLSearchParams(location.search).has('demo'))return;
  const raw=await fetch(new URL('../examples/demo.jsonl',import.meta.url)).then(response=>response.text());
  const items:Entry[]=raw.trim().split('\n').map((line,id)=>{
    const value=JSON.parse(line);
    return {id,timestamp:String(value.timestamp||''),level:String(value.level||'other').toUpperCase(),scope:String(value.scope||''),message:String(value.message||''),raw:line};
  });
  state.info={path:'examples/demo.jsonl',name:'demo.jsonl',size:new Blob([raw]).size,total:items.length,levels:[...new Set(items.map(item=>item.level))].sort(),scopes:[...new Set(items.map(item=>item.scope))].sort()};
  renderInfo(); renderRows({items,matched:items.length,total:items.length,elapsedMs:1});
  state.matched=items.length; $('#resultMeta').textContent=`${items.length} matches · 1 ms`; updateViewportUi(); $('#perf').textContent=`Searched ${items.length} events in 1 ms`;
}

renderHistory();
setFollowLatest(state.followLatest);
$('#open').onclick=chooseFile; $('#history').onclick=e=>{e.stopPropagation();toggleHistory()}; $('#historyMenu').onclick=e=>e.stopPropagation(); document.addEventListener('click',closeHistory); $('#close').onclick=()=>($('#detail') as HTMLDialogElement).close(); $('#copy').onclick=()=>navigator.clipboard.writeText($('#json').textContent||'');
$('#settings').onclick=()=>{populateFieldForm();($('#fieldDialog') as HTMLDialogElement).showModal()};
$('#update').onclick=()=>handleUpdateClick();
$('#settingsClose').onclick=()=>($('#fieldDialog') as HTMLDialogElement).close();
$('#saveFields').onclick=saveFieldConfig;
$('#resetFields').onclick=()=>{fieldConfig=structuredClone(defaultFields);populateFieldForm()};
$('#theme').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
$('#follow').onclick=()=>setFollowLatest(!state.followLatest);
$('#rows').addEventListener('scroll',()=>{stopFollowingWhenScrolledAway();scheduleVirtualQuery()},{passive:true});
$('#copySelected').onclick=()=>copySelected().catch(error=>setStatus(String(error),true));
$('#clearSelection').onclick=clearSelection;
$<HTMLInputElement>('#selectVisible').onclick=()=>{const entries=viewportEntries(),all=entries.length>0&&entries.every(item=>selected.has(item.id));entries.forEach(item=>all?selected.delete(item.id):selected.set(item.id,item.raw));syncVisibleSelection()};
$('#search').addEventListener('input',debounce); $('#regex').onclick=()=>{state.regex=!state.regex;$('#regex').classList.toggle('active',state.regex);$('#regex').setAttribute('aria-pressed',String(state.regex));debounce()}; $('#case').onclick=()=>{state.caseSensitive=!state.caseSensitive;$('#case').classList.toggle('active',state.caseSensitive);$('#case').setAttribute('aria-pressed',String(state.caseSensitive));debounce()};
$('#clear').onclick=()=>{state.levels.clear();state.scopes.clear();document.querySelectorAll<HTMLInputElement>('.check input').forEach(x=>x.checked=false);resetViewport();query()};
document.addEventListener('change',e=>{const x=e.target as HTMLInputElement;if(!x.matches('.check input'))return;const set=x.dataset.type==='level'?state.levels:state.scopes;x.checked?set.add(x.value):set.delete(x.value);resetViewport();query()});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseFile()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'&&selected.size&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!window.getSelection()?.toString()){e.preventDefault();copySelected().catch(error=>setStatus(String(error),true))}if(e.key==='Escape'&&($('#detail') as HTMLDialogElement).open)($('#detail') as HTMLDialogElement).close()});
listenForFileDrop(load);
updateFieldConfig(fieldConfig).catch(()=>{});
showDemo().catch(error=>{$('#resultMeta').textContent=String(error)});
window.setTimeout(()=>checkUpdates(),1500);
window.setInterval(async()=>{if(!state.info)return;try{const latest=await refreshLog();if(latest.total!==state.info.total||latest.size!==state.info.size){state.info=latest;renderInfo();query(state.followLatest?{jumpToLatest:true,scrollToEnd:true}:{})}}catch{}},750);
