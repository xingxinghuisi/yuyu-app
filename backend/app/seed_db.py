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
                  "sentence_zh", "tatoeba_id", "source")
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
    conn.execute(f"ATTACH DATABASE '{seed}' AS seed")
    try:
        if "words" in needed:
            conn.execute("""CREATE TABLE words (
                id TEXT PRIMARY KEY, kanji TEXT, kana TEXT NOT NULL, romaji TEXT,
                meaning_en TEXT NOT NULL, meaning_zh TEXT, pos TEXT, level TEXT NOT NULL,
                jmdict_id INTEGER, other_forms TEXT, other_readings TEXT,
                audio_url TEXT, mnemonic_zh TEXT, image_url TEXT,
                source TEXT NOT NULL DEFAULT 'openjlpt',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, zh_source TEXT)""")
            cols = ", ".join(_WORDS_COLS)
            conn.execute(f"INSERT INTO words ({cols}) SELECT {cols} FROM seed.words")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_words_level ON words(level)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_words_kana ON words(kana)")
        if "examples" in needed:
            conn.execute("""CREATE TABLE examples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_id TEXT NOT NULL REFERENCES words(id) ON DELETE CASCADE,
                sentence_ja TEXT NOT NULL, furigana TEXT, sentence_en TEXT,
                sentence_zh TEXT, tatoeba_id INTEGER,
                source TEXT NOT NULL DEFAULT 'tatoeba',
                UNIQUE(word_id, tatoeba_id))""")
            cols = ", ".join(_EXAMPLES_COLS)
            conn.execute(f"INSERT INTO examples ({cols}) SELECT {cols} FROM seed.examples")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_examples_word ON examples(word_id)")
        if "kanji" in needed:
            conn.execute("""CREATE TABLE kanji (
                character TEXT PRIMARY KEY, level TEXT, strokes INTEGER,
                onyomi TEXT, kunyomi TEXT, meanings TEXT, meaning_zh TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
            cols = ", ".join(_KANJI_COLS)
            conn.execute(f"INSERT INTO kanji ({cols}) SELECT {cols} FROM seed.kanji")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_kanji_level ON kanji(level)")
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
    if "zh_source" not in _column_names(conn, "words"):
        conn.execute("ALTER TABLE words ADD COLUMN zh_source TEXT")
    _migrate_fsrs_columns(conn)


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
