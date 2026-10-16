"""Private access, server grading, resumability, strict choices, and real deadlines."""
import json
import os
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
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
        self.pack_file = private_exams.root_dir() / 'fixture/exam.json'
        self.original_pack = self.pack_file.read_text()

    def tearDown(self):
        self.pack_file.write_text(self.original_pack)

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

    def test_unresolved_questions_never_count_as_correct_or_enter_denominator(self):
        pack = json.loads(self.pack_file.read_text())
        pack['questions'][1].update(correct=None, grading_status='withheld',
            explanation_fragments=[{'text': 'private explanation answer: 3'}],
            answer_sources=[{'choice': 3}], transcript_material_ids=['dialogue'])
        pack['materials'] = [{'id': 'dialogue', 'section': 'listening', 'kind': 'listening_transcript',
                              'fragments': [{'text': 'private transcript'}]}]
        self.pack_file.write_text(json.dumps(pack))
        public = self.client.get('/api/private-exams/fixture', headers=self.headers[0]).json()
        self.assertNotIn('private explanation', json.dumps(public))
        self.assertNotIn('private transcript', json.dumps(public))
        self.assertNotIn('answer_sources', public['questions'][1])
        attempt = self.start()
        url = '/api/private-exams/attempts/' + attempt['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}})
        result = self.client.post(url + '/submit', headers=self.headers[0]).json()
        self.assertEqual(result['score']['correct'], 1)
        self.assertEqual(result['score']['total'], 1)
        self.assertEqual(result['score']['excluded'], 1)
        self.assertEqual(result['score']['accuracy'], 100.0)
        self.assertIsNone(result['review'][1]['is_correct'])
        self.assertFalse(result['review'][1]['is_graded'])
        self.assertEqual(result['review'][1]['transcript_fragments'][0]['text'], 'private transcript')
        pack['questions'][0].update(correct=None, grading_status='withheld')
        self.pack_file.write_text(json.dumps(pack))
        empty = self.start()
        result = self.client.post('/api/private-exams/attempts/' + empty['id'] + '/submit', headers=self.headers[0]).json()
        self.assertEqual(result['score']['total'], 0)
        self.assertEqual(result['score']['correct'], 0)
        self.assertIsNone(result['score']['accuracy'])

    def test_exam_revision_locks_questions_answers_and_old_results(self):
        first = self.start()
        url = '/api/private-exams/attempts/' + first['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}, 'cursor': 'q2'})
        pack = json.loads(self.pack_file.read_text())
        pack['title'] = 'Revised exam'
        pack['questions'][0]['correct'] = 4
        pack['questions'][1]['id'] = 'new-question'
        self.pack_file.write_text(json.dumps(pack))
        resumed = self.start(restart=False)
        self.assertEqual(resumed['id'], first['id'])
        locked = self.client.get('/api/private-exams/fixture?attempt=' + first['id'], headers=self.headers[0]).json()
        self.assertEqual(locked['title'], 'Fixture')
        self.assertEqual(locked['questions'][1]['id'], 'q2')
        self.assertEqual(self.client.put(url, headers=self.headers[0], json={'answers': {'q2': 3}}).status_code, 200)
        result = self.client.post(url + '/submit', headers=self.headers[0]).json()
        self.assertEqual(result['score']['correct'], 2)
        new = self.start()
        self.assertNotEqual(new['pack_revision'], first['pack_revision'])
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['score']['correct'], 2)
        self.assertEqual(self.client.get('/api/private-exams/fixture?attempt=' + new['id'], headers=self.headers[0]).json()['title'], 'Revised exam')

    def test_simultaneous_default_starts_resume_a_single_attempt(self):
        def start_once(_):
            return self.start('timed', restart=False)
        with ThreadPoolExecutor(max_workers=8) as executor:
            attempts = list(executor.map(start_once, range(8)))
        self.assertEqual(len({attempt['id'] for attempt in attempts}), 1)
        self.assertEqual(sum(not attempt['resumed'] for attempt in attempts), 1)
        self.assertEqual(len({attempt['deadline_at'] for attempt in attempts}), 1)
        with private_exams.database() as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM attempts').fetchone()[0], 1)

    def test_revision_pins_audio_and_missing_snapshots_fail_closed(self):
        folder = self.pack_file.parent
        old_name, new_name = 'audio-' + '1' * 64 + '.mp3', 'audio-' + '2' * 64 + '.mp3'
        (folder / 'source' / old_name).write_bytes(b'old-audio')
        (folder / 'source' / new_name).write_bytes(b'new-audio')
        pack = json.loads(self.pack_file.read_text())
        pack['audio_file'] = old_name
        self.pack_file.write_text(json.dumps(pack))
        first = self.start()
        pack['audio_file'] = new_name
        self.pack_file.write_text(json.dumps(pack))
        media = '/api/private-exams/fixture/audio'
        self.assertEqual(self.client.get(media + '?attempt=' + first['id'], headers=self.headers[0]).content, b'old-audio')
        self.assertEqual(self.client.get(media, headers=self.headers[0]).content, b'new-audio')
        with private_exams.database() as conn:
            conn.execute('DELETE FROM exam_versions WHERE revision=?', (first['pack_revision'],))
        self.assertEqual(self.client.get('/api/private-exams/attempts/' + first['id'], headers=self.headers[0]).status_code, 409)
        self.assertEqual(self.client.get(media + '?attempt=' + first['id'], headers=self.headers[0]).status_code, 409)

    def test_legacy_attempt_is_pinned_on_first_read_and_keeps_its_grade(self):
        first = self.start()
        url = '/api/private-exams/attempts/' + first['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}})
        self.client.post(url + '/submit', headers=self.headers[0])
        with private_exams.database() as conn:
            conn.execute('UPDATE attempts SET pack_revision=NULL WHERE id=?', (first['id'],))
        restored = self.client.get(url, headers=self.headers[0]).json()
        self.assertEqual(restored['pack_revision'], first['pack_revision'])
        with private_exams.database() as conn:
            self.assertEqual(conn.execute('SELECT pack_revision FROM attempts WHERE id=?', (first['id'],)).fetchone()[0], first['pack_revision'])
        pack = json.loads(self.pack_file.read_text())
        pack['questions'][0]['correct'] = 4
        self.pack_file.write_text(json.dumps(pack))
        self.assertEqual(self.client.get(url, headers=self.headers[0]).json()['score']['correct'], 1)

    def test_public_question_uses_allowlist_and_attempt_ids_require_the_owner(self):
        pack = json.loads(self.pack_file.read_text())
        pack['questions'][0].update(answer_text='secret answer', rationale='secret rationale',
            explanation_fragments=[{'text': 'secret explanation'}],
            answer_sources=[{'choice': 2}], transcript_fragments=[{'text': 'secret transcript'}],
            diagnostic={'correct': 2})
        pack['materials'] = [{'id': 'reading', 'kind': 'passage', 'section': 'language',
                              'fragments': [{'text': 'visible passage'}],
                              'source_notes': [{'message': 'secret editorial note'}], 'correct': 2}]
        pack['questions'][0]['material_ids'] = ['reading']
        self.pack_file.write_text(json.dumps(pack))
        public = self.client.get('/api/private-exams/fixture', headers=self.headers[0]).json()
        self.assertNotIn('secret', json.dumps(public))
        self.assertNotIn('diagnostic', public['questions'][0])
        self.assertEqual(public['materials'][0]['fragments'][0]['text'], 'visible passage')
        first = self.start()
        submitted = self.client.post('/api/private-exams/attempts/' + first['id'] + '/submit',
                                     headers=self.headers[0], json={}).json()
        self.assertEqual(submitted['review'][0]['source_notes'][0]['message'], 'secret editorial note')
        with private_exams.database() as conn:
            conn.execute('UPDATE attempts SET user_id=999 WHERE id=?', (first['id'],))
        for path in ('/api/private-exams/attempts/' + first['id'],
                     '/api/private-exams/fixture?attempt=' + first['id'],
                     '/api/private-exams/fixture/audio?attempt=' + first['id']):
            self.assertEqual(self.client.get(path, headers=self.headers[0]).status_code, 404)

    def test_old_scan_progress_exposes_text_update_without_changing_answers_or_revision(self):
        first = self.start()
        url = '/api/private-exams/attempts/' + first['id']
        self.client.put(url, headers=self.headers[0], json={'answers': {'q1': 2}, 'cursor': 'q2'})
        current = json.loads(self.pack_file.read_text())
        current['questions'][0]['stem_fragments'] = [{'text': 'Current structured question'}]
        self.pack_file.write_text(json.dumps(current))
        public = self.client.get('/api/private-exams/fixture?attempt=' + first['id'], headers=self.headers[0]).json()
        self.assertEqual(public['content_format'], 'scan')
        self.assertTrue(public['text_update_available'])
        self.assertNotIn('Current structured question', json.dumps(public))
        old = self.client.get(url, headers=self.headers[0]).json()
        self.assertEqual(old['answers'], {'q1': 2})
        self.assertEqual(old['cursor'], 'q2')
        self.assertEqual(old['pack_revision'], first['pack_revision'])
        latest = self.client.get('/api/private-exams/fixture', headers=self.headers[0]).json()
        self.assertEqual(latest['content_format'], 'text')

    def test_public_worker_and_fresh_shell_do_not_require_a_login(self):
        worker = self.client.get('/api/app-shell/worker')
        self.assertEqual(worker.status_code, 200)
        self.assertIn('no-store', worker.headers['cache-control'])
        self.assertEqual(worker.headers['service-worker-allowed'], '/')
        self.assertIn('yuyu-v33-exam-catalog', worker.text)
        shell = self.client.get('/app-update?v=1.5.1')
        self.assertEqual(shell.status_code, 200)
        self.assertIn('exams.js?v=1.5.1', shell.text)


if __name__ == '__main__':
    unittest.main()
