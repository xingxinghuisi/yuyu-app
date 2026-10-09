import hashlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app import seed_db, source_audio, vocab_catalog

SEED = Path(os.environ.get('CATALOG_TEST_SEED', ROOT / 'backend/data/seed/yuyu-vocab.db'))


class CatalogMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.db = self.directory / 'app.db'
        with closing(sqlite3.connect(SEED.resolve().as_uri() + '?mode=ro', uri=True)) as original:
            with closing(sqlite3.connect(self.db)) as db:
                original.backup(db)
        with closing(sqlite3.connect(SEED.resolve().as_uri() + '?mode=ro', uri=True)) as source:
            alias = dict(source.execute('SELECT old_id,word_id FROM word_aliases'))
        targets = {}
        for old, target in alias.items():
            targets.setdefault(target, []).append(old)
        self.target, self.duplicates = next((k, v) for k, v in targets.items() if len(v) > 1)
        self.duplicates = self.duplicates[:2]
        with closing(sqlite3.connect(self.db)) as db:
            template = list(db.execute('SELECT * FROM words WHERE id=?', (self.target,)).fetchone())
            self.retired = 'test-retired-word'
            db.execute('DELETE FROM examples')
            db.execute('DELETE FROM book_words')
            db.execute('DELETE FROM words')
            db.execute('DROP TABLE word_aliases')
            db.execute("DELETE FROM import_meta WHERE key LIKE 'catalog_%'")
            for old in [*self.duplicates, self.retired]:
                record = template[:]
                record[0], record[5], record[14], record[17] = old, '旧释义', 'legacy', 'llm'
                db.execute('INSERT INTO words VALUES (' + ','.join('?' * len(record)) + ')', record)
            db.commit()
            db.executescript(seed_db.APP_TABLES)
            seed_db._migrate_fsrs_columns(db)
            db.execute("INSERT INTO users (id,username,password_hash,created_at) VALUES (1,'migration-test','unused','2026-01-01')")
            for i, word in enumerate([*self.duplicates, self.retired]):
                db.execute('''INSERT INTO user_words
                    (user_id,word_id,interval,repetitions,updated_at,due_at,fsrs_stability,fsrs_difficulty,fsrs_state,fsrs_step,fsrs_last_review)
                    VALUES (1,?,?,?,?,?,?,?,?,?,?)''',
                    (word, i + 7, i + 2, f'2026-10-0{i+1}T10:00:00', f'2026-10-{i+10}T10:00:00', i + 9.5, i + 3.5, 2, 0, f'2026-10-0{i+1}T10:00:00'))
                db.execute('INSERT INTO starred_words VALUES (1,?,?)', (word, f'2026-10-0{i+1}'))
                db.execute('INSERT INTO study_logs (user_id,word_id,grade,created_at) VALUES (1,?,4,?)', (word, f'2026-10-0{i+1}'))
            db.commit()

    def tearDown(self):
        self.temp.cleanup()

    def test_backup_progress_history_aliases_and_idempotence(self):
        with patch.dict(os.environ, {'SEED_DB': str(SEED)}):
            seed_db.init_db(str(self.directory))
            backups = list((self.directory / 'backups').glob('*.db'))
            self.assertEqual(len(backups), 1)
            digest = hashlib.sha256(backups[0].read_bytes()).hexdigest()
            with closing(sqlite3.connect(backups[0])) as backup:
                self.assertEqual(backup.execute('SELECT COUNT(*) FROM user_words').fetchone()[0], 3)
                self.assertEqual(backup.execute('SELECT COUNT(*) FROM words').fetchone()[0], 3)
            with closing(sqlite3.connect(self.db)) as db:
                db.row_factory = sqlite3.Row
                self.assertEqual(db.execute('SELECT COUNT(*) FROM words').fetchone()[0], 10641)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM user_words').fetchone()[0], 1)
                state = db.execute('SELECT * FROM user_words').fetchone()
                self.assertEqual(state['word_id'], self.target)
                self.assertEqual((state['interval'], state['repetitions'], state['fsrs_stability'], state['fsrs_difficulty']), (8, 3, 10.5, 4.5))
                self.assertEqual(state['due_at'], '2026-10-11T10:00:00')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM study_logs').fetchone()[0], 3)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM study_logs WHERE original_word_id IS NOT NULL').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM starred_words').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT created_at FROM starred_words').fetchone()[0], '2026-10-01')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM vocab_user_archive').fetchone()[0], 6)
                self.assertTrue(db.execute('SELECT 1 FROM retired_words WHERE id=?', (self.retired,)).fetchone())
                self.assertEqual(vocab_catalog.resolve_word_id(db, self.duplicates[0]), self.target)
                self.assertFalse(db.execute('PRAGMA foreign_key_check').fetchone())
            seed_db.init_db(str(self.directory))
            self.assertEqual(hashlib.sha256(backups[0].read_bytes()).hexdigest(), digest)
            with closing(sqlite3.connect(self.db)) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM vocab_revision_log').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM user_words').fetchone()[0], 1)

    def test_failure_rolls_back_catalog_and_user_changes(self):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("CREATE TRIGGER injected_failure BEFORE DELETE ON words BEGIN SELECT RAISE(ABORT,'injected'); END")
            db.commit()
            with self.assertRaises(sqlite3.IntegrityError):
                vocab_catalog.migrate(db, SEED)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM words').fetchone()[0], 3)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM user_words').fetchone()[0], 3)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM study_logs').fetchone()[0], 3)
            self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE name='vocab_revision_log'").fetchone())


class SourceAudioTests(unittest.TestCase):
    def test_verified_download_cache_and_invalid_response(self):
        data = b'ID3-example-audio'
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        source = {'filename': 'あい_1.mp3', 'git_blob_sha1': blob, 'commit_sha': source_audio.PINNED_COMMIT}
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(source_audio.urllib.request, 'urlopen', return_value=io.BytesIO(data)) as fetch:
                path = source_audio.get_audio(source, folder)
                self.assertEqual(path.read_bytes(), data)
                source_audio.get_audio(source, folder)
                self.assertEqual(fetch.call_count, 1)
            with self.assertRaises(ValueError):
                source_audio.get_audio(dict(source, filename='../file.mp3'), folder)
        bad_blob = 'a' * 40
        with tempfile.TemporaryDirectory() as folder:
            with patch.object(source_audio.urllib.request, 'urlopen', return_value=io.BytesIO(b'not the pinned file')):
                with self.assertRaises(OSError):
                    source_audio.get_audio(dict(source, git_blob_sha1=bad_blob), folder)
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
