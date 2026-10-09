"""Atomic replacement of the active vocabulary, with progress aliases and backup."""
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone, timedelta
from pathlib import Path


def rows(conn, sql, params=()):
    cursor = conn.execute(sql, params)
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def catalog_revision(seed):
    with closing(sqlite3.connect(Path(seed).resolve().as_uri() + '?mode=ro', uri=True)) as src:
        if not src.execute("SELECT 1 FROM sqlite_master WHERE name='import_meta'").fetchone():
            return None
        row = src.execute("SELECT value FROM import_meta WHERE key='catalog_revision'").fetchone()
        return row[0] if row else None


def applied(conn, revision):
    return bool(conn.execute("SELECT 1 FROM sqlite_master WHERE name='vocab_revision_log'").fetchone()
                and conn.execute('SELECT 1 FROM vocab_revision_log WHERE revision=?', (revision,)).fetchone())


def backup_before_upgrade(db_path, seed):
    """SQLite backup includes committed WAL pages; never overwrite the old backup."""
    revision = catalog_revision(seed)
    if not revision:
        return None
    with closing(sqlite3.connect(db_path)) as source:
        if applied(source, revision):
            return None
        target = Path(db_path).parent / 'backups' / ('app-before-' + revision + '.db')
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            with closing(sqlite3.connect(target.resolve().as_uri() + '?mode=ro', uri=True)) as check:
                if check.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Existing vocabulary backup failed integrity check')
            return str(target)
        partial = target.with_suffix('.db.partial')
        with closing(sqlite3.connect(partial)) as backup:
            source.backup(backup)
            if backup.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Vocabulary backup failed integrity check')
        os.replace(partial, target)
        return str(target)


def resolve_word_id(conn, word_id):
    row = conn.execute('SELECT word_id FROM word_aliases WHERE old_id=?', (word_id,)).fetchone()
    return row[0] if row else word_id


def _insert(conn, table, records):
    if not records:
        return
    columns = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
    columns = [c for c in columns if c in records[0]]
    names = ','.join('"' + c + '"' for c in columns)
    marks = ','.join('?' for _ in columns)
    conn.executemany(f'INSERT INTO "{table}" ({names}) VALUES ({marks})',
                     [tuple(row[c] for c in columns) for row in records])


def _time(row):
    timestamps = []
    for field in ('updated_at', 'fsrs_last_review'):
        try:
            value = datetime.fromisoformat(row.get(field) or '')
            # Old runtime stores Shanghai local time without a timezone.
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone(timedelta(hours=8)))
            timestamps.append(value.timestamp())
        except (ValueError, TypeError):
            pass
    return max(timestamps, default=float('-inf'))


def migrate(conn, seed):
    revision = catalog_revision(seed)
    # Even older seed fixtures need this table so API alias lookups remain safe.
    conn.execute('CREATE TABLE IF NOT EXISTS word_aliases (old_id TEXT PRIMARY KEY, word_id TEXT NOT NULL)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_word_alias_target ON word_aliases(word_id)')
    if not revision or applied(conn, revision):
        return None
    tables = ('words', 'examples', 'books', 'book_words', 'word_audio_sources', 'vocab_source_notes')
    with closing(sqlite3.connect(Path(seed).resolve().as_uri() + '?mode=ro', uri=True)) as src:
        snapshot = {table: rows(src, f'SELECT * FROM "{table}"') for table in tables}
        schemas = {table: src.execute('SELECT sql FROM sqlite_master WHERE name=?', (table,)).fetchone()[0] for table in tables}
        aliases = dict(src.execute('SELECT old_id,word_id FROM word_aliases'))
        metadata = dict(src.execute("SELECT key,value FROM import_meta WHERE key LIKE 'catalog_%'"))
    active = {w['id'] for w in snapshot['words']}
    if not active or any(target not in active for target in aliases.values()):
        raise RuntimeError('Invalid catalog or progress alias target')
    previous_words = rows(conn, 'SELECT * FROM words')
    states = rows(conn, 'SELECT * FROM user_words')
    stars = rows(conn, 'SELECT * FROM starred_words')
    selected = {}
    selected_stars = {}
    for state in states:
        target = aliases.get(state['word_id'], state['word_id'] if state['word_id'] in active else None)
        if target is None:
            continue
        key = (state['user_id'], target)
        candidate = dict(state, word_id=target)
        if key not in selected or _time(candidate) > _time(selected[key]):
            selected[key] = candidate  # retain one complete FSRS state, never sum schedules
    for star in stars:
        target = aliases.get(star['word_id'], star['word_id'] if star['word_id'] in active else None)
        if target is None:
            continue
        key = (star['user_id'], target)
        candidate = dict(star, word_id=target)
        if key not in selected_stars or candidate['created_at'] < selected_stars[key]['created_at']:
            selected_stars[key] = candidate
    conn.commit()
    conn.execute('BEGIN IMMEDIATE')
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS vocab_revision_log (revision TEXT PRIMARY KEY, applied_at TEXT NOT NULL, summary_json TEXT NOT NULL)')
        conn.execute('CREATE TABLE IF NOT EXISTS vocab_user_archive (revision TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, row_json TEXT NOT NULL, PRIMARY KEY(revision,table_name,row_key))')
        conn.execute('CREATE TABLE IF NOT EXISTS retired_words (id TEXT PRIMARY KEY, revision TEXT NOT NULL, word_json TEXT NOT NULL)')
        for table, originals in (('user_words', states), ('starred_words', stars)):
            conn.executemany('INSERT OR IGNORE INTO vocab_user_archive VALUES (?,?,?,?)', [
                (revision, table, json.dumps([r['user_id'], r['word_id']]), json.dumps(r, ensure_ascii=False))
                for r in originals if r['word_id'] not in active])
        conn.executemany('INSERT OR IGNORE INTO retired_words VALUES (?,?,?)', [
            (w['id'], revision, json.dumps(w, ensure_ascii=False)) for w in previous_words
            if w['id'] not in aliases and w['id'] not in active])
        # Keep aliases from earlier upgrades flat where the old target migrated.
        prior = dict(conn.execute('SELECT old_id,word_id FROM word_aliases'))
        for old, target in prior.items():
            if target in aliases:
                aliases[old] = aliases[target]
        conn.executemany('INSERT OR REPLACE INTO word_aliases VALUES (?,?)', aliases.items())
        log_columns = {r[1] for r in conn.execute('PRAGMA table_info(study_logs)')}
        if 'original_word_id' not in log_columns:
            conn.execute('ALTER TABLE study_logs ADD COLUMN original_word_id TEXT')
        conn.execute('''UPDATE study_logs SET
            original_word_id=COALESCE(original_word_id,word_id),
            word_id=(SELECT a.word_id FROM word_aliases a WHERE a.old_id=study_logs.word_id)
            WHERE word_id IN (SELECT old_id FROM word_aliases)''')
        conn.execute('DELETE FROM user_words')
        conn.execute('DELETE FROM starred_words')
        # Delete dependants before their parent, also valid with foreign_keys=ON.
        for table in ('examples', 'book_words', 'words', 'books', 'word_audio_sources', 'vocab_source_notes'):
            exists = conn.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone()
            if exists:
                conn.execute(f'DELETE FROM "{table}"')
            else:
                conn.execute(schemas[table])
        for table in tables:
            _insert(conn, table, snapshot[table])
        _insert(conn, 'user_words', list(selected.values()))
        _insert(conn, 'starred_words', list(selected_stars.values()))
        conn.execute('CREATE TABLE IF NOT EXISTS import_meta (key TEXT PRIMARY KEY,value TEXT)')
        conn.executemany('INSERT OR REPLACE INTO import_meta VALUES (?,?)', metadata.items())
        summary = {'active_words': len(active), 'old_words': len(previous_words),
                   'old_user_cards': len(states), 'active_user_cards': len(selected),
                   'old_stars': len(stars), 'active_stars': len(selected_stars)}
        if conn.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('Foreign-key check failed during vocabulary upgrade')
        conn.execute('INSERT INTO vocab_revision_log VALUES (?,?,?)',
                     (revision, datetime.now(timezone.utc).isoformat(), json.dumps(summary)))
        conn.commit()
        return summary
    except Exception:
        conn.rollback()
        raise
