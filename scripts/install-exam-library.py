"""Validate and install an offline, owner-only v2 private exam bundle.

The default is a read-only dry run. Add --install to render and publish. No
network service is used. --data-dir is the application's DATA_DIR, so the
default live library is DATA_DIR/private-exams. Use --library-dir when the
application sets PRIVATE_EXAMS_DIR. Existing packs, media and attempts survive.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager, closing
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import sys
import time
import uuid


class InstallError(ValueError):
    pass


ID = re.compile(r'[a-z0-9][a-z0-9-]{0,79}')
SHA = re.compile(r'[a-f0-9]{64}')
ASSET = re.compile(r'(paper|answers)/[a-f0-9]{16}-p\d{4}\.webp')
ATTEMPTS_SQL = '''CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, exam_id TEXT NOT NULL,
    section_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
    started_at REAL NOT NULL, deadline_at REAL, submitted_at REAL,
    answers TEXT NOT NULL DEFAULT '{}', marked TEXT NOT NULL DEFAULT '{}',
    cursor TEXT, audio_position REAL NOT NULL DEFAULT 0, pack_revision TEXT)'''
VERSIONS_SQL = '''CREATE TABLE IF NOT EXISTS exam_versions (
    exam_id TEXT NOT NULL, revision TEXT NOT NULL, pack_json TEXT NOT NULL,
    PRIMARY KEY (exam_id,revision))'''


def require(condition, message):
    if not condition:
        raise InstallError(message)


def canonical(value):
    # This is deliberately identical to backend.app.private_exams.pin_pack.
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def revision(pack):
    return hashlib.sha256(canonical(pack).encode('utf-8')).hexdigest()


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def no_links(path):
    """Reject links/junctions in existing components, including the named root."""
    path = Path(os.path.abspath(path))
    for component in [*reversed(path.parents), path]:
        if component.is_symlink() or (hasattr(component, 'is_junction') and component.is_junction()):
            raise InstallError(f'Symlink/junction is not allowed: {component}')
        if component != path and component.exists():
            require(component.is_dir(), f'Path parent is not a directory: {component}')
    return path


def relative(root, name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name and '\x00' not in name,
            f'Unsafe relative path: {name!r}')
    parts = name.split('/')
    require(not PurePosixPath(name).is_absolute() and all(p not in ('', '.', '..') for p in parts),
            f'Unsafe relative path: {name!r}')
    path = no_links(root.joinpath(*parts))
    require(path.is_relative_to(root), f'Path escapes root: {name!r}')
    return path


def regular(path):
    no_links(path)
    require(path.exists() and stat.S_ISREG(path.stat().st_mode), f'Missing or nonregular file: {path}')
    return path


def load(path):
    regular(path)
    try:
        # Duplicate JSON keys would otherwise bypass integrity/identity checks.
        def pairs(items):
            result = {}
            for key, value in items:
                require(key not in result, f'Duplicate JSON key {key!r}: {path}')
                result[key] = value
            return result
        return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(InstallError(f'Invalid JSON number: {value}')))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise InstallError(f'Invalid JSON: {path}: {exc}') from exc


def sha(value, context):
    require(isinstance(value, str) and SHA.fullmatch(value), f'Invalid SHA256: {context}')
    return value


def indexed(items, context):
    require(isinstance(items, list) and items, f'Empty or invalid {context}')
    result = {}
    for item in items:
        require(isinstance(item, dict) and isinstance(item.get('id'), str) and ID.fullmatch(item['id']),
                f'Invalid id in {context}')
        require(item['id'] not in result, f'Duplicate id in {context}: {item["id"]}')
        result[item['id']] = item
    return result


def validate_pack(pack, entry, media):
    require(isinstance(pack, dict) and pack.get('schema_version') == 2 and pack.get('id') == entry['id'],
            f'Pack schema/id mismatch: {entry["id"]}')
    sections = indexed(pack.get('sections'), 'sections')
    questions = indexed(pack.get('questions'), 'questions')
    materials = pack.get('materials', [])
    require(isinstance(materials, list), f'Invalid materials: {pack["id"]}')
    material_ids = set(indexed(materials, 'materials')) if materials else set()
    refs = set()
    excluded = 0
    for question in questions.values():
        qid = question['id']
        require(question.get('section_id') in sections, f'Unknown section: {qid}')
        count = question.get('option_count')
        require(type(count) is int and 1 <= count <= 4, f'Invalid option count: {qid}')
        status = question.get('grading_status')
        require(status in ('reference', 'withheld'), f'Invalid grading status: {qid}')
        correct = question.get('correct')
        require(correct is None if status == 'withheld' else type(correct) is int and 1 <= correct <= count,
                f'Invalid answer key: {qid}')
        excluded += status == 'withheld'
        for key in ('material_ids', 'transcript_material_ids'):
            ids = question.get(key, [])
            require(isinstance(ids, list) and all(isinstance(x, str) and x in material_ids for x in ids),
                    f'Invalid material reference: {qid}')
        for key in ('assets', 'explanation_assets'):
            assets = question.get(key)
            require(isinstance(assets, list), f'Invalid assets: {qid}')
            for asset in assets:
                require(isinstance(asset, str) and ASSET.fullmatch(asset), f'Invalid asset: {asset!r}')
                if key == 'assets':
                    require(asset.startswith('paper/'), f'Answer image exposed before submission: {qid}')
                refs.add(asset)
    for section in sections.values():
        require(type(section.get('minutes')) is int and 1 <= section['minutes'] <= 240,
                f'Invalid section duration: {pack["id"]}')
        require(type(section.get('question_count')) is int and section['question_count'] ==
                sum(q['section_id'] == section['id'] for q in questions.values()),
                f'Section count mismatch: {pack["id"]}')
    require(refs == set(media['images']), f'Media image references/count mismatch: {pack["id"]}')
    require(entry.get('questions') == len(questions) and entry.get('images') == len(refs) and
            entry.get('excluded') == excluded and pack.get('review_count') == excluded,
            f'Manifest counts mismatch: {pack["id"]}')
    require(pack.get('audio_file') == 'audio-' + media['audio']['source_sha256'] + '.mp3',
            f'Audio filename/hash mismatch: {pack["id"]}')
    canonical(pack)


def read_bundle(bundle, only=None):
    bundle = no_links(bundle)
    require(bundle.is_dir(), f'Bundle directory does not exist: {bundle}')
    manifest = load(relative(bundle, 'manifest.json'))
    require(isinstance(manifest, dict) and manifest.get('schema_version') == 2, 'Unsupported manifest schema')
    entries = indexed(manifest.get('exams'), 'manifest exams')
    files = manifest.get('files')
    expected = {'packs/' + exam_id + '.json' for exam_id in entries}
    require(isinstance(files, dict) and set(files) == expected, 'Manifest pack files/count mismatch')
    packdir = relative(bundle, 'packs')
    require(packdir.is_dir() and {p.name for p in packdir.iterdir()} == {x + '.json' for x in entries},
            'Bundle packs directory/count mismatch (unexpected files are rejected)')
    planfile = relative(bundle, 'media-plan.json')
    require(digest(regular(planfile)) == sha(manifest.get('media_plan_sha256'), 'media plan'), 'Media plan SHA256 mismatch')
    plan = load(planfile)
    require(isinstance(plan, dict) and plan.get('version') == 1, 'Unsupported media plan version')
    media = indexed(plan.get('exams'), 'media exams')
    require(set(media) == set(entries), 'Manifest/media exam count mismatch')
    packs = {}
    for exam_id, entry in entries.items():
        path = relative(bundle, 'packs/' + exam_id + '.json')
        require(digest(regular(path)) == sha(files['packs/' + exam_id + '.json'], exam_id), f'Pack SHA256 mismatch: {exam_id}')
        item = media[exam_id]
        require(isinstance(item.get('images'), dict) and isinstance(item.get('audio'), dict), f'Invalid media entry: {exam_id}')
        for asset, source in item['images'].items():
            require(isinstance(asset, str) and ASSET.fullmatch(asset) and isinstance(source, dict), f'Invalid image plan: {exam_id}')
            require(type(source.get('page')) is int and 1 <= source['page'] <= 9999, f'Invalid PDF page: {exam_id}')
            require(int(asset[-9:-5]) == source['page'], f'Asset/page number mismatch: {asset}')
            sha(source.get('source_sha256'), asset)
            relative(bundle, source.get('source'))  # Validate syntax, not existence in the bundle.
        audio = item['audio']
        sha(audio.get('source_sha256'), exam_id + ' audio')
        require(type(audio.get('bytes')) is int and audio['bytes'] > 4, f'Invalid audio bytes: {exam_id}')
        require(isinstance(audio.get('source'), str) and audio['source'].lower().endswith('.mp3'), f'Expected MP3: {exam_id}')
        relative(bundle, audio['source'])
        pack = load(path)
        validate_pack(pack, entry, item)
        packs[exam_id] = pack
    chosen = set(only or entries)
    require(chosen and chosen <= set(entries), f'Unknown selected exam ids: {sorted(chosen - set(entries))}')
    return manifest, {x: packs[x] for x in sorted(chosen)}, {x: media[x] for x in sorted(chosen)}


def mp3_check(path):
    """Check an ID3 boundary and an MPEG audio frame without decoding/reencoding."""
    size = path.stat().st_size
    with path.open('rb') as stream:
        header = stream.read(10)
        offset = 0
        if header.startswith(b'ID3'):
            require(len(header) == 10 and all(x < 128 for x in header[6:10]), f'Invalid ID3 header: {path}')
            offset = 10 + sum(x << shift for x, shift in zip(header[6:10], (21, 14, 7, 0)))
            if header[3] == 4 and header[5] & 0x10:
                offset += 10
            require(offset < size, f'MP3 contains no audio after ID3 tag: {path}')
        stream.seek(offset)
        data = stream.read(128 * 1024)
    valid = any(data[i] == 255 and data[i+1] & 0xE0 == 0xE0 and
                (data[i+1] >> 3) & 3 != 1 and (data[i+1] >> 1) & 3 != 0 and
                (data[i+2] >> 4) not in (0, 15) and (data[i+2] >> 2) & 3 != 3
                for i in range(max(0, len(data)-3)))
    require(valid, f'No valid MPEG audio frame found: {path}')


def preflight_sources(source_root, media, scale):
    import pypdfium2 as pdfium
    source_root = no_links(source_root)
    require(source_root.is_dir(), f'Source root does not exist: {source_root}')
    sources = {}
    for item in media.values():
        for source in [*item['images'].values(), item['audio']]:
            path = relative(source_root, source['source'])
            expected = source['source_sha256']
            if path in sources:
                require(sources[path]['sha256'] == expected, f'Conflicting source hashes: {path}')
            else:
                sources[path] = {'sha256': expected, 'pages': set(), 'audio_bytes': None}
            if 'page' in source:
                require(path.suffix.lower() == '.pdf', f'Expected PDF: {path}')
                sources[path]['pages'].add(source['page'])
            else:
                previous = sources[path]['audio_bytes']
                require(previous in (None, source['bytes']), f'Conflicting audio size: {path}')
                sources[path]['audio_bytes'] = source['bytes']
    for index, (path, record) in enumerate(sources.items(), 1):
        regular(path)
        require(digest(path) == record['sha256'], f'Source SHA256 mismatch: {path}')
        if record['audio_bytes'] is not None:
            require(path.stat().st_size == record['audio_bytes'], f'Audio byte count mismatch: {path}')
            mp3_check(path)
        if record['pages']:
            try:
                with pdfium.PdfDocument(path) as doc:
                    require(max(record['pages']) <= len(doc), f'PDF page outside source: {path}')
                    for number in record['pages']:
                        with closing(doc[number-1]) as page:
                            width, height = page.get_size()
                            require(all(math.isfinite(x) and x > 0 for x in (width, height)) and
                                    width * height * scale * scale <= 100_000_000,
                                    f'Invalid or excessively large PDF page: {path}, page {number}')
            except InstallError:
                raise
            except Exception as exc:
                raise InstallError(f'Cannot open PDF: {path}: {exc}') from exc
        if index % 20 == 0:
            print(f'Validated {index}/{len(sources)} source files', file=sys.stderr, flush=True)
    return sources


def owner_check(root, requested):
    access = relative(root, 'access.json')
    if access.exists():
        data = load(access)
        owner = data.get('owner_username') if isinstance(data, dict) else None
        require(isinstance(owner, str) and owner.strip() and len(owner) <= 120, 'Existing access.json has no valid owner')
        require(requested is None or requested == owner, 'Existing personal library belongs to a different owner')
        return owner, False
    require(isinstance(requested, str) and requested.strip() and len(requested) <= 120 and
            not any(ord(c) < 32 for c in requested), '--owner is required for the first installation')
    return requested, True


def live_preflight(root, packs, media):
    no_links(root)
    require(not root.exists() or root.is_dir(), f'Library root is not a directory: {root}')
    for name in ('attempts.sqlite3', 'attempts.sqlite3-wal', 'attempts.sqlite3-shm'):
        path = relative(root, name)
        if path.exists():
            regular(path)
    for exam_id in packs:
        folder = relative(root, exam_id)
        require(not folder.exists() or folder.is_dir(), f'Exam folder is not a directory: {folder}')
        current = relative(folder, 'exam.json')
        if current.exists():
            old = load(current)
            require(isinstance(old, dict) and old.get('id') == exam_id, f'Invalid existing exam identity: {current}')
            canonical(old)
        for name in ['assets/' + x for x in media[exam_id]['images']] + ['source/' + packs[exam_id]['audio_file']]:
            target = relative(folder, name)
            if target.exists():
                regular(target)


def atomic_bytes(path, data):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.install-' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def atomic_copy(source, target, expected):
    no_links(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name('.install-' + uuid.uuid4().hex + '.tmp')
    try:
        with source.open('rb') as src, temporary.open('xb') as out:
            shutil.copyfileobj(src, out, 1024 * 1024)
            out.flush()
            os.fsync(out.fileno())
        require(digest(temporary) == expected, f'Source/cache changed while copying: {source}')
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


@contextmanager
def install_lock(root):
    lock = no_links(root.parent / ('.' + root.name + '-install.lock'))
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0)
            if not stream.read(1):
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise InstallError('Another installer is already running for this library') from exc
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise InstallError('Another installer is already running for this library') from exc
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream, fcntl.LOCK_UN)


def render_pdf_job(job):
    """PDFium is not thread safe: each worker owns its own process/document."""
    import pypdfium2 as pdfium
    require(digest(Path(job['source'])) == job['source_sha256'], f'Source changed before rendering: {job["source"]}')
    completed = []
    with pdfium.PdfDocument(job['source']) as doc:
        for image in job['images']:
            path = Path(image['path'])
            with closing(doc[image['page']-1]) as page:
                bitmap = page.render(scale=job['scale'])
                try:
                    pil = bitmap.to_pil().convert('RGB')
                    temporary = path.with_name('.' + path.name + '.' + uuid.uuid4().hex + '.tmp')
                    try:
                        pil.save(temporary, format='WEBP', quality=94, method=4)
                        with temporary.open('r+b') as stream:
                            os.fsync(stream.fileno())
                        os.replace(temporary, path)
                    finally:
                        pil.close()
                        if temporary.exists():
                            temporary.unlink()
                finally:
                    bitmap.close()
            completed.append((path, image['config']))
    require(digest(Path(job['source'])) == job['source_sha256'], f'Source changed during rendering: {job["source"]}')
    for path, config in completed:
        atomic_bytes(path.with_suffix('.json'), canonical({'config': config, 'sha256': digest(path)}).encode('utf-8'))
    return len(job['images'])


def cached_image(path, config):
    from PIL import Image
    meta = path.with_suffix('.json')
    no_links(path)
    no_links(meta)
    if not path.is_file() or not meta.is_file():
        return False
    try:
        record = load(meta)
        if record.get('config') != config or record.get('sha256') != digest(path):
            return False
        with Image.open(path) as image:
            if image.format != 'WEBP':
                return False
            image.verify()
        return True
    except (OSError, ValueError, KeyError):
        return False


def build_cache(cache, source_root, packs, media, scale, workers):
    cache.mkdir(parents=True, exist_ok=True)
    images = relative(cache, 'images')
    audio = relative(cache, 'audio')
    images.mkdir(exist_ok=True)
    audio.mkdir(exist_ok=True)
    renderer = {'pdfium': importlib.metadata.version('pypdfium2'), 'pillow': importlib.metadata.version('Pillow'),
                'scale': scale, 'quality': 94, 'method': 4, 'mode': 'RGB', 'cache_version': 1}
    ready, jobs, seen = {}, {}, set()
    for exam_id, item in media.items():
        assets = {}
        for asset, spec in item['images'].items():
            config = dict(renderer, source_sha256=spec['source_sha256'], page=spec['page'])
            key = hashlib.sha256(canonical(config).encode('utf-8')).hexdigest()
            path = relative(images, key + '.webp')
            assets['assets/' + asset] = (path, None)
            if key not in seen:
                seen.add(key)
                if not cached_image(path, config):
                    source = relative(source_root, spec['source'])
                    job = jobs.setdefault(str(source), {'source': str(source), 'source_sha256': spec['source_sha256'], 'scale': scale, 'images': []})
                    job['images'].append({'path': str(path), 'page': spec['page'], 'config': config})
        spec = item['audio']
        target = relative(audio, spec['source_sha256'] + '.mp3')
        if not target.is_file() or digest(target) != spec['source_sha256']:
            atomic_copy(relative(source_root, spec['source']), target, spec['source_sha256'])
        assets['source/' + packs[exam_id]['audio_file']] = (target, spec['source_sha256'])
        ready[exam_id] = assets
    total = sum(len(j['images']) for j in jobs.values())
    print(f'Cache: rendering {total} pages in {len(jobs)} PDFs with {workers} worker(s)', file=sys.stderr, flush=True)
    if jobs:
        completed = 0
        if workers == 1:
            for job in jobs.values():
                completed += render_pdf_job(job)
                print(f'[media] {completed}/{total} pages rendered', file=sys.stderr, flush=True)
        else:
            with ProcessPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(render_pdf_job, job) for job in jobs.values()]
                for future in as_completed(futures):
                    completed += future.result()
                    print(f'[media] {completed}/{total} pages rendered', file=sys.stderr, flush=True)
    for assets in ready.values():
        for name, (path, expected) in list(assets.items()):
            actual = digest(regular(path))
            if expected:
                require(actual == expected, f'Audio cache SHA256 mismatch: {path}')
            else:
                meta = load(path.with_suffix('.json'))
                require(actual == meta['sha256'] and cached_image(path, meta['config']), f'Invalid rendered cache: {path}')
            assets[name] = (path, actual)
    return ready


def snapshot(conn, pack):
    text = canonical(pack)
    rev = hashlib.sha256(text.encode('utf-8')).hexdigest()
    row = conn.execute('SELECT pack_json FROM exam_versions WHERE exam_id=? AND revision=?', (pack['id'], rev)).fetchone()
    require(row is None or row[0] == text, f'Existing snapshot content mismatch: {pack["id"]}')
    conn.execute('INSERT OR IGNORE INTO exam_versions (exam_id,revision,pack_json) VALUES (?,?,?)', (pack['id'], rev, text))
    return rev


def backup_database(root, cache):
    database = relative(root, 'attempts.sqlite3')
    if not database.exists():
        return None
    directory = relative(cache, 'backups/' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:8])
    directory.mkdir(parents=True)
    with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True, timeout=30)) as src:
        with closing(sqlite3.connect(directory / 'attempts.sqlite3')) as dest:
            src.backup(dest)
            require(dest.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'SQLite backup integrity check failed')
    atomic_bytes(directory / 'backup.json', canonical({'library': str(root), 'created_at': time.time()}).encode('utf-8'))
    return directory / 'attempts.sqlite3'


def pin_legacy_before_publish(conn, root, packs):
    """Commit historical versions before any exam.json replacement, never after."""
    conn.execute('BEGIN IMMEDIATE')
    try:
        conn.execute(ATTEMPTS_SQL)
        columns = {row[1] for row in conn.execute('PRAGMA table_info(attempts)')}
        require({'id', 'exam_id'} <= columns, 'Existing attempts table has an unsupported schema')
        if 'pack_revision' not in columns:
            conn.execute('ALTER TABLE attempts ADD COLUMN pack_revision TEXT')
        conn.execute(VERSIONS_SQL)
        pending = [row[0] for row in conn.execute('SELECT DISTINCT exam_id FROM attempts WHERE pack_revision IS NULL')]
        for exam_id in pending:
            require(isinstance(exam_id, str) and ID.fullmatch(exam_id), 'Legacy attempt contains an unsafe exam id')
            current = relative(root, exam_id + '/exam.json')
            require(current.is_file(), f'Cannot pin legacy attempt; old exam.json is missing: {exam_id}')
            old = load(current)
            require(isinstance(old, dict) and old.get('id') == exam_id, f'Legacy pack identity mismatch: {exam_id}')
            rev = snapshot(conn, old)
            conn.execute('UPDATE attempts SET pack_revision=? WHERE exam_id=? AND pack_revision IS NULL', (rev, exam_id))
        for pack in packs.values():
            snapshot(conn, pack)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return len(pending)


def database_needs_update(path, packs):
    if not path.exists():
        return True
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=30)) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'attempts', 'exam_versions'} <= tables:
            return True
        if 'pack_revision' not in {r[1] for r in conn.execute('PRAGMA table_info(attempts)')}:
            return True
        if conn.execute('SELECT 1 FROM attempts WHERE pack_revision IS NULL LIMIT 1').fetchone():
            return True
        for pack in packs.values():
            if not conn.execute('SELECT 1 FROM exam_versions WHERE exam_id=? AND revision=?', (pack['id'], revision(pack))).fetchone():
                return True
    return False


def read_ready(root, packs, media):
    """Validate transferable media against the separately hashed source bundle."""
    from PIL import Image
    root = no_links(root)
    require(root.is_dir(), f'Ready library does not exist: {root}')
    require(not relative(root, 'access.json').exists() and not relative(root, 'attempts.sqlite3').exists(),
            'Ready input must contain no live owner configuration or attempts database')
    manifest = load(relative(root, 'ready-manifest.json'))
    require(manifest.get('version') == 1 and isinstance(manifest.get('files'), dict), 'Invalid ready manifest')
    result = {}
    for index, (exam_id, pack) in enumerate(packs.items(), 1):
        folder = relative(root, exam_id)
        pack_path = regular(relative(folder, 'exam.json'))
        require(digest(pack_path) == manifest['files'].get(exam_id + '/exam.json') and
                revision(load(pack_path)) == revision(pack), f'Ready pack differs from bundle: {exam_id}')
        assets = {}
        for asset in media[exam_id]['images']:
            name = 'assets/' + asset
            path = regular(relative(folder, name))
            require(digest(path) == manifest['files'].get(exam_id + '/' + name), f'Ready image hash mismatch: {path}')
            with Image.open(path) as image:
                require(image.format == 'WEBP', f'Invalid ready image: {path}')
                image.verify()
            assets[name] = (path, digest(path))
        name = 'source/' + pack['audio_file']
        path = regular(relative(folder, name))
        require(path.stat().st_size == media[exam_id]['audio']['bytes'] and
                digest(path) == media[exam_id]['audio']['source_sha256'], f'Ready audio hash mismatch: {exam_id}')
        mp3_check(path)
        assets[name] = (path, media[exam_id]['audio']['source_sha256'])
        result[exam_id] = assets
        print(f'[ready] {index}/{len(packs)} exams checked', file=sys.stderr, flush=True)
    return result


def install(root, cache, source_root, packs, media, owner, scale, workers, ready=None):
    with install_lock(root):
        owner, new_access = owner_check(root, owner)
        live_preflight(root, packs, media)
        if ready is None:
            ready = build_cache(cache, source_root, packs, media, scale, workers)
        changed = []
        for exam_id, assets in ready.items():
            folder = relative(root, exam_id)
            for name, (_, expected) in assets.items():
                target = relative(folder, name)
                require(not target.exists() or digest(regular(target)) == expected,
                        f'Existing media differs; refusing to overwrite preserved asset: {target}')
            current = relative(folder, 'exam.json')
            if not current.exists() or revision(load(current)) != revision(packs[exam_id]) or any(
                    not relative(folder, name).exists() for name in assets):
                changed.append(exam_id)
        db = relative(root, 'attempts.sqlite3')
        db_update = database_needs_update(db, packs)
        if not changed and not new_access and not db_update:
            return {'published': 0, 'unchanged': len(packs), 'legacy_exams_pinned': 0, 'backup': None}
        # Backup precedes every mutation of the live library, including mkdir/media.
        backup = backup_database(root, cache)
        root.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(db, timeout=30)) as conn:
            pinned = pin_legacy_before_publish(conn, root, packs)
        if new_access:
            atomic_bytes(relative(root, 'access.json'), canonical({'owner_username': owner}).encode('utf-8'))
        for exam_id in changed:
            folder = relative(root, exam_id)
            for name, (source, expected) in ready[exam_id].items():
                target = relative(folder, name)
                if not target.exists():
                    atomic_copy(source, target, expected)
            # Assets are complete, and old NULL-revision attempts are committed.
            atomic_bytes(relative(folder, 'exam.json'), canonical(packs[exam_id]).encode('utf-8'))
            print(f'Published {exam_id}', file=sys.stderr, flush=True)
        return {'published': len(changed), 'unchanged': len(packs)-len(changed),
                'legacy_exams_pinned': pinned, 'backup': str(backup) if backup else None}


def build_only(root, cache, source_root, packs, media, scale, workers):
    """Create transferable private media; this output carries no access or DB."""
    with install_lock(root):
        live_preflight(root, packs, media)
        require(not relative(root, 'access.json').exists() and not relative(root, 'attempts.sqlite3').exists(),
                'Build output must be a separate staging directory without owner access or attempts DB')
        ready = build_cache(cache, source_root, packs, media, scale, workers)
        changed = 0
        # Validate the entire output before copying any ready files.
        for exam_id, assets in ready.items():
            for name, (_, expected) in assets.items():
                target = relative(root, exam_id + '/' + name)
                require(not target.exists() or digest(regular(target)) == expected,
                        f'Build output contains different existing media: {target}')
        for exam_id, assets in ready.items():
            folder = relative(root, exam_id)
            current = relative(folder, 'exam.json')
            missing = not current.exists() or revision(load(current)) != revision(packs[exam_id])
            for name, (source, expected) in assets.items():
                target = relative(folder, name)
                if not target.exists():
                    atomic_copy(source, target, expected)
                    missing = True
            if missing:
                atomic_bytes(current, canonical(packs[exam_id]).encode('utf-8'))
                changed += 1
        files = {exam_id + '/' + name: expected for exam_id, assets in ready.items()
                 for name, (_, expected) in assets.items()}
        files.update({exam_id + '/exam.json': digest(relative(root, exam_id + '/exam.json')) for exam_id in packs})
        atomic_bytes(relative(root, 'ready-manifest.json'), canonical({'version': 1, 'files': files}).encode('utf-8'))
        return {'built': changed, 'unchanged': len(packs)-changed, 'build_output': str(root)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--source-root', type=Path, help='Original private PDFs and MP3s')
    inputs.add_argument('--ready-root', type=Path, help='Transferable media produced by --build-only')
    parser.add_argument('--data-dir', type=Path, help='Application DATA_DIR; required for install/dry-run')
    parser.add_argument('--library-dir', type=Path, help='Explicit PRIVATE_EXAMS_DIR override')
    parser.add_argument('--cache-dir', type=Path, help='Resumable media cache and SQLite backups, outside the live library')
    parser.add_argument('--owner', help='Required only when access.json does not exist; existing owner must match')
    parser.add_argument('--only', nargs='+', metavar='EXAM_ID', help='Install only these manifest exam IDs')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--scale', type=float, choices=(2.0, 2.5), default=2.5)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='Default: validate without rendering or writing the library')
    mode.add_argument('--install', action='store_true', help='Render/cache media and atomically publish ready exam packs')
    mode.add_argument('--build-only', action='store_true', help='Build transferable packs/media without owner access or attempts DB')
    parser.add_argument('--build-output', type=Path, help='Separate private staging directory for --build-only')
    args = parser.parse_args(argv)
    try:
        bundle = no_links(args.bundle)
        source_root = no_links(args.source_root or args.ready_root)
        require(not args.ready_root or not args.build_only, '--ready-root cannot be combined with --build-only')
        require(args.data_dir is not None or args.build_only, '--data-dir is required for install/dry-run')
        require(args.build_output is not None if args.build_only else args.build_output is None,
                '--build-output is required with --build-only and allowed only in that mode')
        require(not args.build_only or args.library_dir is None, '--library-dir is not used with --build-only')
        data_dir = no_links(args.data_dir) if args.data_dir else no_links(args.build_output.parent)
        root = no_links(args.build_output if args.build_only else (args.library_dir or data_dir / 'private-exams'))
        cache = no_links(args.cache_dir or data_dir / '.private-exam-install-cache')
        for output in (root, cache):
            for input_root in (bundle, source_root):
                require(not output.is_relative_to(input_root) and not input_root.is_relative_to(output),
                        'Input directories and output/cache directories must not overlap')
        require(not cache.is_relative_to(root) and not root.is_relative_to(cache), 'Cache must be outside the live library')
        manifest, packs, media = read_bundle(bundle, args.only)
        owner = None
        if not args.build_only:
            owner, _ = owner_check(root, args.owner)
        live_preflight(root, packs, media)
        ready = read_ready(source_root, packs, media) if args.ready_root else None
        sources = ({path: {} for assets in ready.values() for path, _ in assets.values()} if ready is not None
                   else preflight_sources(source_root, media, args.scale))
        result = {'mode': 'build-only' if args.build_only else ('install' if args.install else 'dry-run'), 'exams': len(packs),
                  'bundle_exams': len(manifest['exams']), 'questions': sum(len(p['questions']) for p in packs.values()),
                  'image_assets': sum(len(m['images']) for m in media.values()), 'source_files': len(sources),
                  'source_bytes': sum(p.stat().st_size for p in sources), 'owner': owner, 'cloud_requests': 0}
        if args.install:
            result.update(install(root, cache, source_root, packs, media, owner, args.scale, args.workers, ready))
        elif args.build_only:
            result.update(build_only(root, cache, source_root, packs, media, args.scale, args.workers))
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (InstallError, OSError, sqlite3.Error, ImportError, KeyError, TypeError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
