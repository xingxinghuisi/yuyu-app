"""Real PDF rendering, integrity failures and historical attempt preservation."""
import importlib.util
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('exam_installer', ROOT / 'scripts/install-exam-library.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        import pypdfium2 as pdfium
        # Keep fixture paths below Windows MAX_PATH even with full SHA audio names.
        temporary_root = ROOT.parent / '.tmp'
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=temporary_root)
        self.base = Path(self.temporary.name)
        self.source = self.base / 'source'
        self.source.mkdir()
        self.pdf = self.source / 'paper.pdf'
        doc = pdfium.PdfDocument.new()
        page = doc.new_page(120, 160)
        page.close()
        doc.save(str(self.pdf))
        doc.close()
        audio = self.source / 'audio.mp3'
        audio.write_bytes(b'\xff\xfb\x90\x00' + bytes(413))
        pdf_hash, audio_hash = installer.digest(self.pdf), installer.digest(audio)
        self.asset = 'paper/0123456789abcdef-p0001.webp'
        self.pack = {'schema_version': 2, 'id': 'test-exam', 'title': 'Fixture', 'level': 'N2',
                     'sections': [{'id': 'language', 'minutes': 105, 'question_count': 2}], 'materials': [],
                     'audio_file': 'audio-' + audio_hash + '.mp3', 'review_count': 1,
                     'questions': [dict(id='w1', section_id='language', option_count=4, correct=2,
                                        grading_status='reference', assets=[self.asset], explanation_assets=[],
                                        material_ids=[], transcript_material_ids=[]),
                                   dict(id='w2', section_id='language', option_count=4, correct=None,
                                        grading_status='withheld', assets=[self.asset], explanation_assets=[],
                                        material_ids=[], transcript_material_ids=[])]}
        self.media = {'id': 'test-exam', 'images': {self.asset: {'source': 'paper.pdf',
                     'source_sha256': pdf_hash, 'page': 1}}, 'audio': {'source': 'audio.mp3',
                     'source_sha256': audio_hash, 'bytes': audio.stat().st_size}}
        self.bundle = self.base / 'bundle'
        self.bundle.mkdir()
        self.write_bundle()
        self.root, self.cache = self.base / 'data/private-exams', self.base / 'cache'

    def tearDown(self):
        self.temporary.cleanup()

    def write_bundle(self):
        (self.bundle / 'packs').mkdir(exist_ok=True)
        pack_path = self.bundle / 'packs/test-exam.json'
        pack_path.write_text(json.dumps(self.pack), encoding='utf8')
        media_path = self.bundle / 'media-plan.json'
        media_path.write_text(json.dumps({'version': 1, 'exams': [self.media]}), encoding='utf8')
        manifest = {'schema_version': 2, 'exams': [{'id': 'test-exam', 'questions': 2, 'excluded': 1, 'images': 1}],
                    'files': {'packs/test-exam.json': installer.digest(pack_path)},
                    'media_plan_sha256': installer.digest(media_path)}
        (self.bundle / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')

    def inputs(self):
        _, packs, media = installer.read_bundle(self.bundle)
        installer.preflight_sources(self.source, media, 2.0)
        return packs, media

    def test_real_render_install_and_idempotence(self):
        from PIL import Image
        packs, media = self.inputs()
        result = installer.install(self.root, self.cache, self.source, packs, media, 'owner', 2.0, 1)
        self.assertEqual(result['published'], 1)
        with Image.open(self.root / 'test-exam/assets' / self.asset) as image:
            self.assertEqual(image.format, 'WEBP')
            self.assertEqual(image.size, (240, 320))
        revision_before = (self.root / 'test-exam/exam.json').read_bytes()
        again = installer.install(self.root, self.cache, self.source, packs, media, None, 2.0, 1)
        self.assertEqual(again['published'], 0)
        self.assertIsNone(again['backup'])
        self.assertEqual((self.root / 'test-exam/exam.json').read_bytes(), revision_before)

    def test_legacy_attempt_is_backed_up_and_pinned_before_replacement(self):
        self.root.mkdir(parents=True)
        (self.root / 'test-exam').mkdir()
        old = dict(self.pack, title='Original version')
        (self.root / 'test-exam/exam.json').write_text(json.dumps(old), encoding='utf8')
        (self.root / 'access.json').write_text('{"owner_username":"owner"}', encoding='utf8')
        database = self.root / 'attempts.sqlite3'
        with closing(sqlite3.connect(database)) as conn:
            conn.execute('CREATE TABLE attempts(id TEXT PRIMARY KEY,exam_id TEXT,answers TEXT)')
            conn.execute('INSERT INTO attempts VALUES(?,?,?)', ('old-attempt', 'test-exam', '{"w1":2}'))
            conn.commit()
        packs, media = self.inputs()
        result = installer.install(self.root, self.cache, self.source, packs, media, None, 2.0, 1)
        self.assertEqual(result['legacy_exams_pinned'], 1)
        with closing(sqlite3.connect(database)) as conn:
            row = conn.execute('SELECT pack_revision,answers FROM attempts').fetchone()
            self.assertEqual(row, (installer.revision(old), '{"w1":2}'))
            stored = json.loads(conn.execute('SELECT pack_json FROM exam_versions WHERE revision=?', (row[0],)).fetchone()[0])
            self.assertEqual(stored['title'], 'Original version')
        with closing(sqlite3.connect(result['backup'])) as conn:
            self.assertEqual(conn.execute('SELECT answers FROM attempts').fetchone()[0], '{"w1":2}')
            self.assertNotIn('pack_revision', {r[1] for r in conn.execute('PRAGMA table_info(attempts)')})

    def test_hash_and_path_failure_do_not_create_live_library(self):
        _, _, media = installer.read_bundle(self.bundle)
        self.pdf.write_bytes(self.pdf.read_bytes() + b'changed')
        with self.assertRaisesRegex(installer.InstallError, 'SHA256 mismatch'):
            installer.preflight_sources(self.source, media, 2.0)
        self.assertFalse(self.root.exists())
        self.media['audio']['source'] = '../escape.mp3'
        self.write_bundle()
        with self.assertRaisesRegex(installer.InstallError, 'Unsafe relative path'):
            installer.read_bundle(self.bundle)

    def test_build_only_contains_no_owner_or_database(self):
        packs, media = self.inputs()
        ready = self.base / 'ready'
        result = installer.build_only(ready, self.cache, self.source, packs, media, 2.0, 1)
        self.assertEqual(result['built'], 1)
        self.assertTrue((ready / 'test-exam/exam.json').is_file())
        self.assertFalse((ready / 'access.json').exists())
        self.assertFalse((ready / 'attempts.sqlite3').exists())
        self.assertEqual(installer.build_only(ready, self.cache, self.source, packs, media, 2.0, 1)['built'], 0)
        prepared = installer.read_ready(ready, packs, media)
        result = installer.install(self.root, self.base / 'publish-cache', None, packs, media, 'owner', 2.0, 1, prepared)
        self.assertEqual(result['published'], 1)
        self.assertEqual(installer.load(self.root / 'test-exam/exam.json'), self.pack)

    def test_owner_mismatch_preserves_existing_files(self):
        self.root.mkdir(parents=True)
        (self.root / 'access.json').write_text('{"owner_username":"owner"}', encoding='utf8')
        packs, media = self.inputs()
        with self.assertRaisesRegex(installer.InstallError, 'different owner'):
            installer.install(self.root, self.cache, self.source, packs, media, 'other', 2.0, 1)
        self.assertFalse(self.cache.exists())
        self.assertFalse((self.root / 'attempts.sqlite3').exists())


if __name__ == '__main__':
    unittest.main()
