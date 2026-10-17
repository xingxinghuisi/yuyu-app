"""Instant checks are private, read-only and do not consume final submissions."""
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend'))
from fastapi.testclient import TestClient
from app import main


class QuizFeedbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        cls.environment=patch.dict(os.environ,{'DATA_DIR':cls.temp.name,'JWT_SECRET':'quiz-feedback-tests-not-production'})
        cls.environment.start()
        cls.client=TestClient(main.app);cls.client.__enter__()
        cls.headers=[]
        for username in ('feedback_a','feedback_b'):
            body={'username':username,'password':'FeedbackTests2026'}
            assert cls.client.post('/api/auth/register',json=body).status_code==201
            token=cls.client.post('/api/auth/login',json=body).json()['token']
            cls.headers.append({'Authorization':'Bearer '+token})
        cls.word_ids=[w['id'] for w in cls.client.post('/api/study/plan',headers=cls.headers[0]).json()['words'][:5]]

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None);cls.environment.stop();cls.temp.cleanup()

    def start(self,instant=True):
        response=self.client.post('/api/quiz/start',headers=self.headers[0],json={
            'word_ids':self.word_ids,'count':3,'instant_feedback':instant})
        self.assertEqual(response.status_code,200)
        return response.json()['questions']

    def check(self,qid,answer,headers=None):
        return self.client.post('/api/quiz/check',headers=headers or self.headers[0],json={'qid':qid,'answer':answer})

    def test_checks_are_read_only_and_final_submission_still_scores_first_choices_once(self):
        questions=self.start()
        with closing(sqlite3.connect(Path(self.temp.name)/'app.db')) as conn:
            before=conn.execute('SELECT * FROM user_words ORDER BY user_id,word_id').fetchall()
        answers=[]
        for index,q in enumerate(questions):
            entry=next(v for (uid,qid),v in main.QUIZ_STORE.items() if qid==q['qid'])
            expected=str(entry['expected'])
            chosen=next(o for o in q['options'] if o!=expected) if index==0 else expected
            for _ in range(2):
                checked=self.check(q['qid'],chosen)
                self.assertEqual(checked.status_code,200)
                self.assertEqual(checked.json(),{'qid':q['qid'],'correct':index!=0,'expected':expected})
            self.assertTrue(any(qid==q['qid'] for uid,qid in main.QUIZ_STORE))
            answers.append({'qid':q['qid'],'answer':chosen})
            self.assertNotIn('expected',q)
        with closing(sqlite3.connect(Path(self.temp.name)/'app.db')) as conn:
            self.assertEqual(before,conn.execute('SELECT * FROM user_words ORDER BY user_id,word_id').fetchall())
        result=self.client.post('/api/quiz/submit',headers=self.headers[0],json={'qid_answers':answers}).json()
        self.assertEqual((result['score'],result['total']),(2,3))
        self.assertEqual(len(result['wrong']),1)
        self.assertEqual(self.check(questions[0]['qid'],answers[0]['answer']).status_code,404)

    def test_check_requires_owner_and_is_disabled_for_regular_quizzes(self):
        q=self.start()[0]
        payload={'qid':q['qid'],'answer':str(q['options'][0])}
        self.assertEqual(self.client.post('/api/quiz/check',json=payload).status_code,401)
        self.assertEqual(self.client.post('/api/quiz/check',headers=self.headers[1],json=payload).status_code,404)
        regular=self.start(False)[0]
        self.assertEqual(self.check(regular['qid'],str(regular['options'][0])).status_code,403)

    def test_instant_mode_requires_an_explicit_learning_batch(self):
        for payload in ({'instant_feedback':True},{'word_ids':self.word_ids,'instant_feedback':True,'mode':'exam_freq'}):
            self.assertEqual(self.client.post('/api/quiz/start',headers=self.headers[0],json=payload).status_code,400)
        self.assertEqual(self.client.post('/api/quiz/start',headers=self.headers[0],json={
            'word_ids':self.word_ids,'instant_feedback':'true'}).status_code,422)


if __name__=='__main__':unittest.main()
