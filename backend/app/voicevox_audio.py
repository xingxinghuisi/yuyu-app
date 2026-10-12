"""Offline No.7 packs; the app VPS only serves files, never runs synthesis."""
import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path

PROFILE = {'speaker_id': 29, 'speaker_name': 'No.7', 'style_name': 'ノーマル'}
FORMAT = {'channels': 1, 'sample_rate': 24000, 'bitrate': '64k'}
SAFE_ID = re.compile(r'[A-Za-z0-9_-]+\Z')
SAFE_RELEASE = re.compile(r'no7-[a-f0-9]{64}\Z')


def example_key(text):
    return hashlib.sha256(text.strip().encode('utf-8')).hexdigest()


def catalog(db):
    """Read vocabulary only; user records never enter the audio pack."""
    with closing(sqlite3.connect(Path(db).resolve().as_uri() + '?mode=ro', uri=True)) as conn:
        words = conn.execute('SELECT id,kana FROM words ORDER BY id').fetchall()
        examples = conn.execute('SELECT sentence_ja FROM examples ORDER BY id').fetchall()
    records = {}
    for ident, kana in words:
        if not SAFE_ID.fullmatch(ident) or not kana or not kana.strip():
            raise ValueError(f'Invalid word ID or reading: {ident}')
        records[f'words/{ident}.mp3'] = kana.strip()
    for (sentence,) in examples:
        if sentence and sentence.strip():
            records[f'examples/{example_key(sentence)}.mp3'] = sentence.strip()
    if not words:
        raise ValueError('Empty vocabulary')
    return dict(sorted(records.items()))


def catalog_hash(records):
    return hashlib.sha256(json.dumps(records, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()


def read_manifest(folder):
    manifest = json.loads((Path(folder) / 'manifest.json').read_text('utf-8'))
    if manifest.get('schema') != 1 or manifest.get('profile') != PROFILE or manifest.get('format') != FORMAT:
        raise ValueError('Expected a No.7 normal (style 29) audio pack, schema 1')
    return manifest


def valid_file(folder, name, text, entry):
    path = Path(folder) / name
    return (isinstance(entry, dict) and entry.get('text') == text
            and path.is_file() and not path.is_symlink() and path.stat().st_size > 0
            and path.stat().st_size == entry.get('size')
            and hashlib.sha256(path.read_bytes()).hexdigest() == entry.get('sha256'))


def verify_pack(folder, records):
    manifest = read_manifest(folder)
    if manifest.get('catalog_sha256') != catalog_hash(records):
        raise ValueError('Audio pack differs from current vocabulary; use the current seed database')
    files = manifest.get('files', {})
    for name, text in records.items():
        if not valid_file(folder, name, text, files.get(name)):
            raise ValueError(f'Missing, outdated or damaged audio: {name}')
    return manifest


def active_audio(data_dir, name):
    root = Path(data_dir) / 'audio' / 'voicevox'
    try:
        release = json.loads((root / 'active.json').read_text('utf-8'))['release']
        if not isinstance(release, str) or not SAFE_RELEASE.fullmatch(release):
            return None
        path = root / 'releases' / release / name
        if path.is_file() and path.stat().st_size > 0:
            return path
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None
