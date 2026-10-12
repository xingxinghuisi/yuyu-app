import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tarfile
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'backend'), str(ROOT)]
from app import voicevox_audio as pack
from tools import gen_audio_voicevox as generator, install_voicevox_audio as installer


class AudioPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.data = self.folder / 'data'
        self.data.mkdir()
        self.db = self.data / 'app.db'
        with closing(sqlite3.connect(self.db)) as conn:
            conn.executescript('''CREATE TABLE words (id TEXT PRIMARY KEY, kana TEXT);
                CREATE TABLE examples (id INTEGER PRIMARY KEY, sentence_ja TEXT);
                CREATE TABLE word_aliases (old_id TEXT, word_id TEXT);
                CREATE TABLE word_audio_sources (word_id TEXT);''')
            conn.execute('INSERT INTO words VALUES (?,?)', ('word-1', 'がっこう'))
            conn.executemany('INSERT INTO examples (sentence_ja) VALUES (?)', [('学校に行きます。',), ('学校に行きます。',)])
            conn.execute("INSERT INTO word_aliases VALUES ('old-1','word-1')")
            conn.execute("INSERT INTO word_audio_sources VALUES ('word-1')")
            conn.commit()
        self.records = pack.catalog(self.db)
        self.output = self.folder / 'output'
        self.output.mkdir()
        self.manifest = {'schema': 1, 'profile': pack.PROFILE, 'format': pack.FORMAT,
                         'engine_version': 'test', 'catalog_sha256': pack.catalog_hash(self.records), 'files': {}}
        for name, text in self.records.items():
            target = self.output / name
            target.parent.mkdir(exist_ok=True)
            content = b'ID3' + text.encode('utf-8')
            target.write_bytes(content)
            self.manifest['files'][name] = {'text': text, 'size': len(content),
                                           'sha256': hashlib.sha256(content).hexdigest()}
        generator.write_manifest(self.output, self.manifest)
        self.archive = self.folder / 'audio.tar.gz'

    def package(self):
        generator.package_audio(self.output, self.records, self.archive)

    def test_catalog_deduplicates_sentences_and_never_creates_missing_db(self):
        self.assertEqual(len(self.records), 2)
        self.assertIn('words/word-1.mp3', self.records)
        self.assertIn('examples/' + pack.example_key('学校に行きます。') + '.mp3', self.records)
        missing = self.folder / 'missing.db'
        with self.assertRaises(sqlite3.OperationalError):
            pack.catalog(missing)
        self.assertFalse(missing.exists())

    def test_resume_checks_reading_and_checksum(self):
        name = 'words/word-1.mp3'
        entry = self.manifest['files'][name]
        with patch.object(generator, 'synth_one', return_value=b'WAV') as synth, \
                patch.object(generator, 'wav_to_mp3', return_value=b'ID3-new-audio'):
            self.assertEqual(generator.gen_record('unused', name, 'がっこう', self.output, entry)[0], 'skip')
            synth.assert_not_called()
            self.assertEqual(generator.gen_record('unused', name, 'がくこう', self.output, entry)[0], 'ok')
            self.assertEqual(synth.call_args.args[1:], (29, 'がくこう'))
            (self.output / name).write_bytes(b'broken')
            self.assertEqual(generator.gen_record('unused', name, 'がっこう', self.output, entry)[0], 'ok')

    def test_speaker_is_verified_and_failed_generation_exits_nonzero(self):
        with patch.object(generator, 'engine_json', return_value=[{'name': 'other', 'styles': [{'id': 29, 'name': 'ノーマル'}]}]):
            with self.assertRaises(ValueError):
                generator.check_speaker('unused')
        with patch.object(generator, 'check_speaker', return_value='test'), \
                patch.object(generator.shutil, 'which', return_value='ffmpeg'), \
                patch.object(generator, 'synth_one', side_effect=OSError('engine down')) as synth, \
                patch.object(generator.time, 'sleep'):
            code = generator.main(['--db', str(self.db), '--out', str(self.folder / 'failed'), '--workers', '1'])
            self.assertEqual(code, 1)
            self.assertEqual(synth.call_count, 6)  # Three attempts for each word/sentence.

    def test_install_is_verified_atomic_and_keeps_database_unchanged(self):
        before = self.db.read_bytes()
        self.package()
        installer.install(self.archive, self.data)
        word = pack.active_audio(self.data, 'words/word-1.mp3')
        self.assertEqual(word.read_bytes(), (self.output / 'words/word-1.mp3').read_bytes())
        self.assertEqual(self.db.read_bytes(), before)
        pointer = self.data / 'audio/voicevox/active.json'
        active_before = pointer.read_bytes()
        (self.output / 'words/word-1.mp3').write_bytes(b'broken')
        with self.assertRaises(ValueError):
            self.package()
        # Tampered archive bypassing the packaging helper also fails before activation.
        with tarfile.open(self.archive, 'w:gz') as archive:
            for name in ['manifest.json', *self.records]:
                archive.add(self.output / name, arcname=name)
        with self.assertRaises(ValueError):
            installer.install(self.archive, self.data)
        self.assertEqual(pointer.read_bytes(), active_before)

    def test_archive_traversal_links_wrong_voice_and_partial_packs_rejected(self):
        for member_name, link in [('../escape.mp3', False), ('words/word-1.mp3', True)]:
            with tarfile.open(self.archive, 'w:gz') as archive:
                member = tarfile.TarInfo(member_name)
                if link:
                    member.type, member.linkname = tarfile.SYMTYPE, '/etc/passwd'
                else:
                    member.size = 3
                archive.addfile(member, None if link else io.BytesIO(b'bad'))
            with self.assertRaises(ValueError):
                installer.install(self.archive, self.data)
        self.assertFalse((self.data / 'audio/voicevox/active.json').exists())
        self.manifest['profile'] = dict(pack.PROFILE, speaker_id=2)
        generator.write_manifest(self.output, self.manifest)
        with self.assertRaises(ValueError):
            self.package()
        self.manifest['profile'] = pack.PROFILE
        generator.write_manifest(self.output, self.manifest)
        (self.output / 'words/word-1.mp3').unlink()
        with self.assertRaises(ValueError):
            self.package()

    def test_api_no7_priority_aliases_sentence_and_fallback(self):
        from fastapi.testclient import TestClient
        from app import main
        self.package()
        installer.install(self.archive, self.data)
        original = self.folder / 'original.mp3'
        original.write_bytes(b'ID3-original')
        # Do not enter lifespan: this isolated minimal database must not run seed migrations.
        client = TestClient(main.app)
        self.addCleanup(client.close)
        with patch.dict(os.environ, {'DATA_DIR': str(self.data)}), \
                patch.object(main.source_audio, 'get_audio', return_value=original) as upstream:
            for ident in ('word-1', 'old-1'):
                response = client.get(f'/api/audio/{ident}.mp3')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['x-audio-source'], 'voicevox-no7')
                self.assertEqual(response.headers['cache-control'], 'no-cache')
                self.assertTrue(response.content.startswith(b'ID3'))
            key = pack.example_key('学校に行きます。')
            response = client.get(f'/api/audio/examples/{key}.mp3')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['content-type'], 'audio/mpeg')
            self.assertEqual(client.get(f'/api/audio/examples/{key}.mp3', headers={'Range': 'bytes=0-2'}).content, b'ID3')
            upstream.assert_not_called()
            pack.active_audio(self.data, 'words/word-1.mp3').unlink()
            self.assertEqual(client.get('/api/audio/word-1.mp3').headers['x-audio-source'], 'eggrolls-original')
            (self.data / 'audio/voicevox/active.json').unlink()
            self.assertEqual(client.get(f'/api/audio/examples/{key}.mp3').status_code, 404)
            self.assertEqual(client.get('/api/audio/examples/not-a-hash.mp3').status_code, 404)


if __name__ == '__main__':
    unittest.main()
