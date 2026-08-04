import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import './style.css';

type Entry = { id:number; timestamp:string; level:string; scope:string; message:string; raw:string };
type FileInfo = { path:string; name:string; size:number; total:number; levels:string[]; scopes:string[] };
type Result = { items:Entry[]; matched:number; total:number; elapsedMs:number; error?:string };
type FieldConfig = { timeFields:string[]; levelFields:string[]; scopeFields:string[]; messageFields:string[] };
type RecentFile = { path:string; name:string; openedAt:number };

const defaultFields: FieldConfig = {
  timeFields:['timestamp','time','ts','@timestamp'],
  levelFields:['level','severity','logLevel'],
  scopeFields:['scope','namespace','module','logger'],
  messageFields:['message','msg','event','name'],
};
const savedFields = localStorage.getItem('tracebeam.fields');
let fieldConfig: FieldConfig = defaultFields;
try { if(savedFields) fieldConfig={...defaultFields,...JSON.parse(savedFields)}; } catch { localStorage.removeItem('tracebeam.fields'); }

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <header><div class="brand"><span class="mark">T</span><span>Tracebeam</span></div><button id="open" class="open">Open log <kbd>⌘O</kbd></button><div class="history-wrap"><button id="history" class="icon-button" title="Recently opened" aria-expanded="false">↶</button><div id="historyMenu" class="history-menu" hidden></div></div><div class="file" id="file"><span class="dot"></span><span id="filename">No file open</span></div><div class="spacer"></div><button id="settings" class="icon-button" title="Field mapping">⚙</button><button id="theme" class="icon-button" title="Toggle color theme">☀</button><span class="tail"><i></i> LIVE</span></header>
  <main>
    <aside>
      <div class="side-title">FILTERS <button id="clear">Clear</button></div>
      <section><label>LEVEL</label><div id="levels" class="checks"><span class="muted">Open a log to begin</span></div></section>
      <section><label>SCOPE</label><div id="scopes" class="checks"></div></section>
      <div class="stats"><div><b id="total">—</b><span>total events</span></div><div><b id="size">—</b><span>file size</span></div></div>
    </aside>
    <div class="content">
      <div class="toolbar"><div class="search"><span>⌕</span><input id="search" placeholder="Search logs…" autocomplete="off"><kbd>⌘K</kbd></div><button id="case" title="Case sensitive">Aa</button><button id="regex" title="Regular expression">.*</button><div id="resultMeta" class="result-meta">Ready</div></div>
      <div class="columns"><span>TIME</span><span>LEVEL</span><span>SCOPE</span><span>MESSAGE</span></div>
      <div id="rows" class="rows"><div class="empty"><div class="empty-icon">⌁</div><h2>Open a JSONL log</h2><p>Drop a file anywhere, or press <kbd>⌘O</kbd></p></div></div>
      <footer><span id="range">0 events</span><div class="pager"><button id="prev">‹</button><span id="page">1</span><button id="next">›</button></div><span id="perf">Waiting for data</span></footer>
    </div>
    <dialog id="detail"><div class="detail-head"><div><span id="detailLevel"></span><b id="detailTime"></b></div><button id="close">×</button></div><pre id="json"></pre><button id="copy">Copy JSON</button></dialog>
    <dialog id="fieldDialog" class="settings-dialog"><div class="detail-head"><div><b>FIELD MAPPING</b></div><button id="settingsClose">×</button></div><div class="settings-body"><p>多个候选字段用逗号分隔，按顺序匹配；支持 <code>meta.timestamp</code> 嵌套路径。</p><label>时间字段<input id="timeFields"></label><label>等级字段<input id="levelFields"></label><label>Scope 字段<input id="scopeFields"></label><label>消息字段<input id="messageFields"></label></div><div class="settings-actions"><button id="resetFields">恢复默认</button><button id="saveFields" class="primary">保存并重新索引</button></div></dialog>
  </main>`;

const $ = <T extends HTMLElement>(s:string) => document.querySelector<T>(s)!;
const state = { info:null as FileInfo|null, levels:new Set<string>(), scopes:new Set<string>(), page:0, limit:250, regex:false, caseSensitive:false, timer:0 };
const recentKey='tracebeam.recentFiles';
let recentFiles:RecentFile[]=[];
try { recentFiles=JSON.parse(localStorage.getItem(recentKey)||'[]').filter((item:RecentFile)=>item?.path&&item?.name).slice(0,10); } catch { localStorage.removeItem(recentKey); }
const esc = (s:string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const bytes = (n:number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`;
const parseFields = (id:string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value.split(',').map(v=>v.trim()).filter(Boolean);

function applyTheme(theme:string){ document.documentElement.dataset.theme=theme; localStorage.setItem('tracebeam.theme',theme); $('#theme').textContent=theme==='light'?'☾':'☀'; }
applyTheme(localStorage.getItem('tracebeam.theme') || 'dark');

function populateFieldForm(){
  document.querySelector<HTMLInputElement>('#timeFields')!.value=fieldConfig.timeFields.join(', ');
  document.querySelector<HTMLInputElement>('#levelFields')!.value=fieldConfig.levelFields.join(', ');
  document.querySelector<HTMLInputElement>('#scopeFields')!.value=fieldConfig.scopeFields.join(', ');
  document.querySelector<HTMLInputElement>('#messageFields')!.value=fieldConfig.messageFields.join(', ');
}

async function saveFieldConfig(){
  fieldConfig={timeFields:parseFields('timeFields'),levelFields:parseFields('levelFields'),scopeFields:parseFields('scopeFields'),messageFields:parseFields('messageFields')};
  localStorage.setItem('tracebeam.fields',JSON.stringify(fieldConfig));
  const latest=await invoke<FileInfo|null>('set_field_config',{config:fieldConfig});
  if(latest){state.info=latest;state.page=0;state.levels.clear();state.scopes.clear();renderInfo();await query()}
  ($('#fieldDialog') as HTMLDialogElement).close();
}

async function chooseFile(){ const path = await open({ multiple:false, directory:false, filters:[{name:'Log files',extensions:['log','jsonl','txt','ndjson','json']}] }); if(path) await load(String(path)); }
async function load(path:string){
  try { const info=await invoke<FileInfo>('open_log',{path}); state.info=info; rememberFile(info); state.page=0; state.levels.clear(); state.scopes.clear(); renderInfo(); await query(); closeHistory(); }
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
async function query(){
  if(!state.info)return; const token=++queryToken; const search=document.querySelector<HTMLInputElement>('#search')!; const q={ text:search.value, regex:state.regex, caseSensitive:state.caseSensitive, levels:[...state.levels], scopes:[...state.scopes], offset:state.page*state.limit, limit:state.limit };
  const result=await invoke<Result>('query_logs',{query:q}); if(token!==queryToken)return;
  $('#resultMeta').textContent=result.error?result.error:`${result.matched.toLocaleString()} matches · ${result.elapsedMs} ms`; $('#resultMeta').classList.toggle('error',!!result.error);
  renderRows(result); const pages=Math.max(1,Math.ceil(result.matched/state.limit)); if(state.page>=pages){state.page=pages-1;return query()}
  $('#page').textContent=`${state.page+1} / ${pages}`; $('#prev').toggleAttribute('disabled',state.page===0); $('#next').toggleAttribute('disabled',state.page>=pages-1);
  const start=result.matched?state.page*state.limit+1:0, end=Math.min((state.page+1)*state.limit,result.matched); $('#range').textContent=`${start.toLocaleString()}–${end.toLocaleString()} of ${result.matched.toLocaleString()}`; $('#perf').textContent=`Searched ${result.total.toLocaleString()} events in ${result.elapsedMs} ms`;
}
function renderRows(result:Result){
  const rows=$('#rows'); if(!result.items.length){rows.innerHTML='<div class="empty"><div class="empty-icon">⌕</div><h2>No matching events</h2><p>Try a different query or clear filters</p></div>';return}
  const search = document.querySelector<HTMLInputElement>('#search')!;
  rows.innerHTML=result.items.map(e=>`<button class="row" data-id="${e.id}"><time title="${esc(e.timestamp)}">${esc(formatTime(e.timestamp))}</time><span><b class="badge ${e.level.toLowerCase()}">${esc(e.level)}</b></span><span class="scope">${esc(e.scope||'—')}</span><span class="message">${highlight(e.message,search.value)}</span></button>`).join('');
  rows.querySelectorAll<HTMLButtonElement>('.row').forEach((el,idx)=>el.onclick=()=>showDetail(result.items[idx]));
}
function parseTimestamp(input:string): Date|null {
  const value=input.trim();
  if(!value)return null;

  // Unix timestamps: seconds, milliseconds, microseconds, or nanoseconds.
  if(/^\d+(?:\.\d+)?$/.test(value)){
    const n=Number(value);
    if(Number.isFinite(n)){
      const digits=value.split('.')[0].length;
      const ms=digits<=10?n*1000:digits<=13?n:digits<=16?n/1000:n/1_000_000;
      const date=new Date(ms);
      if(!Number.isNaN(date.getTime()))return date;
    }
  }

  // Apache/Nginx: 03/Aug/2026:07:28:36 +0800
  const apache=value.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2})(?:[.,](\d{1,9}))?\s*([+-]\d{2}:?\d{2})?$/);
  if(apache){
    const months:Record<string,string>={jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const month=months[apache[2].toLowerCase()];
    if(month){
      const zone=apache[6]?.replace(/([+-]\d{2})(\d{2})$/,'$1:$2')||'';
      const date=new Date(`${apache[3]}-${month}-${apache[1].padStart(2,'0')}T${apache[4]}.${(apache[5]||'0').slice(0,3).padEnd(3,'0')}${zone}`);
      if(!Number.isNaN(date.getTime()))return date;
    }
  }

  // Syslog: Aug 3 07:28:36 (uses the current year).
  if(/^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/.test(value)){
    const date=new Date(`${value} ${new Date().getFullYear()}`);
    if(!Number.isNaN(date.getTime()))return date;
  }

  // Normalize 2026-08-03 07:28:36,870, slash dates, and +0800 offsets.
  let normalized=value
    .replace(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/,'$1-$2-$3')
    .replace(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/,'$1T$2')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d+)/,'$1.$2')
    .replace(/([+-]\d{2})(\d{2})$/,'$1:$2');
  const parsed=new Date(normalized);
  return Number.isNaN(parsed.getTime())?null:parsed;
}
function formatTime(t:string){
  if(!t)return '—';
  if(/^\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?$/.test(t.trim()))return t.trim().replace(',', '.');
  const d=parseTimestamp(t);
  return d?d.toLocaleTimeString([], {
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    fractionalSecondDigits:3,
    hour12:false,
  }):t;
}
function highlight(s:string,q:string){ if(!q||state.regex)return esc(s); const safe=esc(s), needle=esc(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); return safe.replace(new RegExp(needle,state.caseSensitive?'g':'gi'),m=>`<mark>${m}</mark>`); }
function showDetail(e:Entry){ $('#detailLevel').textContent=e.level; $('#detailLevel').className=`badge ${e.level.toLowerCase()}`; $('#detailTime').textContent=e.timestamp; try{$('#json').textContent=JSON.stringify(JSON.parse(e.raw),null,2)}catch{$('#json').textContent=e.raw} ($('#detail') as HTMLDialogElement).showModal(); }
function debounce(){ window.clearTimeout(state.timer); state.timer=window.setTimeout(()=>{state.page=0;query()},140); }

renderHistory();
$('#open').onclick=chooseFile; $('#history').onclick=e=>{e.stopPropagation();toggleHistory()}; $('#historyMenu').onclick=e=>e.stopPropagation(); document.addEventListener('click',closeHistory); $('#close').onclick=()=>($('#detail') as HTMLDialogElement).close(); $('#copy').onclick=()=>navigator.clipboard.writeText($('#json').textContent||'');
$('#settings').onclick=()=>{populateFieldForm();($('#fieldDialog') as HTMLDialogElement).showModal()};
$('#settingsClose').onclick=()=>($('#fieldDialog') as HTMLDialogElement).close();
$('#saveFields').onclick=saveFieldConfig;
$('#resetFields').onclick=()=>{fieldConfig=structuredClone(defaultFields);populateFieldForm()};
$('#theme').onclick=()=>applyTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
$('#search').addEventListener('input',debounce); $('#regex').onclick=()=>{state.regex=!state.regex;$('#regex').classList.toggle('active',state.regex);debounce()}; $('#case').onclick=()=>{state.caseSensitive=!state.caseSensitive;$('#case').classList.toggle('active',state.caseSensitive);debounce()};
$('#prev').onclick=()=>{if(state.page){state.page--;query()}}; $('#next').onclick=()=>{state.page++;query()};
$('#clear').onclick=()=>{state.levels.clear();state.scopes.clear();document.querySelectorAll<HTMLInputElement>('.check input').forEach(x=>x.checked=false);state.page=0;query()};
document.addEventListener('change',e=>{const x=e.target as HTMLInputElement;if(!x.matches('.check input'))return;const set=x.dataset.type==='level'?state.levels:state.scopes;x.checked?set.add(x.value):set.delete(x.value);state.page=0;query()});
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='o'){e.preventDefault();chooseFile()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}if(e.key==='Escape'&&($('#detail') as HTMLDialogElement).open)($('#detail') as HTMLDialogElement).close()});
getCurrentWebview().onDragDropEvent(e=>{if(e.payload.type==='drop'&&e.payload.paths[0])load(e.payload.paths[0])});
invoke('set_field_config',{config:fieldConfig}).catch(()=>{});
window.setInterval(async()=>{if(!state.info)return;try{const latest=await invoke<FileInfo>('refresh_log');if(latest.total!==state.info.total||latest.size!==state.info.size){state.info=latest;renderInfo();query()}}catch{}},750);
