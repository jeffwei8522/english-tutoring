# server.py
from __future__ import annotations
import json, mimetypes
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, Response, abort
from werkzeug.utils import safe_join

app = Flask(__name__, static_folder=None)

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "docs"
DOCS_DIR.mkdir(exist_ok=True)

def _json_ok(data):
    return Response(json.dumps(data, ensure_ascii=False, indent=2),
                    mimetype="application/json; charset=utf-8")

def _default_manifest(student_id: str) -> dict:
    return {
        "version": 3,
        "student": student_id,
        "displayName": student_id,
        "courses": {"english": {"label": "英文"}, "math": {"label": "數學"}},
        "types": {"material": "教材", "homework": "作業"},
        "days": {}
    }

def _default_roster() -> dict:
    return {"students": []}

def _path_under_docs(relpath: str) -> Path:
    p = DOCS_DIR / Path(relpath.strip("/"))
    p.parent.mkdir(parents=True, exist_ok=True)
    return p

def _guess_mime(p: Path) -> str:
    t, _ = mimetypes.guess_type(str(p))
    return t or "text/plain; charset=utf-8"

@app.get("/api/data/<path:req_path>")
def api_data(req_path: str):
    dst = safe_join(str(DOCS_DIR), req_path)
    if not dst: abort(400)
    fp = Path(dst)
    lower = req_path.lower()

    if not fp.exists():
        if lower.endswith("manifest.json"):
            parts = Path(req_path).parts
            sid = parts[-2] if len(parts) >= 2 else "unknown"
            return _json_ok(_default_manifest(sid))
        if lower == "roster.json":
            return _json_ok(_default_roster())
        return jsonify({"error": "Not Found", "path": req_path}), 404

    if lower.endswith(".json"):
        return _json_ok(json.loads(fp.read_text(encoding="utf-8")))

    mime = _guess_mime(fp)
    if mime.startswith("text/") or mime.endswith(("xml", "javascript")):
        return Response(fp.read_text(encoding="utf-8"), mimetype=mime)
    return Response(fp.read_bytes(), mimetype=mime)

@app.post("/api/save")
def api_save():
    data = request.get_json(silent=True) or {}
    relpath, content = data.get("path"), data.get("content")
    if not relpath:
        return jsonify({"status":"error","message":"missing path"}), 400

    target = _path_under_docs(relpath)
    if str(target).lower().endswith(".json"):
        if isinstance(content, str):
            try: content = json.loads(content)
            except Exception: return jsonify({"status":"error","message":"content is not valid JSON"}), 400
        target.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        if not isinstance(content, str):
            return jsonify({"status":"error","message":"content must be string for non-JSON files"}), 400
        target.write_text(content, encoding="utf-8")

    return jsonify({"status":"success","path": str(target.relative_to(DOCS_DIR))})

@app.post("/api/delete")
def api_delete():
    data = request.get_json(silent=True) or {}
    relpath = (data.get("path") or "").strip("/")
    if not relpath:
        return jsonify({"status":"error","message":"missing path"}), 400
    target = Path(safe_join(str(DOCS_DIR), relpath))
    if not target or not target.exists():
        return jsonify({"status":"success","deleted": False, "path": relpath})
    if target.is_dir():
        return jsonify({"status":"error","message":"refuse to delete directory"}), 400
    try:
        target.unlink()
        return jsonify({"status":"success","deleted": True, "path": relpath})
    except Exception as e:
        return jsonify({"status":"error","message":str(e)}), 500

@app.get("/")
def _root(): return send_from_directory(DOCS_DIR, "teacher.html")

@app.get("/<path:filename>")
def _static(filename: str):
    full = safe_join(str(DOCS_DIR), filename)
    if not full or not Path(full).exists(): abort(404)
    return send_from_directory(DOCS_DIR, filename)

if __name__ == "__main__":
    print("Serving at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
