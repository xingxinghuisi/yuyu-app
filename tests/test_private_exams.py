"""Private access, server grading, resumability, strict choices, and real deadlines."""
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from fastapi.testclient import TestClient
from app.main import app
from app import private_exams


class PrivateExamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.environment = patch.dict(os.environ, {'DATA_DIR': cls.temp.name, 'PRIVATE_EXAMS_DIR': str(Path(cls.temp.name) / 'private-exams')})
        cls.environment.start()
        root = private_exams.root_dir()
        folder = root / 'fixture'
        (folder / 'assets' / 'paper').mkdir(parents=True)
        (folder / 'assets' / 'answers').mkdir(parents=True)
        (folder / 'source').mkdir()
        for kind in ('paper', 'answers'):
            (folder / 'assets' / kind / '01.webp').write_bytes(b'fixture-image')
        (folder / 'source' / 'listening.mp3').write_bytes(b'0123456789')
        (root / 'access.json').write_text(json.dumps({'owner_username': 'exam_owner'}))
        (folder / 'exam.json').write_text(json.dumps({'id': 'fixture', 'title': 'Fixture', 'level': 'N2', 'year': 2026, 'month': 7,
            'sections': [{'id': 'language', 'title': 'language', 'minutes': 105, 'question_count': 2}],
            'questions': [{'id': 'q1', 'section_id': 'language', 'correct': 2, 'option_count': 4, 'explanation_pages': [1], 'assets': ['paper/01.webp']},
                          {'id': 'q2', 'section_id': 'language', 'correct': 3, 'option_count': 3, 'explanation_pages': [1], 'assets': []}]}))
        cls.client = TestClient(app)
        cls.client.__enter__()
        cls.headers = []
        for username in ('exam_owner', 'exam_other'):
            body = {'username': username, 'password': 'ExamTesting2026'}
            assert cls.client.post('/api/auth/register', json=body).status_code == 201
            token = cls.client.post('/api/auth/login', json=body).json()['token']
            cls.headers.append({'Authorization': 'Bearer ' + token})

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        cls.environment.stop()
        cls.temp.cleanup()

    def setUp(self):
        self.client.cookies.clear()
        with private_exams.database() as conn:
            conn.execute('DELETE FROM attempts')

    def start(self, mode='practice', restart=True):
        response = self.client.post('/api/private-exams/fixture/attempts', headers=self.headers[0],
                                    json={'section_id': 'language', 'mode': mode, 'restart': restart})
        self.assertIn(response.status_code, (200, 201))
        return response.json()

    def test_only_owner_can_access_packs_media_and_attempts(self):
        base = '/api/private-exams'
        for path in (base, base + '/fixture', base + '/fixture/audio', base + '/fixture/assets/paper/01.webp'):
            self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(self.client.get(path, headers=self.headers[1]).status_code, 403)
        attempt = self.start()
        self.assertEqual(self.client.get(base + '/attempts/' + attempt['id'], headers=self.headers[1]).status_code, 403)
        self.assertEqual(self.client.get(base + '/fixture/assets/answers/01.webp?attempt=' + attempt['id'], headers=self.headers[0]).status_code, 403)
        pack = self.client.get(base + '/fixture', headers=self.headers[0])
        self.assertIn('no-store', pack.headers['cache-control'])
        self.assertNotIn('correct', pack.json()['questions'][0])
        self.assertNotIn('explanation_pages', pack.json()['questions'][0])
        session = self.client.post(base + '/media-session', headers=self.headers[0])
        self.assertIn('HttpOnly', session.headers['set-cookie'])
        self.assertIn('SameSite=strict', session.headers['set-cookie'])
        image = self.client.get(base + '/fixture/assets/paper/01.webp')
        self.assertEqual(image.status_code, 200)
        self.assertIn('no-store', image.headers['cache-control'])
        ranged = self.client.get(base + '/fixture/audio', headers={'Range': 'bytes=0-3'})
        self.assertEqual(ranged.status_code, 206)
        self.assertEqual(ranged.content, b'0123')
        self.client.delete(base + '/media-session')
        self.assertEqual(self.client.get(base + '/fixture/audio').status_code, 401)
        self.assertEqual(self.client.get('/data/private-exams/fixture/exam.json').status_code, 404)

    def test_resume_grading_missing_answers_and_immutable_submission(self):
        attempt = self.start()
        url = '/api/private-exams/attempts/' + attempt['id']
        saved = self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}, 'marked': {'q2': True}, 'cursor': 'q2', 'audio_position': 12.5})
        self.assertEqual(saved.status_code, 200)
        restored = self.client.get(url, headers=self.headers[0]).json()
        self.assertEqual(restored['answers'], {'q1': 2})
        self.assertEqual(restored['cursor'], 'q2')
        self.assertEqual(restored['marked'], {'q2': True})
        self.assertEqual(restored['audio_position'], 12.5)
        self.assertNotIn('review', restored)
        result = self.client.post(url + '/submit', headers=self.headers[0]).json()
        self.assertEqual(result['score'], {'correct': 1, 'total': 2, 'answered': 1, 'accuracy': 50.0})
        self.assertEqual(result['review'][1]['correct'], 3)
        self.assertIsNone(result['review'][1]['selected'])
        altered = self.client.put(url, headers=self.headers[0], json={'answers': {'q2': 3}}).json()
        self.assertEqual(altered['score']['correct'], 1)
        media = '/api/private-exams/fixture/assets/answers/01.webp?attempt=' + attempt['id']
        self.assertEqual(self.client.get(media, headers=self.headers[0]).status_code, 200)

    def test_invalid_choices_are_atomic_and_answers_can_be_cleared(self):
        attempt = self.start()
        url = '/api/private-exams/attempts/' + attempt['id']
        for payload in ({'answers': {'q1': True}}, {'answers': {'q1': 1.5}}, {'answers': {'q1': '2'}},
                        {'answers': {'q1': 2, 'q2': 4}}, {'answers': {'unknown': 1}}, {'cursor': 'unknown'}):
            self.assertEqual(self.client.put(url, headers=self.headers[0], json=payload).status_code, 422)
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['answers'], {})
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}})
        cleared = self.client.put(url, headers=self.headers[0], json={'answers': {'q1': None}}).json()
        self.assertEqual(cleared['answers'], {})

    def test_deadline_cannot_be_reset_by_refresh_or_late_answer(self):
        attempt = self.start('timed')
        self.assertAlmostEqual(attempt['deadline_at'] - attempt['started_at'], 6300, places=1)
        url = '/api/private-exams/attempts/' + attempt['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}})
        with private_exams.database() as conn:
            conn.execute('UPDATE attempts SET deadline_at=? WHERE id=?', (time.time() - 1, attempt['id']))
        late = self.client.put(url, headers=self.headers[0], json={'answers': {'q2': 3}}).json()
        self.assertEqual(late['status'], 'submitted')
        self.assertEqual(late['score']['correct'], 1)
        self.assertEqual(late['answers'], {'q1': 2})
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['status'], 'submitted')

    def test_default_start_resumes_latest_without_resetting_progress_or_clock(self):
        first = self.start('timed')
        url = '/api/private-exams/attempts/' + first['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}, 'cursor': 'q2', 'audio_position': 42})
        # Even a differently named entry mode must not silently replace ongoing work.
        resumed = self.start('practice', restart=False)
        self.assertEqual(resumed['id'], first['id'])
        self.assertTrue(resumed['resumed'])
        self.assertEqual(resumed['mode'], 'timed')
        self.assertEqual(resumed['deadline_at'], first['deadline_at'])
        self.assertEqual(resumed['answers'], {'q1': 2})
        self.assertEqual(resumed['cursor'], 'q2')
        self.assertEqual(resumed['audio_position'], 42)
        replacement = self.start('practice', restart=True)
        self.assertNotEqual(replacement['id'], first['id'])
        self.assertEqual(replacement['answers'], {})
        self.assertIsNone(replacement['deadline_at'])
        # Old direct links remain readable, but the default listing has one row per section.
        history = self.client.get('/api/private-exams/fixture/attempts', headers=self.headers[0]).json()['attempts']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['id'], replacement['id'])
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['answers'], {'q1': 2})

    def test_expired_progress_is_completed_before_starting_a_new_attempt(self):
        first = self.start('timed')
        with private_exams.database() as conn:
            conn.execute('UPDATE attempts SET deadline_at=? WHERE id=?', (time.time() - 1, first['id']))
        fresh = self.start('timed', restart=False)
        self.assertNotEqual(fresh['id'], first['id'])
        self.assertEqual(fresh['status'], 'active')
        old = self.client.get('/api/private-exams/attempts/' + first['id'], headers=self.headers[0]).json()
        self.assertEqual(old['status'], 'submitted')


if __name__ == '__main__':
    unittest.main()
