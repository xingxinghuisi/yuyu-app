#!/usr/bin/env python3
"""
v0.9 全量中文释义重写：导出待处理词 -> LLM 批量改写 -> 导入回库

用法：
  # 1. 导出待重写的词（跳过 zh_source='llm' 的），每批 N 个
  python3 tools/rewrite_zh.py export --db backend/data/seed/yuyu-vocab.db \
      --out /tmp/zh_batches --batch-size 120

  # 2. LLM 处理后，把结果 JSON 放到 /tmp/zh_batches/done/，文件名 batch_*.json
  #    格式：[{"id": "...", "zh": "① ...（...）② ..."}, ...]

  # 3. 导入回库（zh_source 设为 'llm'）
  python3 tools/rewrite_zh.py import --db backend/data/seed/yuyu-vocab.db \
      --indir /tmp/zh_batches/done

  # 进度
  python3 tools/rewrite_zh.py status --db backend/data/seed/yuyu-vocab.db
"""
import argparse
import json
import os
import sqlite3
import sys

BATCH_SIZE = 120


def get_db(path):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    return db


def cmd_status(args):
    db = get_db(args.db)
    cur = db.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM words")
    total = cur.fetchone()["c"]
    cur.execute("SELECT zh_source, COUNT(*) AS c FROM words GROUP BY zh_source")
    print(f"total: {total}")
    for r in cur.fetchall():
        print(f"  zh_source={r['zh_source']}: {r['c']}")
    cur.execute("SELECT COUNT(*) AS c FROM words WHERE zh_source='llm'")
    done = cur.fetchone()["c"]
    print(f"progress: {done}/{total} ({done/total*100:.1f}%)")


def cmd_export(args):
    db = get_db(args.db)
    cur = db.cursor()
    # 待重写：zh_source 不是 'llm' 的（包括 NULL）
    cur.execute("""
        SELECT id, kana, kanji, meaning_en, meaning_zh, zh_source, level, pos
        FROM words WHERE zh_source IS NULL OR zh_source != 'llm'
        ORDER BY level, kana
    """)
    rows = [dict(r) for r in cur.fetchall()]
    print(f"[export] {len(rows)} words need rewrite", file=sys.stderr)

    os.makedirs(args.out, exist_ok=True)
    batch_size = args.batch_size
    n_batches = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        n_batches += 1
        path = os.path.join(args.out, f"batch_{n_batches:04d}.json")
        # 跳过已存在的批次文件（断点续跑）
        if os.path.exists(path) and not args.overwrite:
            continue
        with open(path, "w", encoding="utf-8") as f:
            json.dump(batch, f, ensure_ascii=False, indent=1)
    print(f"[export] {n_batches} batch files in {args.out}", file=sys.stderr)


def cmd_import(args):
    db = get_db(args.db)
    cur = db.cursor()
    total = 0
    for fname in sorted(os.listdir(args.indir)):
        if not fname.startswith("batch_") or not fname.endswith(".json"):
            continue
        path = os.path.join(args.indir, fname)
        with open(path, encoding="utf-8") as f:
            items = json.load(f)
        for it in items:
            wid = it.get("id")
            zh = (it.get("zh") or "").strip()
            if not wid or not zh:
                print(f"[import] SKIP empty: {fname} {wid}", file=sys.stderr)
                continue
            cur.execute(
                "UPDATE words SET meaning_zh=?, zh_source='llm' WHERE id=?",
                (zh, wid),
            )
            total += 1
        db.commit()
        print(f"[import] {fname}: {len(items)} words", file=sys.stderr)
    print(f"[import] DONE total={total}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("status")
    p.add_argument("--db", required=True)

    p = sub.add_parser("export")
    p.add_argument("--db", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    p.add_argument("--overwrite", action="store_true")

    p = sub.add_parser("import")
    p.add_argument("--db", required=True)
    p.add_argument("--indir", required=True)

    args = ap.parse_args()
    {"status": cmd_status, "export": cmd_export, "import": cmd_import}[args.cmd](args)


if __name__ == "__main__":
    main()
