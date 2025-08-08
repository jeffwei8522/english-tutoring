# -*- coding: utf-8 -*-
"""
en_class scaffolder & content manager
Spec: /docs 專案，學生端首頁 + 後台 GUI + per-student manifest
Commands:
  init --student <id>
  new-student --student <id>
  add --student <id> --course <key> --date YYYY-MM-DD --type material|homework --format html|pdf|image|link [--src PATH] [--external-url URL] [--title "文字"] [--dry-run]
  batch-add --student <id> --course <key> --from-dir PATH [--dry-run]
"""
import argparse, datetime as dt, json, os, re, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"

# ------------------------ helpers ------------------------
def p(*a): print(*a)
def ensure_dir(path: Path): path.mkdir(parents=True, exist_ok=True)
def write_text(path: Path, text: str, *, dry=False):
    ensure_dir(path.parent)
    if dry: p("  [dry] write", path); return
    path.write_text(text, encoding="utf-8"); p("  [+] write", path)
def copy_file(src: Path, dst: Path, *, dry=False):
    ensure_dir(dst.parent)
    if dry: p("  [dry] copy", src, "->", dst); return
    shutil.copy2(src, dst); p("  [+] copy", src, "->", dst)

def load_json(path: Path, default=None):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default if default is not None else {}

def backup_manifest(path: Path, *, dry=False):
    if not path.exists(): return
    ts = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    b = path.with_name(f"{path.stem}.backup-{ts}.json")
    if dry: p("  [dry] backup", path, "->", b); return
    shutil.copy2(path, b); p("  [*] backup", b)

def yymmdd(dtobj: dt.date): return dtobj.strftime("%y%m%d")

def yyyy_mm_dd_from_yymmdd(s: str):
    # '250810' -> '2025-08-10'（假設 20xx）
    return f"20{s[0:2]}-{s[2:4]}-{s[4:6]}"

def guess_format_from_ext(ext: str):
    e = ext.lower()
    if e in (".html", ".htm"): return "html"
    if e in (".pdf",): return "pdf"
    if e in (".png", ".jpg", ".jpeg", ".webp", ".gif"): return "image"
    return "link"

# ------------------------ templates ------------------------
INDEX_HTML = """<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>課程日曆</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet"/>
  <style>
    body { font-family: 'Noto Sans TC', sans-serif; }
    .today { background-color: #3b82f6; color: white; border-radius: 9999px; }
    .has-material:hover { background-color: #dbeafe; border-radius: 9999px; }
    .dot { height: 6px; width: 6px; background-color: #16a34a; border-radius: 50%;
           position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); }
  </style>
</head>
<body class="bg-gray-100 p-4 sm:p-8">

  <div class="max-w-4xl mx-auto bg-white rounded-2xl shadow-lg p-6 sm:p-10">
    <header class="text-center mb-12">
      <h1 class="text-3xl sm:text-4xl font-bold text-blue-800 mb-2">課程日曆 📅</h1>
      <p class="text-lg text-gray-600">使用 ?student=ray 指定學生；有資料的日期會有綠點</p>
    </header>

    <main>
      <section id="calendar-widget">
        <h2 class="text-2xl font-bold text-blue-700 border-b-2 border-blue-200 pb-2 mb-6">課程日曆</h2>
        <div class="bg-gray-50 p-4 sm:p-6 rounded-lg shadow-inner">
          <div class="flex items-center justify-between mb-4">
            <button id="prev-month" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 transition-colors">◀</button>
            <h3 id="month-year" class="text-xl font-bold text-gray-800 w-40 text-center"></h3>
            <button id="next-month" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700 transition-colors">▶</button>
          </div>

          <div class="grid grid-cols-7 gap-1 text-center text-sm font-medium text-gray-600 mb-2">
            <div>日</div><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div>
          </div>
          <div id="calendar-grid" class="grid grid-cols-7 gap-1"></div>
        </div>
      </section>
    </main>

    <footer class="text-center mt-16 pt-8 border-t border-gray-200">
      <p class="text-gray-500">Powered by GitHub Pages · Admin：<a href="admin.html" class="text-blue-600 underline">admin.html</a></p>
    </footer>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', async function () {
      const calendarGrid = document.getElementById('calendar-grid');
      const monthYearDisplay = document.getElementById('month-year');
      const prevMonthBtn = document.getElementById('prev-month');
      const nextMonthBtn = document.getElementById('next-month');

      const params = new URLSearchParams(location.search);
      const student = params.get('student') || 'ray';
      const qDate = params.get('date');
      let currentDate = qDate && !isNaN(Date.parse(qDate)) ? new Date(qDate) : new Date();
      let selectedDate = qDate || null;

      let manifest = { days: {}, courses: {} };
      try {
        const res = await fetch(`students/${student}/manifest.json?ts=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) manifest = await res.json();
        else console.warn('讀 manifest 失敗：', res.status);
      } catch (e) { console.warn('讀 manifest 錯誤：', e); }

      function hasAnyCourse(dateStr){ return Boolean(manifest.days && manifest.days[dateStr]); }

      function openCoursePicker(dateStr, coursesMap, courseMeta) {
        const items = Object.entries(coursesMap).map(([key, obj])=>{
          const label = (courseMeta[key] && courseMeta[key].label) || key;
          const m = obj.material ? `<a class="block px-4 py-2 hover:bg-gray-100 rounded" href="${obj.material.url}">📘 ${label}：教材</a>` : '';
          const h = obj.homework ? `<a class="block px-4 py-2 hover:bg-gray-100 rounded" href="${obj.homework.url}" target="${obj.homework.format==='link'?'_blank':'_self'}">📝 ${label}：作業</a>` : '';
          return m + h;
        }).join('');
        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50';
        wrap.innerHTML = `
          <div class="bg-white rounded-xl shadow-xl max-w-md w-full p-4">
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-lg font-bold">選擇課程｜${dateStr}</h3>
              <button class="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded" id="close-picker">✕</button>
            </div>
            <div class="space-y-2">${items || '<div class="text-gray-500">沒有可用資料</div>'}</div>
          </div>`;
        document.body.appendChild(wrap);
        wrap.querySelector('#close-picker').onclick = () => wrap.remove();
        wrap.addEventListener('click', (e)=>{ if(e.target===wrap) wrap.remove(); });
      }

      function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth(); // 0-11
        const today = new Date();

        monthYearDisplay.textContent = `${year}年 ${month + 1}月`;
        calendarGrid.innerHTML = '';

        const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=週日
        const lastDateOfMonth = new Date(year, month + 1, 0).getDate();
        const lastDateOfPrevMonth = new Date(year, month, 0).getDate();

        for (let i = firstDayOfMonth; i > 0; i--) {
          const day = lastDateOfPrevMonth - i + 1;
          calendarGrid.innerHTML += `<div class="p-2 text-gray-300">${day}</div>`;
        }

        for (let i = 1; i <= lastDateOfMonth; i++) {
          const dayCell = document.createElement('div');
          dayCell.className = 'p-2 relative flex justify-center items-center cursor-pointer';

          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;

          let content;
          if (hasAnyCourse(dateStr)) {
            dayCell.classList.add('has-material');
            content = document.createElement('a');
            content.innerHTML = `${i}<span class="dot"></span>`;
            content.className = 'w-full h-full flex justify-center items-center';
            content.addEventListener('click', (ev)=>{
              ev.preventDefault();
              const courses = manifest.days[dateStr];
              const keys = Object.keys(courses||{});
              if (keys.length===1) {
                const c = courses[keys[0]];
                const target = c.material ? c.material.url : (c.homework ? c.homework.url : null);
                if (target) location.href = target;
              } else {
                openCoursePicker(dateStr, courses, manifest.courses||{});
              }
            });
          } else {
            content = document.createElement('span');
            content.textContent = i;
          }

          const todayY = today.getFullYear(), todayM = today.getMonth(), todayD = today.getDate();
          if (year === todayY && month === todayM && i === todayD) (content.tagName === 'A' ? content : dayCell).classList.add('today');

          if (selectedDate && dateStr === selectedDate) dayCell.classList.add('ring-2','ring-blue-500','rounded-full');

          dayCell.appendChild(content);
          calendarGrid.appendChild(dayCell);
        }
      }

      prevMonthBtn.addEventListener('click', ()=>{ currentDate.setMonth(currentDate.getMonth()-1); renderCalendar(); });
      nextMonthBtn.addEventListener('click', ()=>{ currentDate.setMonth(currentDate.getMonth()+1); renderCalendar(); });

      renderCalendar();
    });
  </script>
</body>
</html>
"""

ADMIN_HTML = """<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin · Manifest 編輯器</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-gray-100 p-4 sm:p-8">
<div class="max-w-6xl mx-auto bg-white rounded-2xl shadow p-6">
  <h1 class="text-2xl font-bold mb-3">Manifest 編輯器（離線匯出）</h1>
  <p class="text-gray-600 mb-4">載入 <code>students/&lt;student&gt;/manifest.json</code>，圖形化編輯日期/課程/教材與作業（含 format），最後匯出檔案覆蓋即可。</p>

  <div class="flex flex-wrap items-center gap-2 mb-4">
    <input id="studentId" class="border px-2 py-1 rounded" placeholder="student（預設 ray）">
    <button id="loadBtn" class="px-3 py-1 bg-blue-600 text-white rounded">載入</button>
    <input type="file" id="filePicker" class="hidden" accept="application/json">
    <button id="loadFile" class="px-3 py-1 bg-gray-200 rounded">從檔案載入</button>
    <button id="saveFile" class="px-3 py-1 bg-emerald-600 text-white rounded">匯出 manifest.json</button>
    <span class="text-gray-400">|</span>
    <button id="downloadTpl" class="px-3 py-1 bg-gray-200 rounded">下載 HTML 範本</button>
  </div>

  <div id="editor" class="space-y-4"></div>
</div>
<script>
const $ = s => document.querySelector(s);
let manifest = null;

async function fetchManifest(student){
  const url = `students/${student}/manifest.json?ts=${Date.now()}`;
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return await res.json();
}
function render(){
  const el = $('#editor');
  if(!manifest){ el.innerHTML = '<p class="text-gray-500">尚未載入 manifest。</p>'; return; }

  const days = manifest.days || {};
  const courses = manifest.courses || {};
  const dayKeys = Object.keys(days).sort();

  const courseRow = `
    <div class="p-3 rounded border">
      <div class="font-semibold mb-2">學生：${manifest.displayName||manifest.student}（${manifest.student}）</div>
      <div class="mb-2">課程清單：
        ${Object.entries(courses).map(([k,v])=>`<span class="px-2 py-0.5 rounded bg-gray-100 border mr-1">${k}（${v.label||k}）</span>`).join('') || '<span class="text-gray-400">尚無</span>'}
      </div>
      <div class="flex gap-2 mb-2">
        <input id="newCourseKey" class="border px-2 py-1 rounded" placeholder="course key（如 english）">
        <input id="newCourseLabel" class="border px-2 py-1 rounded" placeholder="顯示名稱（如 英文）">
        <input id="newCourseColor" class="border px-2 py-1 rounded" placeholder="顏色（如 #1d4ed8）">
        <button id="addCourse" class="px-3 py-1 bg-gray-200 rounded">新增課程</button>
      </div>
    </div>`;

  const dayRows = dayKeys.map(d=>{
    const map = days[d];
    const items = Object.entries(map).map(([ck, obj])=>{
      const mat = obj.material || {};
      const hw  = obj.homework || {};
      const opt = (sel, v) => sel===v ? 'selected' : '';
      return `
      <div class="p-3 border rounded mb-3">
        <div class="font-medium mb-1">${ck} · ${(courses[ck]&&courses[ck].label)||ck}</div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
          <div class="font-semibold text-blue-700">📘 教材</div>
          <select class="border px-2 py-1 rounded" data-date="${d}" data-course="${ck}" data-slot="material" data-field="format">
            <option ${opt(mat.format,'html')} value="html">html</option>
            <option ${opt(mat.format,'pdf')} value="pdf">pdf</option>
            <option ${opt(mat.format,'image')} value="image">image</option>
            <option ${opt(mat.format,'link')} value="link">link</option>
          </select>
          <input class="border px-2 py-1 rounded" placeholder="URL（相對或 http）" value="${mat.url||''}" data-date="${d}" data-course="${ck}" data-slot="material" data-field="url">
          <input class="border px-2 py-1 rounded md:col-span-3" placeholder="title（可空）" value="${obj.title||''}" data-date="${d}" data-course="${ck}" data-field="title">

          <div class="font-semibold text-amber-700 mt-2">📝 作業</div>
          <select class="border px-2 py-1 rounded" data-date="${d}" data-course="${ck}" data-slot="homework" data-field="format">
            <option ${opt(hw.format,'html')} value="html">html</option>
            <option ${opt(hw.format,'pdf')} value="pdf">pdf</option>
            <option ${opt(hw.format,'image')} value="image">image</option>
            <option ${opt(hw.format,'link')} value="link">link</option>
          </select>
          <input class="border px-2 py-1 rounded" placeholder="URL（相對或 http）" value="${hw.url||''}" data-date="${d}" data-course="${ck}" data-slot="homework" data-field="url">
        </div>
      </div>`;
    }).join('');

    return `
    <details class="mb-3">
      <summary class="cursor-pointer select-none p-2 bg-gray-50 rounded border">${d} · ${Object.keys(map).length} 門課</summary>
      <div class="p-2">
        ${items || '<div class="text-gray-500">這天尚無課程</div>'}
        <div class="flex gap-2 mt-2">
          <select id="addCourseSel_${d}" class="border px-2 py-1 rounded">
            <option value="">選擇要新增的課程</option>
            ${Object.keys(courses).map(k=>`<option value="${k}">${k}（${courses[k].label||k}）</option>`).join('')}
          </select>
          <button data-add="${d}" class="px-3 py-1 bg-gray-200 rounded">新增到此日</button>
        </div>
      </div>
    </details>`;
  }).join('');

  el.innerHTML = courseRow + `
    <div class="p-3 rounded border">
      <div class="font-semibold mb-2">日期清單</div>
      ${dayRows}
      <div class="flex gap-2 mt-4">
        <input id="newDate" class="border px-2 py-1 rounded" placeholder="YYYY-MM-DD">
        <button id="addDate" class="px-3 py-1 bg-gray-200 rounded">新增日期</button>
      </div>
    </div>`;

  $('#addCourse')?.addEventListener('click', ()=>{
    const key = $('#newCourseKey').value.trim(); if(!key) return alert('course key 必填');
    const label = $('#newCourseLabel').value.trim() || key;
    const color = $('#newCourseColor').value.trim() || '#333';
    manifest.courses = manifest.courses || {};
    if(manifest.courses[key]) return alert('已存在相同 key');
    manifest.courses[key] = { label, color };
    render();
  });

  document.querySelectorAll('select[data-field],input[data-field]')?.forEach(inp=>{
    inp.addEventListener('change', ()=>{
      const d = inp.dataset.date, c = inp.dataset.course, slot = inp.dataset.slot, f = inp.dataset.field;
      if (slot) {
        manifest.days[d][c][slot] = manifest.days[d][c][slot] || {};
        manifest.days[d][c][slot][f] = inp.value;
      } else {
        manifest.days[d][c][f] = inp.value;
      }
    });
  });

  document.querySelectorAll('button[data-add]')?.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const d = btn.dataset.add;
      const sel = document.getElementById('addCourseSel_'+d);
      const key = sel.value; if(!key) return;
      manifest.days[d] = manifest.days[d] || {};
      if (!manifest.days[d][key]) manifest.days[d][key] = { title:'', material:{format:'html',url:''}, homework:{format:'html',url:''} };
      render();
    });
  });

  $('#addDate')?.addEventListener('click', ()=>{
    const d = $('#newDate').value.trim();
    if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) return alert('日期格式 YYYY-MM-DD');
    manifest.days = manifest.days || {};
    if(manifest.days[d]) return alert('此日期已存在');
    manifest.days[d] = {};
    render();
  });
}

$('#loadBtn').addEventListener('click', async ()=>{
  const student = ($('#studentId').value || 'ray').trim();
  try { manifest = await fetchManifest(student); render(); }
  catch(e){ alert('讀取失敗：'+e.message); }
});

$('#loadFile').addEventListener('click', ()=> $('#filePicker').click());
$('#filePicker').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if(!f) return;
  const txt = await f.text();
  try { manifest = JSON.parse(txt); render(); }
  catch(e){ alert('JSON 解析失敗'); }
});

$('#saveFile').addEventListener('click', ()=>{
  if(!manifest) return alert('尚未載入資料');
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'manifest.json';
  a.click(); URL.revokeObjectURL(url);
});

$('#downloadTpl').addEventListener('click', ()=>{
  const d = new Date();
  const iso = d.toISOString().slice(0,10);
  const html = `<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="lesson-date" content="${iso}">
<title>教材樣板</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-gray-100 p-4 sm:p-8">
<div id="breadcrumb" class="max-w-4xl mx-auto mb-4"></div>
<script>(function(){const p=new URLSearchParams(location.search);const student=p.get('student')||'ray';const meta=document.querySelector('meta[name="lesson-date"]')?.content?.trim();const back=meta? \\'../index.html?student=\\'+student+\\'&date=\\'+meta+\\'#calendar-widget\\' : \\'../index.html?student=\\'+student+\\'#calendar-widget\\';document.getElementById('breadcrumb').innerHTML = '<a href=\"'+back+'\" class=\"text-blue-600 hover:underline\">&larr; 返回課程日曆</a>';})();</script>
<div class="max-w-4xl mx-auto bg-white rounded-2xl shadow p-6">
  <h1 class="text-2xl font-bold mb-2">教材標題</h1>
  <p class="text-gray-600 mb-6">把 AI 產的內容貼到這裡。</p>
</div>
</body></html>`;
  const blob = new Blob([html], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'lesson_template.html';
  a.click(); URL.revokeObjectURL(url);
});
</script>
</body></html>
"""

MATERIAL_TEMPLATE = """<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="lesson-date" content="{iso_date}">
<title>{title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<body class="bg-gray-100 p-4 sm:p-8">
<div id="breadcrumb" class="max-w-4xl mx-auto mb-4"></div>
<script>(function(){{
  const p = new URLSearchParams(location.search);
  const student = p.get('student') || 'ray';
  const meta = document.querySelector('meta[name="lesson-date"]')?.content?.trim();
  const back = meta
    ? '../index.html?student=' + student + '&date=' + meta + '#calendar-widget'
    : '../index.html?student=' + student + '#calendar-widget';
  document.getElementById('breadcrumb').innerHTML =
    '<a href="' + back + '" class="text-blue-600 hover:underline">&larr; 返回課程日曆</a>';
}})();</script>
<div class="max-w-4xl mx-auto bg-white rounded-2xl shadow p-6">
  <h1 class="text-2xl font-bold mb-2">{title}</h1>
  <p class="text-gray-600 mb-6">把 AI 產的內容貼到這裡。</p>
</div>
</body></html>
"""

README = """# en_class (Project Pages)

- GitHub Pages → Source = `main` / `docs`
- 學生首頁：`docs/index.html?student=<id>`
- 後台：`docs/admin.html`（離線匯出版）
- 每位學生設定：`docs/students/<id>/manifest.json`
- 教材/作業檔：`docs/materials/<student>/<course>/...`
"""

GITIGNORE = """__pycache__/
*.backup-*.json
"""

# ------------------------ core ops ------------------------
def init_cmd(student: str, *, dry=False):
    p(">>> init scaffold to /docs")
    ensure_dir(DOCS)
    write_text(DOCS/".nojekyll", "", dry=dry)
    write_text(ROOT/".gitignore", GITIGNORE, dry=dry)
    write_text(DOCS/"index.html", INDEX_HTML, dry=dry)
    write_text(DOCS/"admin.html", ADMIN_HTML, dry=dry)
    write_text(ROOT/"README.md", README, dry=dry)

    # seed student
    new_student_cmd(student, create_samples=True, dry=dry)

def new_student_cmd(student: str, create_samples=False, *, dry=False):
    manifest_path = DOCS / f"students/{student}/manifest.json"
    if manifest_path.exists() and not dry:
        p("  [=] already exists:", manifest_path)
        return
    today = dt.date.today()
    d0 = today.strftime("%Y-%m-%d")
    d1 = (today - dt.timedelta(days=7)).strftime("%Y-%m-%d")
    data = {
        "version": 1,
        "student": student,
        "displayName": student.capitalize(),
        "courses": {
            "english": {"label": "英文", "color": "#1d4ed8"},
            "math": {"label": "數學", "color": "#059669"}
        },
        "days": {
            d0: {},
            d1: {}
        }
    }
    write_text(manifest_path, json.dumps(data, ensure_ascii=False, indent=2), dry=dry)

    if create_samples:
        # create sample HTMLs for today
        for course in ("english", "math"):
            add_cmd(student=student, course=course, date=d0, typ="material", fmt="html",
                    src=None, title=f"{data['courses'][course]['label']}教材（樣板）", dry=dry)

def add_cmd(*, student: str, course: str, date: str, typ: str, fmt: str,
            src: str|None, title: str|None=None, external_url: str|None=None, dry=False):
    assert typ in ("material","homework")
    assert fmt in ("html","pdf","image","link")
    # paths
    rel_dir = Path(f"materials/{student}/{course}")
    abs_dir = DOCS / rel_dir
    ensure_dir(abs_dir)

    # load & backup manifest
    manifest_path = DOCS / f"students/{student}/manifest.json"
    manifest = load_json(manifest_path, default={"version":1,"student":student,"courses":{course:{"label":course,"color":"#333"}}, "days":{}})
    backup_manifest(manifest_path, dry=dry)

    # decide target URL
    if fmt == "link":
        if not external_url:
            raise SystemExit("--external-url 為必填（format=link）")
        url = external_url
        dst_path = None
    else:
        # decide filename
        ymd = date.replace("-","")
        yyMMdd = ymd[2:]
        suffix = "_hw" if typ=="homework" and fmt=="html" else ""
        if src:
            ext = Path(src).suffix.lower()
            if not ext:
                # default extension per format
                ext = ".html" if fmt=="html" else (".pdf" if fmt=="pdf" else ".png")
            fname = f"{yyMMdd}{'_hw' if typ=='homework' and fmt!='html' else ''}{ext}" if fmt!="html" else f"{yyMMdd}{suffix}.html"
            dst_path = abs_dir / fname
            copy_file(Path(src), dst_path, dry=dry)
        else:
            # no src: only allowed for html -> create template
            if fmt != "html":
                raise SystemExit("未提供 --src，僅支援 format=html 自動產生模板")
            fname = f"{yyMMdd}{'_hw' if typ=='homework' else ''}.html"
            dst_path = abs_dir / fname
            html = MATERIAL_TEMPLATE.format(iso_date=date, title=title or "教材（樣板）")
            write_text(dst_path, html, dry=dry)
        url = f"{rel_dir.as_posix()}/{dst_path.name}"

    # update manifest
    manifest.setdefault("courses", {}).setdefault(course, {"label":course, "color":"#333"})
    manifest.setdefault("days", {}).setdefault(date, {}).setdefault(course, {})
    node = manifest["days"][date][course]
    if title: node["title"] = title
    node.setdefault(typ, {})
    node[typ]["format"] = fmt
    node[typ]["url"] = url

    # write manifest
    write_text(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2), dry=dry)
    p("  ==> updated", manifest_path)

def batch_add_cmd(*, student: str, course: str, from_dir: str, dry=False):
    base = Path(from_dir)
    if not base.exists(): raise SystemExit(f"來源資料夾不存在：{base}")
    files = [p for p in base.iterdir() if p.is_file()]
    if not files: p("（來源資料夾沒有檔案）"); return
    for f in sorted(files):
        m = re.match(r"^(\d{6})(?:_hw)?", f.stem, re.IGNORECASE)
        if not m:
            p("  [skip] 檔名未含日期 YYMMDD：", f.name); continue
        date = yyyy_mm_dd_from_yymmdd(m.group(1))
        is_hw = "_hw" in f.stem.lower()
        ext = f.suffix.lower()
        fmt = guess_format_from_ext(ext)
        typ = "homework" if is_hw else "material"
        p(f"  -> {f.name}  date={date} type={typ} fmt={fmt}")
        add_cmd(student=student, course=course, date=date, typ=typ, fmt=fmt, src=str(f), dry=dry, title=None)

# ------------------------ CLI ------------------------
def main():
    ap = argparse.ArgumentParser(description="en_class scaffolder & manager")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_init = sub.add_parser("init", help="初始化 /docs 骨架")
    ap_init.add_argument("--student", default="ray")
    ap_init.add_argument("--dry-run", action="store_true")

    ap_ns = sub.add_parser("new-student", help="新增學生（空 manifest）")
    ap_ns.add_argument("--student", required=True)
    ap_ns.add_argument("--dry-run", action="store_true")

    ap_add = sub.add_parser("add", help="新增/更新一筆教材或作業")
    ap_add.add_argument("--student", required=True)
    ap_add.add_argument("--course", required=True)
    ap_add.add_argument("--date", required=True, help="YYYY-MM-DD")
    ap_add.add_argument("--type", dest="typ", choices=["material","homework"], required=True)
    ap_add.add_argument("--format", dest="fmt", choices=["html","pdf","image","link"], required=True)
    ap_add.add_argument("--src")
    ap_add.add_argument("--external-url")
    ap_add.add_argument("--title")
    ap_add.add_argument("--dry-run", action="store_true")

    ap_b = sub.add_parser("batch-add", help="批次匯入資料夾（檔名要有 YYMMDD；含 _hw 視為作業）")
    ap_b.add_argument("--student", required=True)
    ap_b.add_argument("--course", required=True)
    ap_b.add_argument("--from-dir", required=True)
    ap_b.add_argument("--dry-run", action="store_true")

    args = ap.parse_args()

    if args.cmd == "init":
        init_cmd(args.student, dry=args.dry_run)
    elif args.cmd == "new-student":
        new_student_cmd(args.student, dry=args.dry_run)
    elif args.cmd == "add":
        add_cmd(student=args.student, course=args.course, date=args.date, typ=args.typ, fmt=args.fmt,
                src=args.src, title=args.title, external_url=args.external_url, dry=args.dry_run)
    elif args.cmd == "batch-add":
        batch_add_cmd(student=args.student, course=args.course, from_dir=args.from_dir, dry=args.dry_run)

if __name__ == "__main__":
    main()
