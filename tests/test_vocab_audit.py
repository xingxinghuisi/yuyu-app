"""Comparison regressions: Anki etymology, homographs and immutable input DB."""

import csv
import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "audit_anki_vocab", Path(__file__).resolve().parents[1] / "tools/audit_anki_vocab.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)


class VocabAuditTests(unittest.TestCase):
    def test_ruby_and_active_html_are_not_word_text(self):
        self.assertEqual(audit.plain('<ruby>島<rt>しま</rt></ruby><script>bad()</script>'), '島')
        self.assertEqual(audit.plain('家<br>家庭 &amp; 生活'), '家\n家庭 & 生活')

    def test_uses_japanese_reading_not_foreign_etymology_and_keeps_senses(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            notes = root / 'notes.csv'
            with notes.open('w', encoding='utf8', newline='') as handle:
                handle.write('#separator:Tab\n#html:true\n')
                writer = csv.writer(handle, delimiter='\t')
                for uid, word, reading, gloss, level in (
                    ('a', 'ロック', 'lock', '锁', 'N5'),
                    ('b', 'ロック', 'rock', '摇滚', 'N3'),
                    ('c', '猫', 'ねこ', '猫', 'N5'),
                    ('d', '犬', 'いぬ', '狗', 'N5'),
                ):
                    row = [''] * 39
                    row[0:4] = ['model', f'eggrolls::1-{level}', uid, word]
                    row[6:8] = [reading, gloss]
                    writer.writerow(row)
            db = root / 'words.db'
            with sqlite3.connect(db) as conn:
                conn.execute('CREATE TABLE words (id TEXT, kanji TEXT, kana TEXT, level TEXT, meaning_zh TEXT, source TEXT, jmdict_id TEXT)')
                conn.executemany('INSERT INTO words VALUES (?,?,?,?,?,?,?)', [
                    ('lock', None, 'ロック', 'N5', '锁', 'test', None),
                    ('rock', 'ロック', 'ロック', 'N3', '摇滚', 'test', None),
                    ('cat', '猫', 'ネコ', 'N4', '猫', 'test', None),
                ])
            conn.close()
            before = db.read_bytes()
            result = audit.audit(notes, db, root / 'out')
            self.assertEqual(result['matched_notes'], 3)
            self.assertEqual(result['unmatched_notes'], 1)
            self.assertEqual(result['upstream_multiple_notes_same_pair'], 1)
            self.assertEqual(result['local_identical_gloss_groups'], 0)
            self.assertEqual(result['level_disagreements_in_matched_notes'], 1)
            self.assertEqual(db.read_bytes(), before)
            self.assertIsNone(result['upstream_commit'])


if __name__ == '__main__':
    unittest.main()
