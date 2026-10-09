"""Build a replacement seed from the pinned egg rolls TSV, never modifying input.

All active words, levels, Chinese glosses and examples come from egg rolls.
Legacy IDs only provide progress aliases and curated-book intersections.
"""
import argparse
import collections
import csv
import hashlib
import json
import re
import sqlite3
from contextlib import closing
from pathlib import Path

from audit_anki_vocab import COMMIT, SHA256, pair, plain, read_notes

REVISION = "eggrolls-853798a-v1"
# Reviewed homographs. Unmentioned single-note pairs are unambiguous by form
# and reading. Progress is never cloned to an additional, unstudied sense.
SENSES = {
    '6a4011f27f': '0b68dbc8-2ed7-11ef-a183-99ad05e145f0',
    'd727a76b22': '0b493e76-2ed7-11ef-a183-99ad05e145f0',
    '0470fc929f': '0b582076-2ed7-11ef-a183-99ad05e145f0',
    '20fcc4f54f': '0b5e0e96-2ed7-11ef-a183-99ad05e145f0',
    '0e8f798dbf': '0b651736-2ed7-11ef-a183-99ad05e145f0',
    'e11ef6d7e3': '5b7dc2a8-054c-11f0-80d4-175b5d01d6a0',
    'jlpt10k-02071': '0b962e5c-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-10373': '5b7dc2a8-054c-11f0-80d4-175b5d01d6a0',
    'jlpt10k-02079': '0b967b14-2ed7-11ef-a183-99ad05e145f0',
    '62682a6308': '0b96f7ba-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-02094': '0b96f7ba-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-07315': '0ca2b630-2ed7-11ef-a183-99ad05e145f0',
    '617364b915': '0bcf1f50-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-03357': '0bca17d0-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-07910': '0cddfe84-2ed7-11ef-a183-99ad05e145f0',
    'jlpt10k-09807': '49afb45e-b061-11ef-b775-e7560ea47657',
    'jlpt10k-10374': '3a114dac-06d6-11f0-a977-0589cb933c5e',
    'xbj-0527': '3a114dac-06d6-11f0-a977-0589cb933c5e',
}


def build(notes_path, old_seed, audio_index, output):
    if hashlib.sha256(notes_path.read_bytes()).hexdigest() != SHA256:
        raise ValueError('Upstream notes differ from reviewed, pinned version')
    if output.exists() or output.resolve() == old_seed.resolve():
        raise ValueError('Output must be a new file, distinct from the input seed')
    notes = read_notes(notes_path)
    with notes_path.open(encoding='utf-8-sig', newline='') as f:
        raw = {r[2]: r for r in csv.reader((l for l in f if not l.startswith('#')), delimiter='\t')}
    audio = json.loads(audio_index.read_text(encoding='utf8'))
    index = collections.defaultdict(list)
    for n in notes:
        index[pair(n['written'], n['reading'])].append(n)
    output.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(old_seed.resolve().as_uri() + '?mode=ro', uri=True)) as src:
        src.row_factory = sqlite3.Row
        old_words = [dict(r) for r in src.execute('SELECT * FROM words')]
        books = [dict(r) for r in src.execute('SELECT * FROM books')]
        memberships = [dict(r) for r in src.execute('SELECT * FROM book_words')]
        with closing(sqlite3.connect(output)) as dest:
            src.backup(dest)
    aliases = {}
    for w in old_words:
        candidates = index.get(pair(w['kanji'] or w['kana'], w['kana']), [])
        if not candidates:
            continue
        chosen = SENSES.get(w['id']) if len(candidates) > 1 else candidates[0]['note_id']
        if chosen not in {n['note_id'] for n in candidates}:
            raise ValueError(f"Unreviewed ambiguous word: {w['id']}")
        aliases[w['id']] = 'eggrolls-' + chosen

    stamp = '2026-10-10T00:00:00+08:00'
    words, examples, sources, sort_keys = [], [], [], {}
    for n in notes:
        r = raw[n['note_id']]
        wid = 'eggrolls-' + n['note_id']
        freq = next((f for f in ('高频', '中频', '低频') if f in r[1]), None)
        sort_keys[wid] = (('高频', '中频', '低频').index(freq) if freq else 0, float(r[35]), n['note_id'])
        # Kana etymology is not a reading; read_notes handles this explicitly.
        kanji = None if n['written'] == n['reading'] else n['written']
        words.append((wid, kanji, n['reading'], '', '', n['meaning_zh'],
                      json.dumps([n['pos']], ensure_ascii=False), n['level'], None, '[]', '[]',
                      '/api/audio/' + wid + '.mp3', None, None, 'eggrolls-anki', stamp, stamp,
                      'eggrolls-anki', {'高频': 'high', '中频': 'mid', '低频': 'low'}.get(freq), None, None))
        for i in (12, 18, 24, 30):
            if not r[i]:
                continue
            kind = {'関': '关联词', '対': '反义词'}.get(r[i - 1], '例句')
            examples.append((len(examples) + 1, wid, plain(r[i]), plain(r[i + 1]), '',
                             plain(r[i + 2]), None, 'eggrolls-' + kind, 'eggrolls-anki'))
        match = re.fullmatch(r'\[sound:([^\]\r\n]+)\]', r[10])
        if not match or not audio.get(match.group(1)):
            raise ValueError(f"Missing pinned audio reference for {wid}")
        sources.append((wid, match.group(1), audio[match.group(1)], COMMIT))

    frequency_by_id = {w[0]: w[18] for w in words}
    book_rows = collections.defaultdict(dict)
    for m in memberships:
        target = aliases.get(m['word_id'])
        if target:
            prev = book_rows[m['book_id']].get(target, m['sort_order'])
            book_rows[m['book_id']][target] = min(prev, m['sort_order'])
    for level in ('N5', 'N4', 'N3', 'N2', 'N1'):
        members = sorted((w[0] for w in words if w[7] == level), key=sort_keys.get)
        book_rows['level-' + level.lower()] = {wid: i for i, wid in enumerate(members)}
        book_rows['freq-' + level.lower()] = {wid: i for i, wid in enumerate(members[:1000 if level == 'N1' else 500])}
        if level in ('N3', 'N2', 'N1'):
            advanced = [wid for wid in members if frequency_by_id[wid] in ('high', 'mid')]
            book_rows['adv-' + level.lower()] = {wid: i for i, wid in enumerate(advanced)}
    frequent = sorted((w[0] for w in words if w[18] == 'high'), key=sort_keys.get)[:1000]
    book_rows['freq-exam-top1000'] = {wid: i for i, wid in enumerate(frequent)}
    with closing(sqlite3.connect(output)) as db:
        db.execute('PRAGMA foreign_keys=OFF')
        db.execute('PRAGMA journal_mode=DELETE')
        with db:
            db.execute('DELETE FROM examples')
            db.execute('DELETE FROM book_words')
            db.execute('DELETE FROM words')
            db.executemany('INSERT INTO words VALUES (' + ','.join('?' * 21) + ')', words)
            db.executemany('INSERT INTO examples (id,word_id,sentence_ja,furigana,sentence_en,sentence_zh,tatoeba_id,source,zh_source) VALUES (?,?,?,?,?,?,?,?,?)', examples)
            db.execute('CREATE TABLE word_aliases (old_id TEXT PRIMARY KEY, word_id TEXT NOT NULL)')
            db.execute('CREATE INDEX idx_word_alias_target ON word_aliases(word_id)')
            db.executemany('INSERT INTO word_aliases VALUES (?,?)', aliases.items())
            db.execute('CREATE TABLE word_audio_sources (word_id TEXT PRIMARY KEY, filename TEXT NOT NULL, git_blob_sha1 TEXT NOT NULL, commit_sha TEXT NOT NULL)')
            db.executemany('INSERT INTO word_audio_sources VALUES (?,?,?,?)', sources)
            db.execute('CREATE TABLE vocab_source_notes (word_id TEXT PRIMARY KEY, note_id TEXT NOT NULL, original_reading TEXT, meaning_zh_trad TEXT, notes_zh TEXT, sort_value REAL)')
            db.executemany('INSERT INTO vocab_source_notes VALUES (?,?,?,?,?,?)', [
                ('eggrolls-' + n['note_id'], n['note_id'], plain(raw[n['note_id']][6]),
                 plain(raw[n['note_id']][8]), plain(raw[n['note_id']][9]), float(raw[n['note_id']][35])) for n in notes])
            for b in books:
                if b['id'].startswith('level-'):
                    desc = 'egg rolls v3.5 参考词库，分级与顺序采用上游数据'
                    name = b['level'] + ' 词汇'
                else:
                    desc = '原精选清单与 egg rolls 新词库的对应词；非完整教材或官方考试范围'
                    name = b['name'].replace('Top500', '精选').replace('Top1000', '精选')
                    if b['id'].startswith('freq-') or b['id'].startswith('adv-'):
                        desc = '按 egg rolls 分级、考频分类与上游顺序精选；不代表官方考试范围'
                        name = name.replace('高频 精选', '精选')
                db.execute('UPDATE books SET name=?,description=? WHERE id=?', (name, desc, b['id']))
            db.executemany('INSERT INTO book_words VALUES (?,?,?)', [
                (book, wid, order) for book, members in book_rows.items() for wid, order in members.items()])
            for key, value in {'catalog_revision': REVISION, 'catalog_source': 'eggrolls-anki',
                               'catalog_commit': COMMIT, 'catalog_notes_sha256': SHA256,
                               'catalog_license': 'CC BY-NC 4.0'}.items():
                db.execute('INSERT OR REPLACE INTO import_meta VALUES (?,?)', (key, value))
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Replacement seed integrity failed')
        assert db.execute('SELECT COUNT(*) FROM words').fetchone()[0] == 10641
        assert not db.execute('SELECT 1 FROM book_words WHERE word_id NOT IN (SELECT id FROM words)').fetchone()
        db.execute('VACUUM')
    result = {'revision': REVISION, 'active_words': len(words), 'examples_and_related': len(examples),
              'mapped_legacy_ids': len(aliases), 'mapped_source_words': len(set(aliases.values())),
              'unmapped_legacy_ids': len(old_words) - len(aliases),
              'counts': dict(collections.Counter(w[7] for w in words))}
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--notes', type=Path, required=True)
    parser.add_argument('--old-seed', type=Path, required=True)
    parser.add_argument('--audio-index', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    build(args.notes, args.old_seed, args.audio_index, args.out)
