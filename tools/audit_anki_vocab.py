"""Read-only comparison of egg rolls' Anki TSV against the application's word DB.

The outputs are review files, NOT an import or a deletion manifest. Written form
and reading identify candidates, not senses: lock/rock must remain distinguishable.
Usage: python tools/audit_anki_vocab.py --notes notes.csv --db app.db --out report
"""

import argparse
import collections
import csv
import hashlib
import json
import re
import sqlite3
import unicodedata
from contextlib import closing
from html.parser import HTMLParser
from pathlib import Path

SOURCE = "https://github.com/5mdld/anki-jlpt-decks"
COMMIT = "853798a4dec3630cad1984aa1c7edab31b09d109"
SHA256 = "30e9350c92c7bdeaf0f4c0317c9a0f659eb32e606a69870176deff159559eb1a"
LEVELS = ("N5", "N4", "N3", "N2", "N1")


class TextOnly(HTMLParser):
    """Discard HTML markup and annotations; never evaluate Anki templates."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = []

    def handle_starttag(self, tag, attrs):
        if tag in ("rt", "rp", "script", "style"):
            self.hidden.append(tag)
        elif tag == "br" and not self.hidden:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.hidden:
            self.hidden.remove(tag)
        elif tag in ("p", "div", "li") and not self.hidden:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain(value):
    parser = TextOnly()
    parser.feed(value or "")
    return "".join(parser.parts).strip()


def norm(value):
    return unicodedata.normalize("NFKC", value or "").strip()


def reading_key(value):
    # Same pronunciation may be written in hiragana or katakana; the separate
    # written-form component of our key is retained, preventing broad homophone merges.
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in norm(value))


def pair(written, reading):
    return norm(written), reading_key(reading)


def read_notes(path):
    notes = []
    seen = set()
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader((line for line in handle if not line.startswith("#")), delimiter="\t")
        for number, row in enumerate(reader, 1):
            if len(row) != 39:
                raise ValueError(f"Note {number}: expected 39 columns, got {len(row)}")
            level = re.search(r"::\d-(N[1-5])(?:$|::)", row[1])
            if not level or not row[2] or row[2] in seen:
                raise ValueError(f"Note {number}: invalid level or duplicate/missing note ID")
            seen.add(row[2])
            written, reading = plain(row[3]), plain(row[6])
            # This field holds English/French etymology for katakana words,
            # e.g. アパート -> apartment house. It is not their pronunciation.
            inferred = bool(re.fullmatch(r"[ァ-ヶー・]+", norm(written)))
            if inferred:
                reading = written
            if not written or not reading or not plain(row[7]):
                raise ValueError(f"Note {number}: missing written form, reading or Chinese gloss")
            notes.append({
                "note_id": row[2], "written": written, "reading": reading,
                "reading_inferred": inferred, "level": level.group(1),
                "meaning_zh": plain(row[7]), "pos": plain(row[5]),
                "examples": [
                    {"kind": plain(row[i - 1]) or "例", "ja": plain(row[i]),
                     "zh": plain(row[i + 2])}
                    for i in (12, 18, 24, 30) if row[i]
                ],
            })
    return notes


def csv_file(path, fields, records):
    # Protect users opening review files in spreadsheet applications.
    def cell(value):
        text = str(value if value is not None else "")
        return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text

    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({key: cell(record.get(key)) for key in fields})


def audit(notes_path, db_path, output):
    digest = hashlib.sha256(notes_path.read_bytes()).hexdigest()
    notes = read_notes(notes_path)
    # mode=ro includes any WAL changes while prohibiting DB mutation.
    with closing(sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True)) as conn:
        conn.row_factory = sqlite3.Row
        words = [dict(row) for row in conn.execute(
            "SELECT id, kanji, kana, level, meaning_zh, source, jmdict_id FROM words ORDER BY id"
        )]
        integrity = conn.execute("PRAGMA quick_check").fetchone()[0]
    if integrity != "ok":
        raise ValueError(f"Database integrity check failed: {integrity}")
    local = collections.defaultdict(list)
    upstream = collections.defaultdict(list)
    for word in words:
        local[pair(word["kanji"] or word["kana"], word["kana"])].append(word)
    for note in notes:
        upstream[pair(note["written"], note["reading"])].append(note)

    matched, missing, ambiguous = [], [], []
    level_conflicts = 0
    for note in notes:
        key = pair(note["written"], note["reading"])
        candidates = local.get(key, [])
        record = {**note, "local_ids": " | ".join(w["id"] for w in candidates),
                  "local_levels": " | ".join(w["level"] for w in candidates),
                  "local_meanings": " | ".join(w["meaning_zh"] or "" for w in candidates)}
        if not candidates:
            missing.append(record)
        else:
            matched.append(record)
            level_conflicts += all(w["level"] != note["level"] for w in candidates)
        if len(upstream[key]) > 1 or len(candidates) > 1:
            ambiguous.append(record)

    groups = [group for group in local.values() if len(group) > 1]
    # Extremely conservative hints: retain semantic qualifiers and examples.
    # No removal of parentheses and no fuzzy/reading-only semantic matching.
    exact = [g for g in groups if len({norm(w["meaning_zh"]) for w in g}) == 1
             and norm(g[0]["meaning_zh"])
             and len({w["jmdict_id"] for w in g if w["jmdict_id"]}) <= 1]
    result = {
        "source": SOURCE, "upstream_commit": COMMIT if digest == SHA256 else None,
        "notes_sha256": digest, "license": "CC BY-NC 4.0", "author": "egg rolls",
        "production_database_audited": False, "database_modified": False,
        "local_word_rows": len(words), "local_counts": dict(collections.Counter(w["level"] for w in words)),
        "upstream_notes": len(notes), "upstream_counts": dict(collections.Counter(n["level"] for n in notes)),
        "upstream_distinct_pairs": len(upstream),
        "matched_local_ids": len({w["id"] for key in upstream for w in local.get(key, [])}),
        "matched_local_sources": dict(collections.Counter(
            w["source"] for key in upstream for w in local.get(key, []))),
        "matched_notes": len(matched), "unmatched_notes": len(missing),
        "unmatched_written_reading_pairs": len({pair(n["written"], n["reading"]) for n in missing}),
        "level_disagreements_in_matched_notes": level_conflicts,
        "upstream_multiple_notes_same_pair": sum(len(v) > 1 for v in upstream.values()),
        "local_candidate_duplicate_groups": len(groups),
        "local_candidate_extra_rows": sum(len(g) - 1 for g in groups),
        "local_identical_gloss_groups": len(exact),
        "local_identical_gloss_extra_rows": sum(len(g) - 1 for g in exact),
        "ambiguous_notes_for_review": len(ambiguous),
        "warnings": [
            "Same written form and reading do not establish identical meaning.",
            "Unmatched means no exact written-form/reading pair, not necessarily a new lexeme.",
            "Level conflicts are source disagreements, not verified classification errors.",
            "Review exports are not replacement word books or deletion instructions.",
        ],
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "summary.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8")
    (output / "local-duplicate-candidates.json").write_text(
        json.dumps({"all_candidates": groups, "identical_gloss_candidates": exact}, ensure_ascii=False, indent=2),
        encoding="utf8")
    columns = ("note_id", "written", "reading", "level", "meaning_zh", "local_ids", "local_levels", "local_meanings")
    csv_file(output / "matched.csv", columns, matched)
    csv_file(output / "unmatched-review.csv", columns, missing)
    csv_file(output / "ambiguous-review.csv", columns, ambiguous)
    counts = result["upstream_counts"]
    rows = "\n".join(f"| {level} | {result['local_counts'].get(level, 0):,} | {counts.get(level, 0):,} |" for level in LEVELS)
    coverage = ("本次未匹配为零：现有库已覆盖这份数据的书写形式与读音组合，但不代表覆盖了其所有义项。"
                if not missing else "存在未精确匹配的记录，需逐条核对变体写法与义项后再判断是否新增。")
    report = f"""# 语屿与 egg rolls 词库比对

比对对象：本地种子库与 [{SOURCE}]({SOURCE}) 的文本笔记。未审计线上用户库，未修改数据库。
上游固定版本：`{result['upstream_commit'] or '未验证版本，见文件 SHA256'}`。

| 等级 | 当前语屿记录数 | Anki 笔记数 |
| --- | ---: | ---: |
{rows}
| 合计 | {len(words):,} | {len(notes):,} |

按规范化书写形式和读音比对，{len(matched):,} 条笔记在本地找到对应，{len(missing):,} 条没有精确对应。
未精确匹配的记录只可作为待核对清单，可能包含异体字、不同写法与不同义项，不能直接认定为缺词。
{coverage}
其中 {level_conflicts:,} 条已匹配笔记的等级与本地候选均不同；分级差异不等于本地分级错误。

本地有 {len(groups)} 组相同书写与读音候选，涉及 {sum(len(g)-1 for g in groups)} 条额外记录。
其中 {len(exact)} 组连完整中文释义也相同，适合优先核对合并；其余必须检查义项。
Anki 自身有 {result['upstream_multiple_notes_same_pair']} 组相同书写与读音的多笔记，全部保留。
例如「ロック」可能是锁或摇滚，「ホーム」可能是站台或家，不能仅按读音合并。

## 输出文件

- `matched.csv`：已有对应的笔记及本地 ID、等级、释义。
- `unmatched-review.csv`：排除精确匹配后留下的候选，供核对新增。
- `ambiguous-review.csv`：同形同音多记录的笔记，供核对义项。
- `local-duplicate-candidates.json`：本地重复候选及完整释义相同的优先核对组。
- `summary.json`：计数、版本、校验值与比对限制。

## 使用条件与判断

文本作者：egg rolls。原项目采用 [CC BY-NC 4.0]({SOURCE}/blob/{COMMIT}/LICENSE)，
个人自用或免费非商业用途可以按该协议使用，须保留署名、许可和修改说明。
这些比对 CSV 已移除 HTML 标记、规范化匹配字段，未下载音频或 Anki 模板。
本地词条的释义仍来自现有语屿数据，并非全部由 egg rolls 提供。
上游声明包含中文释义、例句或关联词，但分级与排序仅供参考，不代表逐词校对正确或官方完整词表。

本次是比对与去重候选输出，没有删除词条、替换释义、修改分级或导入生产数据。
建议把它作为中文内容候选来源，先处理义项和级别差异，再迁移学习数据。
不可把“同形同音”清单直接用于删除词条，否则可能丢失不同义项或学习记录。
"""
    (output / "report.md").write_text(report, encoding="utf8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes", type=Path, required=True)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(audit(args.notes, args.db, args.out), ensure_ascii=True, indent=2))
