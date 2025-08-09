import argparse
from pathlib import Path
import re
import shutil
import sys
import tiktoken
from pathspec import PathSpec
from pathspec.patterns.gitwildmatch import GitWildMatchPattern

# ----------- Defaults -----------
DEFAULT_EXTS = [
    ".py", ".js", ".ts", ".html", ".css",
    ".json", ".md", ".txt",
    ".yml", ".yaml",  # <-- 新增 YAML
    ".toml", ".ini", ".cfg",
]

# ----------- Utilities -----------
def load_gitignore(root_path: Path):
    gitignore_path = root_path / ".gitignore"
    if not gitignore_path.exists():
        return None
    patterns = gitignore_path.read_text(encoding="utf-8").splitlines()
    spec = PathSpec.from_lines(GitWildMatchPattern, patterns)
    return spec

def estimate_token_count(text: str) -> int:
    try:
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return int(len(text) / 4)  # fallback 粗估

# ----------- Main Function -----------
def zip_project(root_path: Path, include_exts, output_dir_name=".ai_zip_output", output_file_name="uniflow_snapshot.txt"):
    # 正規化副檔名（補點號、轉小寫、去重）
    include_exts = {
        e.lower() if e.startswith(".") else f".{e.lower()}"
        for e in include_exts
    }

    output_dir = root_path / output_dir_name
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / output_file_name

    gitignore_spec = load_gitignore(root_path)
    files_added = []
    file_count = 0
    env_file_warning = False
    all_text = f"### Project root: {root_path.resolve()}\n"

    for filepath in root_path.rglob("*"):
        if filepath.is_dir():
            continue
        rel_path = filepath.relative_to(root_path)

        if rel_path.name == "ai_zipper.py":
            continue  # Skip self
        if gitignore_spec and gitignore_spec.match_file(str(rel_path)):
            continue
        if filepath.suffix.lower() not in include_exts:
            continue

        try:
            content = filepath.read_text(encoding="utf-8")
        except Exception as e:
            print(f"[Skipped] {rel_path}: {e}")
            continue

        all_text += f"\n=== FILE: {rel_path} ===\n{content}\n"
        files_added.append(str(rel_path))
        file_count += 1
        if filepath.name == ".env":
            env_file_warning = True

    output_path.write_text(all_text, encoding="utf-8")

    print(f"\n✅ Done. Total files added: {file_count}")
    print(f"📄 Output file: {output_path}")
    print(f"🧠 Estimated token count: {estimate_token_count(all_text):,} tokens")
    if env_file_warning:
        print("⚠️  Warning: .env file was included in output! Double-check for secrets.")
    if not (root_path / ".gitignore").exists():
        print("📌 Tip: You can create a .gitignore to auto-exclude folders like __pycache__, .venv, node_modules, etc.")

# ----------- CLI Entry Point -----------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="📦 AI Zipper - Bundle project files into one txt for AI context upload"
    )
    parser.add_argument(
        "--root",
        type=str,
        default=str(Path.cwd()),
        help="Project root path (default: cwd)"
    )
    parser.add_argument(
        "--include-ext",
        nargs="*",
        default=DEFAULT_EXTS,
        help=(
            "File extensions to include (e.g., .py .html .yml .yaml). "
            "Defaults: " + ", ".join(DEFAULT_EXTS)
        ),
    )
    args = parser.parse_args()

    zip_project(Path(args.root), args.include_ext)
