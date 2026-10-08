"""首次启动初始化：复制种子库 + 创建应用表。"""

import os
import shutil
import sqlite3
from pathlib import Path

APP_TABLES = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  pro           INTEGER DEFAULT 0,
  lang          TEXT DEFAULT 'zh',
  daily_goal    INTEGER DEFAULT 30,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_words (
  user_id     INTEGER NOT NULL,
  word_id     TEXT NOT NULL,
  easiness    REAL DEFAULT 2.5,
  interval    INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  due_at      TEXT,
  last_grade  INTEGER,
  updated_at  TEXT,
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX IF NOT EXISTS idx_user_words_due ON user_words(user_id, due_at);

CREATE TABLE IF NOT EXISTS study_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  word_id    TEXT,
  grade      INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_logs_user ON study_logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS checkins (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date    TEXT NOT NULL,
  UNIQUE (user_id, date)
);
"""


def find_seed_db() -> Path | None:
    here = Path(__file__).resolve()
    candidates = [
        Path(os.environ["SEED_DB"]) if os.environ.get("SEED_DB") else None,
        here.parent / "data" / "seed" / "yuyu-vocab.db",          # Docker 镜像: /app/app/data/seed
        here.parent.parent / "data" / "seed" / "yuyu-vocab.db",   # 本地仓库: backend/data/seed
    ]
    for c in candidates:
        if c is not None and c.is_file():
            return c
    return None


def _column_names(conn: sqlite3.Connection, table: str) -> set:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


_WORDS_COLS = ("id", "kanji", "kana", "romaji", "meaning_en", "meaning_zh", "pos",
               "level", "jmdict_id", "other_forms", "other_readings", "audio_url",
               "mnemonic_zh", "image_url", "source", "created_at", "updated_at",
               "zh_source")
_EXAMPLES_COLS = ("id", "word_id", "sentence_ja", "furigana", "sentence_en",
                  "sentence_zh", "zh_source", "tatoeba_id", "source")
_KANJI_COLS = ("character", "level", "strokes", "onyomi", "kunyomi", "meanings",
               "meaning_zh", "created_at", "updated_at")


def _import_vocab_tables(conn: sqlite3.Connection) -> None:
    """v0.1 老库的 app.db 里没有 words/examples/kanji 表 (词库走单独的种子库),
    从种子库导入一份, 用户的学习数据不受影响。"""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    needed = {"words", "examples", "kanji"} - tables
    if not needed:
        return
    seed = find_seed_db()
    if seed is None:
        raise FileNotFoundError("seed db not found; cannot import vocab tables")
    # 先提交: 避免 ATTACH 后跨库操作受未提交事务影响 (见 _import_books 注释)
    conn.commit()
    conn.execute(f"ATTACH DATABASE 'file:{seed}?mode=ro' AS seed")
    try:
        if "words" in needed:
            conn.execute("""CREATE TABLE words (
                id TEXT PRIMARY KEY, kanji TEXT, kana TEXT NOT NULL, romaji TEXT,
                meaning_en TEXT NOT NULL, meaning_zh TEXT, pos TEXT, level TEXT NOT NULL,
                jmdict_id INTEGER, other_forms TEXT, other_readings TEXT,
                audio_url TEXT, mnemonic_zh TEXT, image_url TEXT,
                source TEXT NOT NULL DEFAULT 'openjlpt',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, zh_source TEXT)""")
            cols = _import_cols(_WORDS_COLS, _seed_col_names(conn, "words"))
            conn.execute(f"INSERT INTO words ({cols}) SELECT {cols} FROM seed.words")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_words_level ON words(level)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana)")
        if "examples" in needed:
            conn.execute("""CREATE TABLE examples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                sentence_ja TEXT NOT NULL, furigana TEXT, sentence_en TEXT,
                sentence_zh TEXT, zh_source TEXT, tatoeba_id INTEGER,
                source TEXT NOT NULL DEFAULT 'tatoeba',
                UNIQUE(word_id, tatoeba_id))""")
            cols = _import_cols(_EXAMPLES_COLS, _seed_col_names(conn, "examples"))
            conn.execute(f"INSERT INTO examples ({cols}) SELECT {cols} FROM seed.examples")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_examples_word ON examples(word_id)")
        if "kanji" in needed:
            conn.execute("""CREATE TABLE kanji (
                character TEXT PRIMARY KEY, level TEXT, strokes INTEGER,
                onyomi TEXT, kunyomi TEXT, meanings TEXT, meaning_zh TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            cols = _import_cols(_KANJI_COLS, _seed_col_names(conn, "kanji"))
            conn.execute(f"INSERT INTO kanji ({cols}) SELECT {cols} FROM seed.kanji")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_kanji_level ON kanji(level)")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("DETACH seed")


def _seed_col_names(conn: sqlite3.Connection, table: str) -> list:
    """种子库某表的实际列名（兼容新老种子库的列差异）"""
    return [r[1] for r in conn.execute(f"PRAGMA seed.table_info({table})")]


def _import_cols(table_cols: tuple, seed_cols: list) -> str:
    """取目标列与种子库实际列的交集（保持目标表列顺序），避免老种子缺列报错"""
    s = set(seed_cols)
    return ", ".join(c for c in table_cols if c in s)


_BOOKS_COLS = ("id", "name", "category", "level", "description", "sort_order")
_BOOK_WORDS_COLS = ("book_id", "word_id", "sort_order")


def _import_books(conn: sqlite3.Connection) -> None:
    """v0.4: books/book_words 词书表从种子库导入 (幂等, 老用户进度不受影响)。

    注意: 种子库以只读方式 ATTACH, 防止任何意外写入。
    表存在但为空时不直接返回: 旧种子库场景下 books 会是空表,
    新种子库到位后重启即可自动补上 (自愈, 无需手动删表)。
    book_words 用 CREATE IF NOT EXISTS + DELETE (不用 DROP+CREATE):
    同一事务内 DROP 后重建同名表会导致后续跨库 INSERT 报 no such table (SQLite 特性)。
    """
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "books" in tables and "book_words" in tables:
        n = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
        m = conn.execute("SELECT COUNT(*) FROM book_words").fetchone()[0]
        if n > 0 and m > 0:
            return
    seed = find_seed_db()
    if seed is None:
        raise FileNotFoundError("seed db not found; cannot import books")
    conn.commit()
    conn.execute(f"ATTACH DATABASE 'file:{seed}?mode=ro' AS seed")
    try:
        seed_tables = {r[0] for r in conn.execute(
            "SELECT name FROM seed.sqlite_master WHERE type='table'")}
        if "books" not in tables:
            conn.execute("""CREATE TABLE books (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
                level TEXT, description TEXT, sort_order INTEGER NOT NULL DEFAULT 0)""")
        # books 为空 (旧种子场景) 时也要从新种子补上
        if conn.execute("SELECT COUNT(*) FROM books").fetchone()[0] == 0:
            if "books" in seed_tables:
                cols = _import_cols(_BOOKS_COLS, _seed_col_names(conn, "books"))
                conn.execute(f"INSERT INTO books ({cols}) SELECT {cols} FROM seed.books")
        # book_words 全量重建 (幂等: 清空后重插, 词书内容以种子库为准)
        conn.execute("""CREATE TABLE IF NOT EXISTS book_words (
            book_id TEXT NOT NULL, word_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
            PRIMARY KEY (book_id, word_id))""")
        conn.execute("DELETE FROM book_words")
        if "book_words" in seed_tables:
            cols = _import_cols(_BOOK_WORDS_COLS, _seed_col_names(conn, "book_words"))
            conn.execute(f"INSERT INTO book_words ({cols}) SELECT {cols} FROM seed.book_words")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_book_words ON book_words(book_id, sort_order)")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("DETACH seed")


def _backfill_zh(conn: sqlite3.Connection) -> None:
    """v0.4.1: 用种子库的 meaning_zh 补齐已有 words 行的中文释义 (幂等)。

    只填 meaning_zh 为空的行, 已有中文 (含用户未来的人工校对) 永不覆盖。
    场景: 老版本 app.db 已存在 words, _import_vocab_tables 不会重导,
    此时 N4-N1 机翻中文只在新种子库里, 需要一次回填。
    """
    seed = find_seed_db()
    if seed is None:
        raise FileNotFoundError("seed db not found; cannot backfill zh")
    cols = _column_names(conn, "words")
    if "meaning_zh" not in cols:
        return
    conn.commit()
    conn.execute(f"ATTACH DATABASE 'file:{seed}?mode=ro' AS seed")
    try:
        seed_cols = {r[1] for r in conn.execute("PRAGMA seed.table_info(words)")}
        if "meaning_zh" not in seed_cols:
            return
        cur = conn.execute("""
            UPDATE words
            SET meaning_zh = (SELECT s.meaning_zh FROM seed.words s WHERE s.id = words.id),
                zh_source = COALESCE((SELECT s.zh_source FROM seed.words s WHERE s.id = words.id), 'mt')
            WHERE (meaning_zh IS NULL OR meaning_zh = '')
              AND EXISTS (SELECT 1 FROM seed.words s
                          WHERE s.id = words.id AND s.meaning_zh IS NOT NULL AND s.meaning_zh != '')
        """)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("DETACH seed")


def _backfill_example_zh(conn: sqlite3.Connection) -> None:
    """v0.4.2: 用种子库的 sentence_zh 补齐已有 examples 行的例句中文 (幂等)。

    只填 sentence_zh 为空的行, 已有中文 (含人工校对) 永不覆盖。
    老库的 examples 表若无 zh_source 列则先加上。
    """
    seed = find_seed_db()
    if seed is None:
        raise FileNotFoundError("seed db not found; cannot backfill example zh")
    cols = _column_names(conn, "examples")
    if "sentence_zh" not in cols:
        return
    if "zh_source" not in cols:
        conn.execute("ALTER TABLE examples ADD COLUMN zh_source TEXT")
        conn.commit()
    conn.commit()
    conn.execute(f"ATTACH DATABASE 'file:{seed}?mode=ro' AS seed")
    try:
        seed_cols = {r[1] for r in conn.execute("PRAGMA seed.table_info(examples)")}
        if "sentence_zh" not in seed_cols:
            return
        # 老种子库可能没有 zh_source 列：有则同步，无则默认 'mt'
        if "zh_source" in seed_cols:
            set_clause = ("sentence_zh = (SELECT s.sentence_zh FROM seed.examples s WHERE s.id = examples.id),"
                          " zh_source = COALESCE((SELECT s.zh_source FROM seed.examples s WHERE s.id = examples.id), 'mt')")
        else:
            set_clause = ("sentence_zh = (SELECT s.sentence_zh FROM seed.examples s WHERE s.id = examples.id),"
                          " zh_source = 'mt'")
        conn.execute(f"""
            UPDATE examples
            SET {set_clause}
            WHERE (sentence_zh IS NULL OR sentence_zh = '')
              AND EXISTS (SELECT 1 FROM seed.examples s
                          WHERE s.id = examples.id AND s.sentence_zh IS NOT NULL AND s.sentence_zh != '')
        """)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.execute("DETACH seed")


def _migrate_fsrs_columns(conn: sqlite3.Connection) -> None:
    """v0.3: user_words 加 FSRS 状态列, 老数据给合理初值 (幂等)。

    difficulty = clamp(5 + (2.5 - easiness) * 3, 1, 10)   # SM-2 越简单 → FSRS 越不难
    有复习记录的老卡 → Review 态, stability ≈ max(interval, 1)
    新卡/未开始 → Learning 态, stability/difficulty 置空由 FSRS 首评初始化
    """
    cols = _column_names(conn, "user_words")
    for col, ddl in (
        ("fsrs_stability", "REAL"),
        ("fsrs_difficulty", "REAL"),
        ("fsrs_state", "INTEGER"),
        ("fsrs_step", "INTEGER"),
        ("fsrs_last_review", "TEXT"),
    ):
        if col not in cols:
            conn.execute(f"ALTER TABLE user_words ADD COLUMN {col} {ddl}")
    rows = conn.execute(
        """SELECT user_id, word_id, easiness, interval, repetitions
           FROM user_words WHERE fsrs_state IS NULL"""
    ).fetchall()
    for user_id, word_id, easiness, interval, repetitions in rows:
        e = 2.5 if easiness is None else float(easiness)
        difficulty = max(1.0, min(10.0, 5.0 + (2.5 - e) * 3.0))
        if (repetitions or 0) > 0:
            state, stability = 2, max(float(interval or 0), 1.0)  # Review
        else:
            state, stability = 1, None  # Learning: 首评时初始化
        conn.execute(
            """UPDATE user_words SET fsrs_difficulty=?, fsrs_stability=?,
                      fsrs_state=?, fsrs_step=0
               WHERE user_id=? AND word_id=?""",
            (difficulty, stability, state, user_id, word_id),
        )


def _migrate(conn: sqlite3.Connection) -> None:
    """幂等迁移: 给已存在数据库补列/补表, 重复运行不报错。"""
    _import_vocab_tables(conn)
    if "lang" not in _column_names(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'zh'")
    conn.execute("UPDATE users SET lang='zh' WHERE lang IS NULL OR lang=''")
    if "daily_goal" not in _column_names(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN daily_goal INTEGER DEFAULT 30")
    conn.execute("UPDATE users SET daily_goal=30 WHERE daily_goal IS NULL OR daily_goal < 1 OR daily_goal > 200")
    if "zh_source" not in _column_names(conn, "words"):
        conn.execute("ALTER TABLE words ADD COLUMN zh_source TEXT")
    _migrate_fsrs_columns(conn)
    _import_books(conn)
    _backfill_zh(conn)
    _backfill_example_zh(conn)


def init_db(data_dir: str | None = None) -> str:
    data_dir = data_dir or os.environ.get("DATA_DIR", "/data")
    os.makedirs(data_dir, exist_ok=True)
    db_path = os.path.join(data_dir, "app.db")

    if not os.path.exists(db_path):
        seed = find_seed_db()
        if seed is None:
            raise FileNotFoundError("seed db not found; checked SEED_DB and default locations")
        shutil.copy2(seed, db_path)

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(APP_TABLES)
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
    return db_path


if __name__ == "__main__":
    print(init_db())
