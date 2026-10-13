"""Account preferences, real study plans, and upgrades of existing user data."""
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('JWT_SECRET', 'study-settings-tests-never-used-in-production')
from fastapi.testclient import TestClient
from app.main import app
from app import seed_db


class StudySettingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.environment = patch.dict(os.environ, {'DATA_DIR': cls.temp.name})
        cls.environment.start()
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.headers = []
        for username in ('settings_a', 'settings_b'):
            body = {'username': username, 'password': 'TestSettings2026'}
            assert cls.client.post('/api/auth/register', json=body).status_code == 201
            token = cls.client.post('/api/auth/login', json=body).json()['token']
            cls.headers.append({'Authorization': 'Bearer ' + token})

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.environment.stop()
        cls.temp.cleanup()

    def save(self, **values):
        return self.client.put('/api/auth/profile', json=values, headers=self.headers[0])

    def setUp(self):
        self.save(daily_goal=30, study_batch_size=30)
        user_id = self.client.get('/api/auth/me', headers=self.headers[0]).json()['id']
        with closing(sqlite3.connect(Path(self.temp.name) / 'app.db')) as db:
            db.execute('DELETE FROM user_words WHERE user_id=?', (user_id,))
            db.commit()

    def test_batch_size_applies_to_all_plan_entries_and_is_independent_of_goal(self):
        response = self.save(daily_goal=83, study_batch_size=47)
        self.assertEqual(response.status_code, 200)
        for body in (None, {'level': 'N5'}, {'level': 'N5', 'order': 'shuffle'},
                     {'book_id': 'level-n5'}, {'book_id': 'level-n5', 'order': 'shuffle'}):
            with self.subTest(body=body):
                plan = self.client.post('/api/study/plan', json=body, headers=self.headers[0]).json()
                self.assertEqual(len(plan['words']), 47)
                self.assertEqual(plan['study_batch_size'], 47)
                self.assertEqual(plan['daily_goal'], 83)
        self.save(daily_goal=16)
        me = self.client.get('/api/auth/me', headers=self.headers[0]).json()
        self.assertEqual((me['daily_goal'], me['study_batch_size']), (16, 47))
        other = self.client.get('/api/auth/me', headers=self.headers[1]).json()
        self.assertEqual((other['daily_goal'], other['study_batch_size']), (30, 30))
        plan = self.client.post('/api/study/plan', headers=self.headers[1]).json()
        self.assertEqual(len(plan['words']), 30)

    def test_invalid_values_cannot_overwrite_saved_preferences(self):
        self.save(daily_goal=83, study_batch_size=47)
        for value in (0, -1, 201, 1.5, '50', '', True):
            with self.subTest(batch_size=value):
                response = self.save(study_batch_size=value, daily_goal=50)
                self.assertEqual(response.status_code, 422)
        for value in (0, 201, 1.5, ''):
            with self.subTest(daily_goal=value):
                response = self.save(daily_goal=value, study_batch_size=10)
                self.assertIn(response.status_code, (400, 422))
        me = self.client.get('/api/auth/me', headers=self.headers[0]).json()
        self.assertEqual((me['daily_goal'], me['study_batch_size']), (83, 47))
        self.assertEqual(self.client.put('/api/auth/profile', json={'study_batch_size': 50}).status_code, 401)

    def test_boundaries_and_a_book_with_fewer_remaining_words(self):
        for size in (1, 200):
            self.assertEqual(self.save(study_batch_size=size).status_code, 200)
            plan = self.client.post('/api/study/plan', json={'book_id': 'level-n5'}, headers=self.headers[0]).json()
            self.assertEqual(len(plan['words']), size)
        with closing(sqlite3.connect(Path(self.temp.name) / 'app.db')) as db:
            user_id = self.client.get('/api/auth/me', headers=self.headers[0]).json()['id']
            ids = [row[0] for row in db.execute("SELECT word_id FROM book_words WHERE book_id='level-n5' ORDER BY sort_order")]
            db.executemany('INSERT INTO user_words (user_id,word_id) VALUES (?,?)',
                           [(user_id, word_id) for word_id in ids[:-3]])
            db.commit()
        plan = self.client.post('/api/study/plan', json={'book_id': 'level-n5'}, headers=self.headers[0]).json()
        self.assertEqual([word['id'] for word in plan['words']], ids[-3:])


class ExistingDatabaseTests(unittest.TestCase):
    def test_upgrade_preserves_daily_goal_progress_and_custom_batch_on_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'app.db'
            shutil.copy2(seed_db.find_seed_db(), path)
            with closing(sqlite3.connect(path)) as db:
                db.executescript(seed_db.APP_TABLES.replace('  study_batch_size INTEGER DEFAULT 30,\n', ''))
                db.execute("INSERT INTO users (id,username,password_hash,daily_goal,created_at) VALUES (1,'existing','unused',77,'2026-01-01')")
                word = db.execute('SELECT id FROM words LIMIT 1').fetchone()[0]
                db.execute('INSERT INTO user_words (user_id,word_id,repetitions) VALUES (1,?,3)', (word,))
                db.commit()
            seed_db.init_db(directory)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('SELECT daily_goal,study_batch_size FROM users WHERE id=1').fetchone(), (77, 30))
                self.assertEqual(db.execute('SELECT word_id,repetitions FROM user_words WHERE user_id=1').fetchone(), (word, 3))
                db.execute('UPDATE users SET study_batch_size=65 WHERE id=1')
                db.commit()
            seed_db.init_db(directory)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('SELECT daily_goal,study_batch_size FROM users WHERE id=1').fetchone(), (77, 65))


if __name__ == '__main__':
    unittest.main()
