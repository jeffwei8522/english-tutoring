// ------- helpers -------
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

// ------- state -------
let roster={students:[]}, manifest=null, stu=null;

// ------- manifest helpers -------
function ensureBase(){
  if(!manifest.version) manifest.version=3;
  manifest.courses=manifest.courses||{english:{label:'英文'}, math:{label:'數學'}};
  manifest.types  =manifest.types  ||{material:'教材', homework:'作業'};
  manifest.days   =manifest.days   ||{};
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
  const sel=q('#studentSel'); sel.innerHTML='';
  (roster.students||[]).forEach(s=>{const o=document.createElement('option'); o.value=s.id; o.textContent=s.name||s.id; sel.appendChild(o);});
  if(!stu) stu=roster.students?.[0]?.id||null;
  if(stu) sel.value=stu;
  sel.onchange=async()=>{stu=sel.value; await loadManifest();wireCalendarLink();} // ★ 切換學生後更新
  wireCalendarLink();        // ★ 初次渲染也更新
}
function renderCourseType(){
  const c=q('#course'), t=q('#type'); c.innerHTML=''; t.innerHTML='';
  Object.entries(manifest.courses).forEach(([k,v])=>{const o=document.createElement('option'); o.value=k; o.textContent=v.label||k; c.appendChild(o);});
  Object.entries(manifest.types).forEach(([k,v])=>{const o=document.createElement('option'); o.value=k; o.textContent=v||k; t.appendChild(o);});
}

// ▶ 類型 chips + 新增 / 刪除
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
  const wrap=q('#typeChips'); if(!wrap) return;
  wrap.innerHTML='';
  Object.entries(manifest.types||{}).forEach(([k,label])=>{
    const chip=document.createElement('div'); chip.className='chip';
    const cnt=countTypeUsage(k);
    chip.innerHTML=`<span class="k">${k}</span><span>${label}</span><span class="cnt">(${cnt})</span>`;
    const del=document.createElement('button'); del.className='del'; del.textContent='刪除';
    if(cnt>0){ del.disabled=true; del.title='已有使用紀錄，無法刪除'; }
    del.onclick=async()=>{
      if(cnt>0) return; // 已經有使用紀錄時本來就禁止刪除
      // ★ 新增：刪除前確認
      const ok = confirm(
        `確認刪除這個類型嗎？\n\n` +
        `Key：${k}\n` +
        `顯示名稱：${label}\n\n` +
        `僅當此類型沒有任何使用紀錄時才可刪除。\n` +
        `此操作無法復原！`
      );
      if(!ok) return;
      delete manifest.types[k];
      // 清理空容器
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
    chip.appendChild(del);
    wrap.appendChild(chip);
  });
}

// ------- 列表（現有條目） -------
function setDefaultDateFocus(){
  const today=ymd(new Date());
  const dates=Object.keys(manifest.days||{}).sort();
  const latest = dates.length ? dates[dates.length-1] : null;
  const pick = (!latest || latest < today) ? today : latest;
  q('#filterDate').value = pick;
  q('#date').value = pick;
}
function renderList(){
  const wrap=q('#list'); wrap.innerHTML='';
  const fd=q('#filterDate').value || null;
  const days=manifest.days||{};
  const dates=Object.keys(days).sort().filter(d=>!fd||d===fd);
  if(!dates.length){ wrap.innerHTML='<div class="item" style="opacity:.7">目前沒有條目</div>'; return; }

  dates.forEach(d=>{
    const perDate=days[d];
    Object.keys(perDate).forEach(course=>{
      Object.keys(perDate[course]).forEach(type=>{
        perDate[course][type].forEach((it,idx)=>{
          const row=document.createElement('div'); row.className='item';
          row.innerHTML=`
            <div>${d}｜${manifest.courses[course]?.label||course}｜${manifest.types[type]||type} → <strong>${it.title||base(it.path)}</strong></div>
            <div style="display:flex;gap:8px">
              <button class="btn gray">編輯</button>
              <button class="btn red">刪除</button>
            </div>`;
          row.children[1].children[0].onclick=async()=>{
            q('#date').value=d; q('#course').value=course; q('#type').value=type;
            q('#title').value=it.title||''; q('#filename').value=base(it.path||'');
            try{
              const raw = await getText(it.path);
              let bodySnippet = '';
              try{
                const doc = new DOMParser().parseFromString(raw, 'text/html');
                const cont = doc.querySelector('.container');
                if(cont){
                  const clone = cont.cloneNode(true);
                  const h1 = clone.querySelector('h1'); if(h1) h1.remove();
                  bodySnippet = clone.innerHTML.trim();
                }else{
                  bodySnippet = (doc.querySelector('body')?.innerHTML||'').trim();
                }
              }catch(_){}
              q('#html').value = bodySnippet;
            }catch(e){
              q('#html').value='';
              toast(false,'讀取既有 HTML 失敗，僅帶入標題/檔名');
            }
            toast(true,'已帶入表單，可直接修改後按「儲存」');
          };
          row.children[1].children[1].onclick=async()=>{
            // ★ 新增：刪除前確認
            const title = it.title || base(it.path||'');
            const msg =
              `確認要刪除這個項目嗎？\n\n` +
              `學生：${stu}\n` +
              `日期：${d}\n` +
              `課程：${manifest.courses[course]?.label||course} (${course})\n` +
              `類型：${manifest.types[type]||type} (${type})\n` +
              `標題/檔名：${title}\n\n` +
              `此操作將從 manifest 移除，並嘗試刪除對應檔案（若有）。\n` +
              `此操作無法復原！`;
            if (!confirm(msg)) return;
            const arr=manifest.days[d][course][type];
            const [removed]=arr.splice(idx,1);
            removeEmpty(d,course,type);
            if(removed?.path){
              try{ await apiDelete(removed.path); }catch(e){ toast(false,'刪檔失敗：'+(e.message||e)); }
            }
            await apiSave(`students/${stu}/manifest.json`, manifest);
            renderList(); toast(true,'已刪除（含 HTML 檔）');
          };
          wrap.appendChild(row);
        });
      });
    });
  });
}

// ------- actions -------
async function loadRoster(){
  roster=await getJSON('roster.json'); renderStu();
}
async function loadManifest(){
  manifest=await getJSON(`students/${stu}/manifest.json`); ensureBase();
  renderCourseType(); setDefaultDateFocus(); renderList(); renderTypeChips();
  wireCalendarLink();      // ★ 資料載入後更新
}
function buildFilename(date,title){
  const safe=(title||'lesson').trim().replace(/\s+/g,'_').toLowerCase();
  return `${date}_${safe}.html`;
}
async function doSave(){
  if(!isLocal()) return toast(false,'儲存/刪除僅限本機使用');
  if(!stu) return toast(false,'請先建立學生');
  const date=q('#date').value||''; if(!date) return toast(false,'請選日期');
  const course=q('#course').value; const type=q('#type').value;
  const title=(q('#title').value||'').trim();
  let filename=(q('#filename').value||'').trim(); if(!filename) filename = buildFilename(date,title);
  const rel=`materials/${stu}/${course}/${filename}`;
  const html=(q('#html').value||'').trim();

  if(html){
    const wrap=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title||''}</title>
<style>body{font-family:system-ui,"Noto Sans TC",Arial,sans-serif;margin:0;background:#f6f7fb;}
.header{background:#111827;color:#fff;padding:10px 14px;}
.header a{color:#a7f3d0;text-decoration:none}
.container{max-width:900px;margin:18px auto;background:#fff;border-radius:12px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,.06)}</style>
</head><body>
<div class="header">← <a href="../../../index.html?student=${encodeURIComponent(stu)}&date=${encodeURIComponent(date)}">返回日曆</a></div>
<div class="container"><h1>${title||''}</h1>${html}</div>
</body></html>`;
    await apiSave(rel, wrap);
  }

  const arr=ensureArr(date,course,type);
  const exists=arr.find(x=>x.path===rel);
  if(exists){ exists.title=title; } else { arr.push({title, path: rel}); }

  await apiSave(`students/${stu}/manifest.json`, manifest);

  if(!q('#keepForm').checked){
    q('#title').value=''; q('#filename').value=''; q('#html').value='';
  }
  setDefaultDateFocus(); renderList();
  toast(true,'已儲存');
}

function clearForm(){ q('#title').value=''; q('#filename').value=''; q('#html').value=''; }
async function reloadCurrentHtml(){
  const file=q('#filename').value; if(!file) return toast(false,'目前沒有檔名可重載');
  const rel=`materials/${stu}/${q('#course').value}/${file}`;
  try{
    const raw=await getText(rel);
    const doc=new DOMParser().parseFromString(raw,'text/html');
    const cont=doc.querySelector('.container'); let body='';
    if(cont){ const c=cont.cloneNode(true); const h=c.querySelector('h1'); if(h) h.remove(); body=c.innerHTML.trim(); }
    else{ body=(doc.querySelector('body')?.innerHTML||'').trim(); }
    q('#html').value=body; toast(true,'已重載目前教材');
  }catch(e){ toast(false,'重載失敗：'+(e.message||e)); }
}

// ▶ 新增 / 更新 類型
async function addOrUpdateType(){
  const key=(q('#newTypeKey').value||'').trim();
  const label=(q('#newTypeLabel').value||'').trim();
  if(!/^[a-z0-9_-]{2,}$/.test(key)) return toast(false,'請用小寫英數與 _- 當作 key（至少 2 字）');
  manifest.types[key] = label || key;
  await apiSave(`students/${stu}/manifest.json`, manifest);
  renderCourseType(); renderTypeChips();
  toast(true, `已 ${label?'更新':'新增'} 類型：${key}`);
}

function calendarURL(){
  // 取目前選中的學生與日期（若有 date 篩選）
  const dInput = q('#filterDate');
  const d = dInput && dInput.value ? dInput.value.trim() : '';
  const base = 'index.html';
  const qs = d
    ? `?student=${encodeURIComponent(stu)}&date=${encodeURIComponent(d)}`
    : `?student=${encodeURIComponent(stu)}`;
  return `${base}${qs}#calendar-widget`;
}

function wireCalendarLink(){
  const a = q('#gotoCalendar');
  if(!a || !stu) return;
  a.href = calendarURL();                    // 讓 href 反映目前選擇
  a.onclick = (ev)=>{                        // 保險：攔截點擊強制導向正確 URL
    ev.preventDefault();
    location.href = calendarURL();
  };
}


// ------- boot -------
async function init(){
  await loadRoster(); await loadManifest();
  q('#btnReload').onclick=loadManifest;
  q('#btnSave').onclick=doSave;
  q('#btnClear').onclick=clearForm;
  q('#btnReloadHtml').onclick=reloadCurrentHtml;
  q('#filterDate').oninput=()=>{ renderList();wireCalendarLink();} // ★ 日期變更也更新

  // 新增學生
  q('#btnAddStudent').onclick=async()=>{
    if(!isLocal()) return toast(false,'新增僅限本機使用');
    const id=(q('#newId').value||'').trim(); const name=(q('#newName').value||'').trim();
    if(!/^[a-z0-9_-]+$/.test(id)) return toast(false,'id 需為小寫英數與 _-');
    roster.students.push({id, name: name||id});
    await apiSave('roster.json', roster);
    q('#newId').value=''; q('#newName').value='';
    await loadRoster(); stu=id; await loadManifest(); toast(true,'已新增學生');
  };

  // 新增/更新 類型
  q('#btnAddType')?.addEventListener('click', addOrUpdateType);
}
init();
