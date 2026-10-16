"""Mixed source PDFs must never expose keys or transcripts as question images."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_exams', ROOT / 'scripts/prepare-exam-library.py')
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.pid = '0123456789abcdef-p0001'
        self.fragment = {'page_id': self.pid, 'text': 'Original', 'annotations': [], 'table_rows': []}
        self.exam = {'pages': [{'page_id': self.pid, 'roles': ['paper_candidate'], 'source': 'paper.pdf',
                              'source_sha256': 'a' * 64, 'page': 1}],
                     'audio': [{'source': 'audio.mp3', 'source_sha256': 'b' * 64, 'bytes': 100}]}
        self.staged = {'id': 'jlpt-n2-2025-12', 'title': 'Fixture', 'level': 'N2', 'year': 2025, 'month': 12,
                       'questions': [{'id': 'w1', 'section': 'language', 'group': 1, 'answer': 2,
                                      'stem_fragments': [deepcopy(self.fragment)],
                                      'options': [{'index': i, 'fragments': [deepcopy(self.fragment)]} for i in range(1, 5)],
                                      'material_ids': [], 'transcript_material_ids': [],
                                      'explanation_fragments': [], 'answer_sources': []}], 'materials': [], 'issues': []}

    def test_mixed_page_is_private_even_when_answer_entries_are_empty(self):
        for kind in ('answer_key', 'explanation', 'transcript'):
            with self.subTest(kind=kind):
                pack, media = converter.adapt(self.staged, self.exam,
                    {self.pid: {'blocks': [{'kind': kind, 'answer_entries': []}]}})
                q = pack['questions'][0]
                self.assertEqual(q['assets'], [])
                self.assertEqual(q['stem_fragments'], [])
                self.assertEqual(q['grading_status'], 'withheld')
                self.assertIsNone(q['correct'])
                self.assertEqual(media['images'], {})

    def test_missing_original_choice_is_not_silently_scored(self):
        self.staged['questions'][0]['options'].pop()
        pack, _ = converter.adapt(self.staged, self.exam, {self.pid: {'blocks': []}})
        self.assertIsNone(pack['questions'][0]['correct'])
        self.assertEqual(pack['review_count'], 1)

    def test_unrelated_issue_does_not_remove_a_valid_answer(self):
        self.staged['issues'] = [{'kind': 'missing_printed_answer', 'question_id': 'w2'}]
        pack, _ = converter.adapt(self.staged, self.exam, {self.pid: {'blocks': []}})
        self.assertEqual(pack['questions'][0]['correct'], 2)
        self.assertEqual(pack['questions'][0]['grading_status'], 'reference')

    def test_reading_cannot_embed_a_transcript_source(self):
        self.staged['materials'] = [{'id': 'passage', 'kind': 'passage', 'section': 'language', 'fragments': [self.fragment]}]
        self.staged['questions'][0]['material_ids'] = ['passage']
        with self.assertRaisesRegex(AssertionError, 'private source'):
            converter.adapt(self.staged, self.exam, {self.pid: {'blocks': [{'kind': 'transcript'}]}})


if __name__ == '__main__':
    unittest.main()
