import { checkForUpdate, chooseExportPath, chooseLogPath, exportLogs, getAppVersion, installUpdate, listenForFileDrop, openLog, queryLogs, refreshLog, updateFieldConfig } from './backend';
import { createFilterPanel, filterInputValue } from './filter-panel';
import { formatBytes as bytes, formatTime } from './format';
import { renderJsonViewer, renderRawJson } from './json-viewer';
import { buildLogQuery } from './query';
import { levelToneClass } from './security';
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
let detailCopyText='';
const copyFeedbackTimers=new WeakMap<HTMLButtonElement,number>();
const recentKey='tracebeam.recentFiles';
let recentFiles:RecentFile[]=[];
try { recentFiles=JSON.parse(localStorage.getItem(recentKey)||'[]').filter((item:RecentFile)=>item?.path&&item?.name).slice(0,10); } catch { localStorage.removeItem(recentKey); }
const parseFields = (id:string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value.split(',').map(v=>v.trim()).filter(Boolean);
type EditableTarget=HTMLInputElement|HTMLTextAreaElement;
type ContextAction={label:string;shortcut?:string;disabled?:boolean;run:()=>void|Promise<void>};

async function renderAppVersion(){
  let version=__APP_VERSION__;
  if('__TAURI_INTERNALS__' in window){try{version=await getAppVersion()}catch{}}
  const element=$('#appVersion');element.textContent=`v${version}`;element.title=`Tracebeam ${version}`;
}

function applyTheme(theme:string){ document.documentElement.dataset.theme=theme; localStorage.setItem('tracebeam.theme',theme); $('#theme').textContent=theme==='light'?'☾':'☀'; }
applyTheme(localStorage.getItem('tracebeam.theme') || 'dark');
void renderAppVersion();

function setStatus(message:string,error=false){
  const element=$('#resultMeta'); element.textContent=message; element.classList.toggle('error',error);
}

function showCopyFeedback(button:HTMLButtonElement,label:string,error=false){
  const original=button.dataset.copyLabel||button.textContent||'Copy';button.dataset.copyLabel=original;
  const activeTimer=copyFeedbackTimers.get(button);if(activeTimer)window.clearTimeout(activeTimer);
  button.textContent=label;button.classList.toggle('copy-success',!error);button.classList.toggle('copy-error',error);
  copyFeedbackTimers.set(button,window.setTimeout(()=>{button.textContent=original;button.classList.remove('copy-success','copy-error');copyFeedbackTimers.delete(button)},1600));
}

function resetCopyFeedback(button:HTMLButtonElement){
  const activeTimer=copyFeedbackTimers.get(button);if(activeTimer)window.clearTimeout(activeTimer);
  button.textContent=button.dataset.copyLabel||button.textContent;button.classList.remove('copy-success','copy-error');copyFeedbackTimers.delete(button);
}

async function copyWithFeedback(text:string,button:HTMLButtonElement){
  try{await navigator.clipboard.writeText(text);showCopyFeedback(button,'Copied ✓')}
  catch(error){showCopyFeedback(button,'Copy failed',true);throw error}
}

const filterPanel=createFilterPanel(
  ()=>{syncDiagnostic();resetViewport();void query()},
  message=>setStatus(message,true),
);

function syncDiagnostic(){
  const button=$('#invalidDiagnostic');
  button.classList.toggle('active',filterPanel.snapshot().invalidOnly);
}

function editableTarget(target:EventTarget|null):EditableTarget|null{
  if(target instanceof HTMLTextAreaElement)return target.disabled||target.readOnly?null:target;
  if(!(target instanceof HTMLInputElement)||target.disabled||target.readOnly)return null;
  return ['text','search','url','tel','email','password'].includes(target.type)?target:null;
}

function editableSelection(target:EditableTarget){
  const start=target.selectionStart??0,end=target.selectionEnd??0;
  return {start,end,text:target.value.slice(start,end)};
}

function replaceEditableSelection(target:EditableTarget,text:string,inputType:string){
  const {start,end}=editableSelection(target);target.setRangeText(text,start,end,'end');
  target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType,data:text}));
}

function closeContextMenu(){$('#appContextMenu').hidden=true}

function showContextMenu(event:MouseEvent){
  event.preventDefault();
  const menu=$('#appContextMenu'),editable=editableTarget(event.target),selection=window.getSelection()?.toString()||'';
  const modifier=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘':'Ctrl+';
  const actions:ContextAction[]=[];
  if(editable){
    const selected=editableSelection(editable).text;
    actions.push(
      {label:'Cut',shortcut:`${modifier}X`,disabled:!selected,run:async()=>{await navigator.clipboard.writeText(selected);replaceEditableSelection(editable,'','deleteByCut')}},
      {label:'Copy',shortcut:`${modifier}C`,disabled:!selected,run:()=>navigator.clipboard.writeText(selected)},
      {label:'Paste',shortcut:`${modifier}V`,run:async()=>replaceEditableSelection(editable,await navigator.clipboard.readText(),'insertFromPaste')},
      {label:'Select all',shortcut:`${modifier}A`,run:()=>editable.select()},
    );
  }else if(selection){actions.push({label:'Copy',shortcut:`${modifier}C`,run:()=>navigator.clipboard.writeText(selection)})}
  if(!actions.length){closeContextMenu();return}
  (document.querySelector('dialog[open]')||$('#app')).append(menu);
  menu.replaceChildren(...actions.map(action=>{
    const button=document.createElement('button');button.type='button';button.role='menuitem';button.disabled=!!action.disabled;
    const label=document.createElement('span');label.textContent=action.label;button.append(label);
    if(action.shortcut){const shortcut=document.createElement('kbd');shortcut.textContent=action.shortcut;button.append(shortcut)}
    button.onclick=()=>{closeContextMenu();Promise.resolve(action.run()).catch(error=>setStatus(`${action.label} failed: ${String(error)}`,true))};
    return button;
  }));
  menu.hidden=false;
  menu.style.left=`${Math.max(6,Math.min(event.clientX,window.innerWidth-menu.offsetWidth-6))}px`;
  menu.style.top=`${Math.max(6,Math.min(event.clientY,window.innerHeight-menu.offsetHeight-6))}px`;
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
  const head=document.createElement('div');head.className='history-head';
  const heading=document.createElement('b');heading.textContent='RECENTLY OPENED';head.append(heading);
  if(recentFiles.length){
    const clear=document.createElement('button');clear.type='button';clear.textContent='Clear';
    clear.onclick=()=>{recentFiles=[];localStorage.removeItem(recentKey);renderHistory()};head.append(clear);
  }
  const items:HTMLElement[]=recentFiles.map(item=>{
    const button=document.createElement('button');button.type='button';button.className='history-item';button.title=item.path;button.onclick=()=>load(item.path);
    const name=document.createElement('span');name.textContent=item.name;const path=document.createElement('small');path.textContent=item.path;button.append(name,path);return button;
  });
  if(!items.length){const empty=document.createElement('div');empty.className='history-empty';empty.textContent='No recent files';items.push(empty)}
  menu.replaceChildren(head,...items);
}
function closeHistory(){ $('#historyMenu').hidden=true; $('#history').setAttribute('aria-expanded','false'); }
function toggleHistory(){ const menu=$('#historyMenu'); menu.hidden=!menu.hidden; $('#history').setAttribute('aria-expanded',String(!menu.hidden)); }
function renderInfo(){
  const i=state.info!; $('#filename').textContent=i.name; $('#file').setAttribute('title',i.path); $('#total').textContent=i.total.toLocaleString(); $('#size').textContent=bytes(i.size);
  $('#levels').replaceChildren(...i.levels.map(value=>createCheck(value,'level')));
  if(i.scopes.length)$('#scopes').replaceChildren(...i.scopes.map(value=>createCheck(value,'scope')));
  else{const empty=document.createElement('span');empty.className='muted';empty.textContent='No scopes found';$('#scopes').replaceChildren(empty)}
  const diagnostic=$('#invalidDiagnostic');diagnostic.hidden=i.invalidJson===0;$('#invalidCount').textContent=i.invalidJson.toLocaleString();syncDiagnostic();
}
function createCheck(value:string,type:'level'|'scope'){
  const label=document.createElement('label');label.className=`check ${type}-check`;
  const input=document.createElement('input');input.type='checkbox';input.dataset.type=type;input.value=value;label.append(input);
  if(type==='level'){const dot=document.createElement('span');dot.classList.add('level-dot',levelToneClass(value));label.append(dot)}
  const text=document.createElement('span');text.title=value;text.textContent=value;label.append(text);return label;
}
let queryToken=0;
function currentQuery():LogQuery{
  return buildLogQuery({
    text:$<HTMLInputElement>('#search').value,regex:state.regex,caseSensitive:state.caseSensitive,
    levels:[...state.levels],scopes:[...state.scopes],offset:state.offset,limit:state.limit,
  },filterPanel.snapshot());
}
async function query(options:{jumpToLatest?:boolean;scrollToEnd?:boolean}={}){
  if(!state.info)return; const token=++queryToken;
  const result=await queryLogs(currentQuery()); if(token!==queryToken)return;
  const lastOffset=Math.max(0,result.matched-state.limit);
  if(options.jumpToLatest&&state.offset!==lastOffset){state.offset=lastOffset;return query({scrollToEnd:options.scrollToEnd})}
  if(state.offset>lastOffset){state.offset=lastOffset;return query(options)}
  state.matched=result.matched;
  const contextLabel=result.matched===result.directMatched?'':` · ${result.matched.toLocaleString()} with context`;
  $('#resultMeta').textContent=result.error?result.error:`${result.directMatched.toLocaleString()} matches${contextLabel} · ${result.elapsedMs} ms`; $('#resultMeta').classList.toggle('error',!!result.error);
  renderRows(result);
  $('#perf').textContent=`Searched ${result.total.toLocaleString()} events in ${result.elapsedMs} ms`;
  if(options.scrollToEnd){const rows=$('#rows');rows.scrollTop=rows.scrollHeight;updateViewportUi()}
}
function renderRows(result:Result){
  visibleItems=result.items;
  visibleOffset=state.offset;
  lastSelectedIndex=null;
  const rows=$('#rows');
  if(!result.items.length){
    const empty=document.createElement('div');empty.className='empty';
    const icon=document.createElement('div');icon.className='empty-icon';icon.textContent='⌕';
    const title=document.createElement('h2');title.textContent='No matching events';const hint=document.createElement('p');hint.textContent='Try a different query or clear filters';
    empty.append(icon,title,hint);rows.replaceChildren(empty);updateViewportUi();return;
  }
  const search=document.querySelector<HTMLInputElement>('#search')!;
  const spacer=document.createElement('div');spacer.className='virtual-spacer';spacer.style.height=`${result.matched*rowHeight}px`;
  const window=document.createElement('div');window.className='virtual-window';window.style.transform=`translateY(${state.offset*rowHeight}px)`;spacer.append(window);
  result.items.forEach((item,index)=>{
    const row=document.createElement('div');row.className='row';row.dataset.id=String(item.id);
    row.classList.toggle('selected',selected.has(item.id));row.classList.toggle('context-only',item.contextOnly);row.classList.toggle('invalid',!!item.parseError);
    const select=document.createElement('label');select.className='select-cell';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(item.id);checkbox.setAttribute('aria-label','Select log');checkbox.onclick=event=>selectItem(item,index,(event as MouseEvent).shiftKey);select.append(checkbox,document.createElement('span'));
    const content=document.createElement('div');content.className='row-content';const open=document.createElement('button');open.type='button';open.className='entry-open';open.setAttribute('aria-label','Open log details');open.onclick=()=>showDetail(item);
    const time=document.createElement('time');time.title=`Line ${item.lineNumber.toLocaleString()} · ${item.timestamp}`;time.textContent=formatTime(item.timestamp);
    const level=document.createElement('span');const badge=document.createElement('b');badge.classList.add('badge',levelToneClass(item.level));badge.textContent=item.level;level.append(badge);
    const scope=document.createElement(item.scope?'button':'span');scope.className=item.scope?'scope scope-filter':'scope';scope.textContent=item.scope||'—';
    if(scope instanceof HTMLButtonElement){scope.type='button';scope.title=`Filter by ${item.scope}`;scope.onclick=()=>filterByScope(item.scope)}
    const message=document.createElement('span');message.className='message';appendHighlighted(message,item.message,search.value);
    content.append(open,time,level,scope,message);row.append(select,content);window.append(row);
  });
  rows.replaceChildren(spacer);
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
async function copySelected(){if(!selected.size)return;const count=selected.size,raw=[...selected.entries()].sort(([a],[b])=>a-b).map(([,value])=>value).join('\n');await copyWithFeedback(raw,$<HTMLButtonElement>('#copySelected'));setStatus(`Copied ${count.toLocaleString()} raw log lines`)}
async function exportAll(){
  if(!state.info){setStatus('Open a log before exporting',true);return}
  const stem=state.info.name.replace(/\.[^.]+$/,'')||'tracebeam-export';
  const path=await chooseExportPath(`${stem}-filtered.jsonl`);if(!path)return;
  const format=path.toLowerCase().endsWith('.csv')?'csv':'jsonl';
  const button=$<HTMLButtonElement>('#export');button.disabled=true;setStatus('Exporting all matching logs…');
  try{const count=await exportLogs(currentQuery(),path,format);setStatus(`Exported ${count.toLocaleString()} matching logs`)}
  catch(error){setStatus(`Export failed: ${String(error)}`,true)}finally{button.disabled=false}
}
function filterByScope(scope:string){
  state.scopes.clear();state.scopes.add(scope);resetViewport();
  document.querySelectorAll<HTMLInputElement>('.check input[data-type="scope"]').forEach(input=>input.checked=input.value===scope);
  query();
}
function appendHighlighted(container:HTMLElement,text:string,query:string){
  if(!query||state.regex){container.textContent=text;return}
  const pattern=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),matches=text.matchAll(new RegExp(pattern,state.caseSensitive?'g':'gi'));let cursor=0;
  for(const match of matches){const index=match.index??cursor;container.append(document.createTextNode(text.slice(cursor,index)));const mark=document.createElement('mark');mark.textContent=match[0];container.append(mark);cursor=index+match[0].length}
  container.append(document.createTextNode(text.slice(cursor)));
}
function showDetail(e:Entry){
  resetCopyFeedback($<HTMLButtonElement>('#copy'));
  const detailLevel=$('#detailLevel');detailLevel.textContent=e.level;detailLevel.className='badge';detailLevel.classList.add(levelToneClass(e.level));$('#detailTime').textContent=e.timestamp||'No timestamp';$('#detailLine').textContent=`Line ${e.lineNumber.toLocaleString()}`;
  const error=$('#parseError');error.hidden=!e.parseError;error.textContent=e.parseError?`Invalid JSON: ${e.parseError}`:'';
  const viewer=$('#json');detailCopyText=e.raw;
  try{
    const value=JSON.parse(e.raw);detailCopyText=JSON.stringify(value,null,2);
    renderJsonViewer(viewer,value,({path,operator,value:fieldValue})=>{
      ($('#detail') as HTMLDialogElement).close();
      const inputValue=operator==='exists'||operator==='notExists'?'':filterInputValue(fieldValue);
      filterPanel.addField(path,inputValue,operator);
    });
  }catch{renderRawJson(viewer,e.raw)}
  ($('#detail') as HTMLDialogElement).showModal();
}
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
    return {id,lineNumber:id+1,timestamp:String(value.timestamp||''),level:String(value.level||'other').toUpperCase(),scope:String(value.scope||''),message:String(value.message||''),raw:line,parseError:null,contextOnly:false};
  });
  state.info={path:'examples/demo.jsonl',name:'demo.jsonl',size:new Blob([raw]).size,total:items.length,invalidJson:0,levels:[...new Set(items.map(item=>item.level))].sort(),scopes:[...new Set(items.map(item=>item.scope))].sort()};
  renderInfo(); renderRows({items,matched:items.length,directMatched:items.length,total:items.length,elapsedMs:1});
  state.matched=items.length; $('#resultMeta').textContent=`${items.length} matches · 1 ms`; updateViewportUi(); $('#perf').textContent=`Searched ${items.length} events in 1 ms`;
}

renderHistory();
setFollowLatest(state.followLatest);
$('#open').onclick=chooseFile; $('#history').onclick=e=>{e.stopPropagation();toggleHistory()}; $('#historyMenu').onclick=e=>e.stopPropagation(); document.addEventListener('click',closeHistory); $('#close').onclick=()=>($('#detail') as HTMLDialogElement).close(); $('#copy').onclick=()=>copyWithFeedback(detailCopyText,$<HTMLButtonElement>('#copy')).catch(error=>setStatus(`Copy JSON failed: ${String(error)}`,true));
$('#settings').onclick=()=>{populateFieldForm();($('#fieldDialog') as HTMLDialogElement).showModal()};
$('#update').onclick=()=>handleUpdateClick();
$('#settingsClose').onclick=()=>($('#fieldDialog') as HTMLDialogElement).close();
$('#saveFields').onclick=saveFieldConfig;
$('#resetFields').onclick=()=>{fieldConfig=structuredClone(defaultFields);populateFieldForm()};
$('#theme').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
$('#follow').onclick=()=>setFollowLatest(!state.followLatest);
$('#export').onclick=()=>void exportAll();
$('#invalidDiagnostic').onclick=()=>filterPanel.setInvalidOnly(!filterPanel.snapshot().invalidOnly);
$('#rows').addEventListener('scroll',()=>{stopFollowingWhenScrolledAway();scheduleVirtualQuery()},{passive:true});
$('#copySelected').onclick=()=>copySelected().catch(error=>setStatus(String(error),true));
$('#clearSelection').onclick=clearSelection;
$<HTMLInputElement>('#selectVisible').onclick=()=>{const entries=viewportEntries(),all=entries.length>0&&entries.every(item=>selected.has(item.id));entries.forEach(item=>all?selected.delete(item.id):selected.set(item.id,item.raw));syncVisibleSelection()};
$('#search').addEventListener('input',debounce); $('#regex').onclick=()=>{state.regex=!state.regex;$('#regex').classList.toggle('active',state.regex);$('#regex').setAttribute('aria-pressed',String(state.regex));debounce()}; $('#case').onclick=()=>{state.caseSensitive=!state.caseSensitive;$('#case').classList.toggle('active',state.caseSensitive);$('#case').setAttribute('aria-pressed',String(state.caseSensitive));debounce()};
$('#clear').onclick=()=>{state.levels.clear();state.scopes.clear();filterPanel.clear(false);document.querySelectorAll<HTMLInputElement>('.check input').forEach(x=>x.checked=false);syncDiagnostic();resetViewport();query()};
document.addEventListener('change',e=>{const x=e.target as HTMLInputElement;if(!x.matches('.check input'))return;const set=x.dataset.type==='level'?state.levels:state.scopes;x.checked?set.add(x.value):set.delete(x.value);resetViewport();query()});
document.addEventListener('contextmenu',showContextMenu);
document.addEventListener('pointerdown',event=>{if(!$('#appContextMenu').contains(event.target as Node))closeContextMenu()});
document.addEventListener('scroll',closeContextMenu,true);window.addEventListener('resize',closeContextMenu);
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseFile()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='c'&&selected.size&&!['INPUT','TEXTAREA'].includes((e.target as HTMLElement).tagName)&&!window.getSelection()?.toString()){e.preventDefault();copySelected().catch(error=>setStatus(String(error),true))}if(e.key==='Escape'){closeContextMenu();if(($('#detail') as HTMLDialogElement).open)($('#detail') as HTMLDialogElement).close()}});
listenForFileDrop(load);
updateFieldConfig(fieldConfig).catch(()=>{});
showDemo().catch(error=>{$('#resultMeta').textContent=String(error)});
window.setTimeout(()=>checkUpdates(),1500);
window.setInterval(async()=>{if(!state.info)return;try{const latest=await refreshLog();if(latest.total!==state.info.total||latest.size!==state.info.size){state.info=latest;renderInfo();query(state.followLatest?{jumpToLatest:true,scrollToEnd:true}:{})}}catch{}},750);
