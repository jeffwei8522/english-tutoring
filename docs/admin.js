// ------- helpers -------
const isHolidayDate = d => Array.isArray(manifest?.holidays) && manifest.holidays.includes(d);
const q=(s,e=document)=>e.querySelector(s);
const msg=q('#msg');
const base=(p)=>p.split('/').pop();
const ymd=(d)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const isLocal=()=>['127.0.0.1','localhost'].includes(location.hostname);

function toast(ok, text){
  msg.className='msg ' + (ok?'ok':'err');
  msg.textContent=text; msg.style.display='block';
  clearTimeout(window.__t); window.__t=setTimeout(()=>msg.style.display='none',3000);
}
async function getJSON(path){
  if(isLocal()){
    try{ const r=await fetch(`/api/data/${path}?ts=${Date.now()}`,{cache:'no-store'}); if(r.ok) return await r.json(); }catch(e){}
  }
  const r2=await fetch(`${path}?ts=${Date.now()}`,{cache:'no-store'}); if(!r2.ok) throw new Error('HTTP '+r2.status); return await r2.json();
}
async function getText(path){
  if(isLocal()){
    try{ const r=await fetch(`/api/data/${path}?ts=${Date.now()}`,{cache:'no-store'}); if(r.ok) return await r.text(); }catch(e){}
  }
  const r2=await fetch(`${path}?ts=${Date.now()}`,{cache:'no-store'}); if(!r2.ok) throw new Error('HTTP '+r2.status); return await r2.text();
}
async function apiSave(path, content){
  if(!isLocal()) throw new Error('save only available on localhost');
  const r=await fetch('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,content})});
  const j=await r.json(); if(!r.ok||j.status!=='success') throw new Error(j.message||('HTTP '+r.status)); return j;
}
async function apiDelete(path){
  if(!isLocal()) throw new Error('delete only available on localhost');
  const r=await fetch('/api/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})});
  const j=await r.json(); if(!r.ok||j.status!=='success') throw new Error(j.message||('HTTP '+r.status)); return j;
}

// 讀檔時：note 只回純文字；其他回 container(去掉h1)的HTML
async function loadSnippet(path, type){
  const raw = await getText(path);
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  if (type === 'note') {
    const note = doc.querySelector('.note');
    return note ? (note.textContent || '').trim() : '';
  }
  const cont = doc.querySelector('.container');
  if (cont) {
    const clone = cont.cloneNode(true);
    const h1 = clone.querySelector('h1'); if (h1) h1.remove();
    return (clone.innerHTML || '').trim();
  }
  return (doc.querySelector('body')?.innerHTML || '').trim();
}

function updateEditUI(){
  const box = q('#editStatus');
  if(!box) return;
  const date = (q('#date').value||'').trim();
  const course = q('#course').value;
  const type = q('#type').value;
  let fn = (q('#filename').value||'').trim(); if (fn && !/\.[a-z0-9]+$/i.test(fn)) fn += '.html';
  const isEditing = !!editingRef;
  const currentPath = fn ? `materials/${stu}/${course}/${fn}` : null;
  const willMove = isEditing && (
    date   !== editingRef.date ||
    course !== editingRef.course ||
    type   !== editingRef.type ||
    (currentPath && currentPath !== editingRef.path)
  );
  if(!isEditing){ box.innerHTML=''; q('#btnSave').textContent='儲存'; return; }
  const now = `${date||'-'}/${course||'-'}/${type||'-'}/${fn||'-'}`;
  const from = `${editingRef.date}/${editingRef.course}/${editingRef.type}/${(editingRef.path||'').split('/').pop()||'-'}`;
  box.innerHTML = `
    <span class="pill">正在編輯：${from}</span>
    ${willMove ? `<span class="pill move">將搬移到：${now}</span>` : ''}
    <button type="button" id="btnExitEdit" class="btn-exit-edit">退出編輯</button>
  `;
  q('#btnSave').textContent = willMove ? '儲存（搬移）' : '儲存';
  q('#btnExitEdit').onclick = ()=>{ clearForm(); updateEditUI(); };
}

function toYMD(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ------- date helpers -------
function setDay(dateStr){
  filterMode='day'; range=null;
  const d = dateStr || toYMD(new Date());
  q('#filterDate').value = d;
  renderList(); wireCalendarLink();
  // ★ 勾了「表單日期跟隨篩選」就同步
  if (q('#lockDate')?.checked) {
    q('#date').value = d;
    updateEditUI();
  }
  updateURL(stu, d);
}
function setWeek(anchorStr){
  const a = anchorStr ? new Date(anchorStr) : new Date();
  const day = a.getDay();
  const monday = new Date(a); monday.setDate(a.getDate() - ((day+6)%7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate()+6);
  filterMode='range';
  range = { start: toYMD(monday), end: toYMD(sunday) };
  q('#filterDate').value = '';
  renderList(); wireCalendarLink();
  updateURL(stu, null);
}
function setMonth(anchorStr){
  const a = anchorStr ? new Date(anchorStr) : new Date();
  const start = new Date(a.getFullYear(), a.getMonth(), 1);
  const end   = new Date(a.getFullYear(), a.getMonth()+1, 0);
  filterMode='range';
  range = { start: toYMD(start), end: toYMD(end) };
  q('#filterDate').value = '';
  renderList(); wireCalendarLink();
  updateURL(stu, null);
}

function getShiftAnchorYMD(){
  // 區間模式：用 range.start 當基準；單日模式：用篩選日；否則退回表單日；都沒有 → 今天
  if (filterMode === 'range' && range?.start) return range.start;
  if (q('#filterDate').value) return q('#filterDate').value;
  if (q('#date').value) return q('#date').value;
  return toYMD(new Date());
}
function shiftWeek(offset){
  const a = new Date(getShiftAnchorYMD());
  a.setDate(a.getDate() + offset*7);
  setWeek(toYMD(a));
}
function shiftMonth(offset){
  const a = new Date(getShiftAnchorYMD());
  a.setMonth(a.getMonth() + offset);
  setMonth(toYMD(a));
}
function shiftDay(step){
  // 以單日模式的篩選日為主；否則用表單日；再不然今天
  const baseStr = q('#filterDate').value || q('#date').value || toYMD(new Date());
  const d = new Date(baseStr);
  d.setDate(d.getDate() + step);
  setDay(toYMD(d));
  // 若有勾「表單日期跟隨篩選」，同步表單
  if (q('#lockDate')?.checked) { q('#date').value = q('#filterDate').value; updateEditUI(); }
}

// ------- URL 參數 -------
const params = new URLSearchParams(location.search);
const urlStu  = params.get('student');
const urlDate = params.get('date');

// 僅首次載入時才吃 urlDate
let booted = false;

// ------- URL 同步工具 -------
function updateURL(student, dateStr){
  const u = new URL(location.href);
  if (student) u.searchParams.set('student', student); else u.searchParams.delete('student');
  if (dateStr) u.searchParams.set('date', dateStr);     else u.searchParams.delete('date');
  history.replaceState(null, '', u.toString());
}
function syncURLFromUI(){
  const d = (filterMode === 'day' && q('#filterDate').value) ? q('#filterDate').value : null;
  updateURL(stu, d);
}

// ------- prefs（放在 helpers 下方、state 之前）-------
let LOCK_KEY = 'admin_lockDate';
let isLocked = ()=> localStorage.getItem(LOCK_KEY) === '1';
let setLocked = (on)=> localStorage.setItem(LOCK_KEY, on ? '1' : '0');

// ------- state -------
let roster={students:[]}, manifest=null, stu=null;
let editingRef=null;  // 正在編輯的舊位置
let filterMode = 'day';
let range = null;     // {start:'YYYY-MM-DD', end:'YYYY-MM-DD'}


// ------- manifest helpers -------
function ensureBase(){
  if(!manifest.version) manifest.version=3;
  manifest.courses=manifest.courses||{english:{label:'英文'}, math:{label:'數學'}};
  manifest.types  =manifest.types  ||{material:'教材', homework:'作業'};
  manifest.days   =manifest.days   ||{};
  manifest.holidays = manifest.holidays || [];
  if(!manifest.types.note) manifest.types.note = '提醒';
}
function ensureArr(date,course,type){
  manifest.days[date]=manifest.days[date]||{};
  manifest.days[date][course]=manifest.days[date][course]||{};
  manifest.days[date][course][type]=manifest.days[date][course][type]||[];
  return manifest.days[date][course][type];
}
function removeEmpty(date,course,type){
  const d=manifest.days[date]||{};
  const c=d[course]||{};
  if((c[type]||[]).length===0) delete c[type];
  if(Object.keys(c).length===0) delete d[course];
  if(Object.keys(d).length===0) delete manifest.days[date];
}

// ------- UI render -------
function renderStu(){
  const sel = q('#studentSel');
  sel.innerHTML = '';
  (roster.students || []).forEach(s=>{
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.name || s.id; sel.appendChild(o);
  });
  if (!stu) stu = roster.students?.[0]?.id || null;
  if (stu) sel.value = stu;
  sel.onchange = async ()=>{
    const dirty = q('#title').value.trim() || q('#filename').value.trim() || q('#html').value.trim();
    if (dirty && !confirm('切換學生會清空目前表單，未儲存內容將遺失，確定切換？')) { sel.value = stu; return; }
    stu = sel.value; localStorage.setItem('lastStu', stu);
    await loadManifest(); syncURLFromUI(); clearForm(); updateEditUI(); wireCalendarLink();
  };
  wireCalendarLink();
}

function renderCourseType(){
  const c=q('#course'), t=q('#type'); c.innerHTML=''; t.innerHTML='';
  Object.entries(manifest.courses).forEach(([k,v])=>{const o=document.createElement('option'); o.value=k; o.textContent=v.label||k; c.appendChild(o);});
  Object.entries(manifest.types).forEach(([k,v])=>{const o=document.createElement('option'); o.value=k; o.textContent=v||k; t.appendChild(o);});
}

function countTypeUsage(key){
  let cnt=0;
  Object.values(manifest.days||{}).forEach(perDate=>{
    Object.values(perDate||{}).forEach(perCourse=>{
      const arr = perCourse?.[key];
      if(Array.isArray(arr)) cnt += arr.length;
    });
  });
  return cnt;
}
function renderTypeChips(){
  const wrap=q('#typeChips'); if(!wrap) return; wrap.innerHTML='';
  Object.entries(manifest.types||{}).forEach(([k,label])=>{
    const chip=document.createElement('div'); chip.className='chip';
    const cnt=countTypeUsage(k);
    chip.innerHTML=`<span class="k">${k}</span><span>${label}</span><span class="cnt">(${cnt})</span>`;
    const del=document.createElement('button'); del.className='del'; del.textContent='刪除';
    if(cnt>0){ del.disabled=true; del.title='已有使用紀錄，無法刪除'; }
    del.onclick=async()=>{
      if(cnt>0) return;
      const ok = confirm(`確認刪除這個類型嗎？\n\nKey：${k}\n顯示名稱：${label}\n\n僅當此類型沒有任何使用紀錄時才可刪除。\n此操作無法復原！`);
      if(!ok) return;
      delete manifest.types[k];
      Object.keys(manifest.days||{}).forEach(d=>{
        Object.keys(manifest.days[d]||{}).forEach(c=>{
          if(manifest.days[d][c] && manifest.days[d][c][k] && manifest.days[d][c][k].length===0){
            delete manifest.days[d][c][k];
          }
        });
      });
      await apiSave(`students/${stu}/manifest.json`, manifest);
      renderCourseType(); renderTypeChips();
      toast(true,'已刪除類型：'+k);
    };
    chip.appendChild(del); wrap.appendChild(chip);
  });
}

function setDefaultDateFocus(){
  const today = ymd(new Date());

  if (!booted && urlDate) {
    q('#filterDate').value = urlDate;
    q('#date').value       = urlDate;
    booted = true;
    return;
  }

  const dates  = Object.keys(manifest.days || {}).sort();
  const latest = dates.length ? dates[dates.length-1] : null;
  const pick   = (!latest || latest < today) ? today : latest;

  q('#filterDate').value = pick;
  q('#date').value       = pick;
  booted = true;
}

function renderList(){
  const wrap=q('#list'); wrap.innerHTML='';
  const fd = q('#filterDate').value || null;
  const days = manifest.days || {};
  const dates = Object.keys(days).sort().filter(d=>{
    if(filterMode==='day') return !fd || d===fd;
    if(!range) return true; return d>=range.start && d<=range.end;
  });
  const badge = q('#filterBadge');
  if (filterMode==='day' && fd)      badge.textContent = `單日：${fd}`;
  else if (filterMode==='range' && range) badge.textContent = `範圍：${range.start} ~ ${range.end}`;
  else badge.textContent = '';
  const hasEntries = dates.length > 0;
  if (filterMode==='day' && fd && isHolidayDate(fd)){
    const tip=document.createElement('div'); tip.className='item'; tip.style.borderLeft='4px solid #f59e0b';
    tip.textContent='🧡 此日標記為放假（仍可新增教材/作業）'; wrap.appendChild(tip);
  }
  if (!hasEntries){
    if (fd){ const empty=document.createElement('div'); empty.className='item'; empty.style.opacity='.7'; empty.textContent='（本日無教材/作業）'; wrap.appendChild(empty); return; }
    wrap.innerHTML='<div class="item" style="opacity:.7">目前沒有條目</div>'; return;
  }
  dates.forEach(d=>{
    const perDate=days[d];
    Object.keys(perDate).forEach(course=>{
      Object.keys(perDate[course]).forEach(type=>{
        perDate[course][type].forEach((it,idx)=>{
          const row=document.createElement('div'); row.className='item';
          row.innerHTML=`
            <div>${d}｜${manifest.courses[course]?.label||course}｜${manifest.types[type]||type} → <strong>${it.title||base(it.path||'')}</strong></div>
            <div style="display:flex;gap:8px">
              <button class="btn gray">編輯</button>
              <button class="btn red">刪除</button>
            </div>`;
          row.children[1].children[0].onclick = async ()=>{
            q('#date').value=d; q('#course').value=course; q('#type').value=type;
            q('#title').value=it.title||''; q('#filename').value=base(it.path||'');
            try{ q('#html').value = await loadSnippet(it.path, type); }
            catch(e){ q('#html').value = ''; toast(false,'讀取既有檔案失敗（僅帶入標題/檔名）'); }
            toast(true,'已帶入表單，可直接修改後按「儲存」');
            editingRef = { date: d, course, type, path: it.path }; updateEditUI();
            if (q('#lockDate')?.checked) {        // ← 新增：鎖定時，讓篩選日跟上
              q('#filterDate').value = d;
              renderList(); wireCalendarLink(); updateURL(stu, d);
            }
          };
          row.children[1].children[1].onclick=async()=>{
            const title = it.title || base(it.path||'');
            const msg = `確認要刪除這個項目嗎？\n\n學生：${stu}\n日期：${d}\n課程：${manifest.courses[course]?.label||course} (${course})\n類型：${manifest.types[type]||type} (${type})\n標題/檔名：${title}\n\n此操作將從 manifest 移除，並嘗試刪除對應檔案（若有）。\n此操作無法復原！`;
            if (!confirm(msg)) return;
            const arr=manifest.days[d][course][type];
            const [removed]=arr.splice(idx,1); removeEmpty(d,course,type);
            await apiSave(`students/${stu}/manifest.json`, manifest);
            if(removed?.path){ try{ await apiDelete(removed.path); } catch(e){ toast(false,'刪檔失敗：'+(e.message||e)); } }
            renderList();
            if (editingRef && removed?.path === editingRef.path) { clearForm(); toast(true,'已刪除（含 HTML 檔），並已退出編輯'); }
            else { toast(true,'已刪除（含 HTML 檔）'); }
          };
          wrap.appendChild(row);
        });
      });
    });
  });
}

// ------- actions -------
async function loadRoster(){
  roster = await getJSON('roster.json');
  const last = localStorage.getItem('lastStu');
  if (urlStu && (roster.students||[]).some(s=>s.id===urlStu)) { stu = urlStu; localStorage.setItem('lastStu', stu); }
  else if (last && (roster.students||[]).some(s=>s.id===last)) { stu = last; }
  else { stu = roster.students?.[0]?.id || null; }
  renderStu();
}
async function loadManifest(){
  editingRef = null;
  manifest=await getJSON(`students/${stu}/manifest.json`); ensureBase();
  renderCourseType(); setDefaultDateFocus(); 
  filterMode='day'; range=null; // ← 切學生回到單日
  renderList(); renderTypeChips();
  wireCalendarLink(); updateEditUI();
}

async function toggleHolidayForCurrentDate(){
  if (filterMode !== 'day') return toast(false,'請切回「單日」模式（點日期或按「今天」）後再設定放假。');
  const d = q('#filterDate').value || q('#date').value; if(!d) return toast(false,'請先選日期');
  manifest.holidays = Array.isArray(manifest.holidays) ? manifest.holidays : [];
  const i = manifest.holidays.indexOf(d);
  if (i === -1) { manifest.holidays.push(d); toast(true, `已標記放假：${d}`); }
  else { manifest.holidays.splice(i,1); toast(true, `已取消放假：${d}`); }
  await apiSave(`students/${stu}/manifest.json`, manifest);
  renderList(); wireCalendarLink();
}

function buildFilename(date,title){
  const safe=(title||'lesson').trim().replace(/\s+/g,'_').toLowerCase();
  return `${date}_${safe}.html`;
}

function maintainFocusAfterSave(savedDate){
  if (filterMode !== 'day') return;
  const lockEl = q('#lockDate');
  const locked = !!(lockEl?.checked) || isLocked();
  if (!locked) return;
  if (savedDate) {
    q('#filterDate').value = savedDate;
    q('#date').value = savedDate;
    updateEditUI();
    updateURL(stu, savedDate);    // ★ 新增的日期會同步到 URL
  }
}
async function doSave(){
  if(!isLocal()) return toast(false,'儲存/刪除僅限本機使用');
  if(!stu) return toast(false,'請先建立學生');
  const date=q('#date').value||''; if(!date) return toast(false,'請選日期');
  const course=q('#course').value; const type=q('#type').value;
  const title=(q('#title').value||'').trim();
  let filename=(q('#filename').value||'').trim(); if(!filename) filename = buildFilename(date,title);
  const dateRe=/^\d{4}-\d{2}-\d{2}_/;
  if (filename && dateRe.test(filename) && filename.slice(0,10)!==date) {filename = filename.replace(dateRe, date + '_');}
  if (!/\.[a-z0-9]+$/i.test(filename)) { filename += '.html'; q('#filename').value = filename; }
  const rel=`materials/${stu}/${course}/${filename}`;
  const html=(q('#html').value||'').trim();
  const fromEdit = !!editingRef;
  if (!html && !fromEdit) {return toast(false, '沒有內容：請先輸入內容，或從列表點「編輯」再儲存');}
  if(html){
    let wrap;
    if (type === 'note') {
      // 轉義 + 保留換行（靠 CSS）
      const esc = s => s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const safeNote = esc(html);
      wrap = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>${title||'提醒'}</title>
      <style>
        :root{--ink:#111827;--muted:#6b7280;--bg:#fff1f2;--card:#fff;--pink:#ec4899;}
        body{font-family:system-ui,"Noto Sans TC",Arial,sans-serif;margin:0;background:var(--bg);color:var(--ink);}
        .header{background:#111827;color:#fff;padding:10px 14px;}
        .header a{color:#f9a8d4;text-decoration:none}
        .container{max-width:800px;margin:18px auto;background:var(--card);border-radius:14px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.06);border:1px dashed #fbcfe8}
        .tag{display:inline-flex;gap:6px;align-items:center;background:#fdf2f8;color:#9d174d;border:1px solid #fbcfe8;border-radius:999px;padding:4px 8px;font-size:12px;margin-bottom:8px}
        .note{font-size:16px;line-height:1.7; white-space: pre-wrap;}
      </style>
      </head><body>
      <div class="header">← <a href="../../../index.html?student=${encodeURIComponent(stu)}&date=${encodeURIComponent(date)}">返回日曆</a></div>
      <div class="container">
        <div class="tag">📌 提醒</div>
        <h1 style="margin:6px 0 12px">${title||'提醒'}</h1>
        <div class="note">${safeNote }</div>
      </div></body></html>`;
    } else {
      wrap =`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>${title||''}</title>
      <style>body{font-family:system-ui,"Noto Sans TC",Arial,sans-serif;margin:0;background:#f6f7fb;} .header{background:#111827;color:#fff;padding:10px 14px;} .header a{color:#a7f3d0;text-decoration:none} .container{max-width:900px;margin:18px auto;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.06)}</style>
      </head><body>
      <div class="header">← <a href="../../../index.html?student=${encodeURIComponent(stu)}&date=${encodeURIComponent(date)}">返回日曆</a></div>
      <div class="container"><h1>${title||''}</h1>${html}</div>
      </body></html>`;
    }
    await apiSave(rel, wrap);
  }
  const changedKeys = editingRef && (editingRef.date!==date || editingRef.course!==course || editingRef.type!==type || editingRef.path!==rel);
  let doMove = false;
  if (changedKeys) {
    doMove = confirm('偵測到你變更了日期/課程/類型或檔名。\n按「確定」：搬移/覆蓋原項目到新位置（原項目會被移除）。\n按「取消」：保留原項目，另外新增一筆。');
    if (!doMove) {
      if (fromEdit && !html && editingRef?.path && editingRef.path !== rel) {
        try { const raw = await getText(editingRef.path); await apiSave(rel, raw); }
        catch (e) { return toast(false, '建立新副本失敗：' + (e.message || e)); }
      }
      editingRef = null;
    }
  }
  if (doMove) {
    if (editingRef.path && editingRef.path !== rel && !html) {
      try { const raw = await getText(editingRef.path); await apiSave(rel, raw); }
      catch (e) { toast(false, '搬移時建立新檔失敗：' + (e.message || e)); }
    }
    const oldArr = manifest.days?.[editingRef.date]?.[editingRef.course]?.[editingRef.type];
    if (Array.isArray(oldArr)) { const i = oldArr.findIndex(x => x.path === editingRef.path); if (i >= 0) oldArr.splice(i, 1); removeEmpty(editingRef.date, editingRef.course, editingRef.type); }
    if (editingRef.path && editingRef.path !== rel) { try { await apiDelete(editingRef.path); } catch(e) { toast(false, '刪除舊檔失敗：'+(e.message||e)); } }
  }
  const arr=ensureArr(date,course,type);
  const exists=arr.find(x=>x.path===rel); if(exists){ exists.title=title; } else { arr.push({title, path: rel}); }
  await apiSave(`students/${stu}/manifest.json`, manifest);
  if(!q('#keepForm').checked){ q('#title').value=''; q('#filename').value=''; q('#html').value=''; }
  const onlyMetaUpdate = fromEdit && !html && !changedKeys && !doMove;
  editingRef = null; updateEditUI(); 
  maintainFocusAfterSave(date); // date 就是此次存檔的目標日期欄位值
  renderList(); 
  wireCalendarLink();
  toast(true, onlyMetaUpdate ? '已儲存（內容未變，只更新標題/分類）' : '已儲存');
}

function clearForm(){ q('#title').value=''; q('#filename').value=''; q('#html').value=''; editingRef = null; updateEditUI(); }

async function reloadCurrentHtml(){
  if (editingRef) {
    const ok = confirm('要還原到你最初按下「編輯」那一筆的日期/科目/類型/檔名並重載內容嗎？（你在表單的變更會被覆蓋）');
    if (!ok) return;
    q('#date').value   = editingRef.date;
    q('#course').value = editingRef.course;
    q('#type').value   = editingRef.type;
    q('#filename').value = base(editingRef.path||'');
    try{ q('#html').value = await loadSnippet(editingRef.path, editingRef.type); updateEditUI(); toast(true,'已還原到原始編輯項並重載內容'); }
    catch(e){ toast(false,'重載失敗：'+(e.message||e)); }
    return;
  }
  let filename = (q('#filename').value || '').trim(); if(!filename) return toast(false,'目前沒有檔名可重載');
  if (!/\.[a-z0-9]+$/i.test(filename)) { filename += '.html'; q('#filename').value = filename; }
  const rel = `materials/${stu}/${q('#course').value}/${filename}`;
  try{ q('#html').value = await loadSnippet(rel, q('#type').value); toast(true,'已重載目前教材'); }
  catch(e){ toast(false,'重載失敗：'+(e.message||e)); }
}

async function addOrUpdateType(){
  const key=(q('#newTypeKey').value||'').trim();
  const label=(q('#newTypeLabel').value||'').trim();
  if(!/^[a-z0-9_-]{2,}$/.test(key)) return toast(false,'請用小寫英數與 _- 當作 key（至少 2 字）');
  manifest.types[key] = label || key;
  await apiSave(`students/${stu}/manifest.json`, manifest);
  renderCourseType(); renderTypeChips();
  toast(true, `已 ${label?'更新':'新增'} 類型：${key}`);
  q('#newTypeKey').value=''; q('#newTypeLabel').value='';
}

function calendarURL(){
  const dInput = q('#filterDate');
  const d = dInput && dInput.value ? dInput.value.trim() : '';
  const page = 'index.html';
  const qs = d ? `?student=${encodeURIComponent(stu)}&date=${encodeURIComponent(d)}` : `?student=${encodeURIComponent(stu)}`;
  return `${page}${qs}#calendar`;
}
function wireCalendarLink(){
  const a = q('#gotoCalendar'); if(!a || !stu) return;
  a.href = calendarURL();
  a.onclick = (ev)=>{ ev.preventDefault(); location.href = calendarURL(); };
}

// ------- boot -------
async function init(){
  await loadRoster(); await loadManifest();
  q('#btnReload').onclick=async()=>{ await loadManifest(); syncURLFromUI(); };
  q('#btnSave').onclick=doSave;
  q('#btnClear').onclick=()=>{
    clearForm();
    // 僅在沒有單日焦點時才清 URL，避免和鎖定日期互相拉扯
    if (filterMode!=='day' || !q('#filterDate').value) updateURL(stu, null);
    };
  q('#btnReloadHtml').onclick=reloadCurrentHtml;

  // 篩選 ↔ 表單日期同步（可選）
  q('#filterDate').oninput = ()=>{
    renderList(); wireCalendarLink();
    if (q('#lockDate')?.checked && q('#filterDate').value) {
      q('#date').value = q('#filterDate').value; updateEditUI();
    }
    syncURLFromUI();
  };
  q('#date').addEventListener('input', ()=>{
    if (q('#lockDate')?.checked && filterMode==='day') {
      q('#filterDate').value = q('#date').value; renderList(); wireCalendarLink();
      syncURLFromUI(); // ← 讓 ?date 一起更新
    }
  });

  // 新增學生
  q('#btnAddStudent').onclick=async()=>{
    if(!isLocal()) return toast(false,'新增僅限本機使用');
    const id=(q('#newId').value||'').trim(); const name=(q('#newName').value||'').trim();
    if(!/^[a-z0-9_-]+$/.test(id)) return toast(false,'id 需為小寫英數與 _-');
    roster.students.push({id, name: name||id}); await apiSave('roster.json', roster);
    q('#newId').value=''; q('#newName').value='';
    await loadRoster(); stu=id; await loadManifest();
    syncURLFromUI();  // ← 新增
    toast(true,'已新增學生');
  };

  // 事件綁定
  q('#btnAddType')  ?.addEventListener('click', addOrUpdateType);
  q('#btnHoliday')  ?.addEventListener('click', toggleHolidayForCurrentDate);
  q('#btnToday')    ?.addEventListener('click', ()=>setDay());
  q('#btnThisWeek') ?.addEventListener('click', ()=>setWeek(q('#filterDate').value||null));
  q('#btnPrevWeek') ?.addEventListener('click', ()=>shiftWeek(-1));
  q('#btnNextWeek') ?.addEventListener('click', ()=>shiftWeek(+1));
  q('#btnThisMonth')?.addEventListener('click', ()=>setMonth(q('#filterDate').value||null));
  q('#btnPrevMonth')?.addEventListener('click', ()=>shiftMonth(-1));
  q('#btnNextMonth')?.addEventListener('click', ()=>shiftMonth(+1));
  q('#btnClearFilter')?.addEventListener('click', ()=>{ filterMode='day'; range=null; q('#filterDate').value=''; renderList(); wireCalendarLink(); updateURL(stu, null);});
  q('#btnPrevDay')?.addEventListener('click', ()=>shiftDay(-1));
  q('#btnNextDay')?.addEventListener('click', ()=>shiftDay(+1));
  // 初始化 #lockDate（若 HTML 有這顆 checkbox）
  const lockEl = q('#lockDate');
  if (lockEl) {
    // 啟動：還原勾選狀態
    lockEl.checked = isLocked();

    // 勾選/取消：記住偏好；若勾選就立刻做一次同步
    lockEl.addEventListener('change', ()=>{
      const on = lockEl.checked;
      setLocked(on);
      if (on) {
        if (filterMode === 'day' && q('#filterDate').value) {
          q('#date').value = q('#filterDate').value;
        } else if (q('#date').value) {
          q('#filterDate').value = q('#date').value;
        }
        updateEditUI();
        renderList(); wireCalendarLink();
      }
      syncURLFromUI(); // ← 新增：不論勾或解勾，都讓網址反映現況
    });

  // 啟動且有勾：做一次單向同步，避免兩邊不同步
  if (lockEl.checked) {
    if (filterMode === 'day' && q('#filterDate').value) {
      q('#date').value = q('#filterDate').value;
    } else if (q('#date').value) {
      q('#filterDate').value = q('#date').value;
    }
  }
}

  // 會影響搬移判斷的欄位
  ['date','course','type','filename'].forEach(id=>{
    q('#'+id)?.addEventListener('input', updateEditUI);
    q('#'+id)?.addEventListener('change', updateEditUI);
  });
}
init();