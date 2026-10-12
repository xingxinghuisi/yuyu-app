#!/usr/bin/env python3
"""Generate No.7 word + example MP3s on VPS A. See docs/voicevox-audio.md."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import voicevox_audio as pack

DEFAULT_URL = 'http://127.0.0.1:50021'
DEFAULT_SPEAKER = 29


def engine_json(base_url, endpoint):
    with urllib.request.urlopen(base_url.rstrip('/') + endpoint, timeout=30) as response:
        return json.load(response)


def check_speaker(base_url):
    for character in engine_json(base_url, '/speakers'):
        for style in character.get('styles', []):
            if style['id'] == DEFAULT_SPEAKER:
                if character['name'] != 'No.7' or style['name'] != 'ノーマル':
                    raise ValueError('Engine style 29 is not No.7 / ノーマル')
                return engine_json(base_url, '/version')
    raise ValueError('No.7 / ノーマル is unavailable in this engine')


def synth_one(base_url, speaker, text, timeout=120):
    qs = urllib.parse.urlencode({'speaker': speaker, 'text': text})
    request = urllib.request.Request(f'{base_url}/audio_query?{qs}', data=b'{}', method='POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        query = json.load(response)
    request = urllib.request.Request(f'{base_url}/synthesis?speaker={speaker}',
                                     data=json.dumps(query).encode('utf-8'), method='POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def wav_to_mp3(wav_bytes):
    result = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', 'pipe:0', '-ac', '1',
                             '-ar', '24000', '-b:a', '64k', '-f', 'mp3', 'pipe:1'],
                            input=wav_bytes, capture_output=True, timeout=120)
    if result.returncode or not result.stdout:
        raise RuntimeError('ffmpeg failed: ' + result.stderr.decode(errors='replace')[:200])
    return result.stdout


def write_manifest(folder, manifest):
    temp = folder / 'manifest.json.tmp'
    temp.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True), encoding='utf-8')
    os.replace(temp, folder / 'manifest.json')


def gen_record(base_url, name, text, folder, old_entry):
    if pack.valid_file(folder, name, text, old_entry):
        return 'skip', old_entry
    target = folder / name
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        try:
            audio = wav_to_mp3(synth_one(base_url, DEFAULT_SPEAKER, text))
            temp = target.with_suffix('.mp3.tmp')
            temp.write_bytes(audio)
            os.replace(temp, target)
            return 'ok', {'text': text, 'size': len(audio), 'sha256': hashlib.sha256(audio).hexdigest()}
        except Exception as error:
            last_error = error
            if attempt < 2:
                time.sleep(2)
    return 'fail', str(last_error)


def package_audio(folder, records, target):
    pack.verify_pack(folder, records)  # Samples/incomplete runs cannot become a published full pack.
    target = Path(target).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.name + '.tmp')
    with tarfile.open(temp, 'w:gz') as archive:
        for name in ['manifest.json', *records]:
            archive.add(folder / name, arcname=name, recursive=False)
    os.replace(temp, target)
    print(f'PACKAGE_READY={target}', flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description='No.7 words + examples; resume, verify and package offline audio')
    parser.add_argument('--db', default='backend/data/seed/yuyu-vocab.db')
    parser.add_argument('--out', default='data/audio-build/no7')
    parser.add_argument('--voicevox-url', default=DEFAULT_URL)
    parser.add_argument('--speaker', type=int, default=DEFAULT_SPEAKER)
    parser.add_argument('--workers', type=int, default=2)
    parser.add_argument('--kind', choices=['all', 'words', 'examples'], default='all')
    parser.add_argument('--limit', type=int, default=0, help='Sample N recordings per kind; 0 = all')
    parser.add_argument('--verify-only', action='store_true', help='Verify without VOICEVOX or ffmpeg')
    parser.add_argument('--package', metavar='TAR_GZ', help='Verify complete pack and create transfer archive')
    args = parser.parse_args(argv)
    if args.workers < 1 or args.limit < 0 or args.speaker != 29:
        parser.error('workers must be positive, limit nonnegative, and speaker must be 29 (No.7 normal)')
    records = pack.catalog(args.db)
    folder = Path(args.out).resolve()
    counts = {kind: sum(name.startswith(kind + '/') for name in records) for kind in ('words', 'examples')}
    print(f'[audio] {counts}; No.7 normal; workers={args.workers}', flush=True)
    if args.verify_only:
        pack.verify_pack(folder, records)
    else:
        if not shutil.which('ffmpeg'):
            raise ValueError('Install ffmpeg before generation')
        base_url = args.voicevox_url.rstrip('/')
        version = check_speaker(base_url)
        folder.mkdir(parents=True, exist_ok=True)
        if (folder / 'manifest.json').exists():
            manifest = pack.read_manifest(folder)
            if manifest.get('engine_version') != version:
                raise ValueError('Engine version changed; use a new output directory to avoid mixed voices')
        else:
            manifest = {'schema': 1, 'profile': pack.PROFILE, 'format': pack.FORMAT,
                        'engine_version': version, 'files': {}}
        manifest['catalog_sha256'] = pack.catalog_hash(records)
        write_manifest(folder, manifest)
        selected = {}
        for kind in ('words', 'examples'):
            if args.kind not in ('all', kind):
                continue
            rows = [(name, text) for name, text in records.items() if name.startswith(kind + '/')]
            selected.update(rows[:args.limit] if args.limit else rows)
        stats = {'ok': 0, 'skip': 0, 'fail': 0}

        def task(item):
            name, text = item
            return name, gen_record(base_url, name, text, folder, manifest['files'].get(name))

        started = time.monotonic()
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
                for index, (name, (status, result)) in enumerate(executor.map(task, selected.items()), 1):
                    stats[status] += 1
                    if status == 'fail':
                        print(f'[audio] FAIL {name}: {result}', flush=True)
                    else:
                        manifest['files'][name] = result
                    if index % 50 == 0 or index == len(selected):
                        write_manifest(folder, manifest)
                        print(f'[audio] {index}/{len(selected)} {stats} elapsed={time.monotonic()-started:.0f}s', flush=True)
        finally:
            write_manifest(folder, manifest)
        if stats['fail']:
            return 1
    if args.package:
        package_audio(folder, records, args.package)
    print('AUDIO_OK', flush=True)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, sqlite3.Error) as error:
        print(f'[audio] STOP: {error}', file=sys.stderr)
        sys.exit(1)
