#!/usr/bin/env python3
"""
批量生成单词发音 MP3（VOICEVOX 真人语音）

VPS 运行步骤：
  1. 启动 VOICEVOX（约 1-2GB 内存，首次拉镜像较慢）：
     docker run -d --name voicevox --restart unless-stopped \
       -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-latest
     # 验证：curl http://127.0.0.1:50021/speakers | head -c 200

  2. 安装 ffmpeg：
     apt update && apt install -y ffmpeg

  3. 后台批量生成（14445 词约需数小时，170MB）：
     cd /www/wwwroot/yuyu-app
     nohup python3 tools/gen_audio_voicevox.py \
       --db backend/data/seed/yuyu-vocab.db \
       --out backend/data/audio \
       --workers 2 > /tmp/gen_audio.log 2>&1 &
     # 看进度：tail -f /tmp/gen_audio.log

  4. 验证后重建 app 容器（Dockerfile 会 COPY 音频目录）：
     docker compose up -d --build

说明：
- 用 word_id 命名避免文件名编码问题：backend/data/audio/{word_id}.mp3
- 断点续跑：已存在的 mp3 自动跳过，可随时 Ctrl+C 中断后重跑
- 默认 2 并发，别打爆 VPS；失败自动重试 3 次
"""
import argparse
import concurrent.futures
import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:50021"
# 四国めたん ノーマル：标准清晰女声，适合背词；ずんだもん=3 偏角色音
DEFAULT_SPEAKER = 2


def synth_one(base_url: str, speaker: int, text: str, timeout: int = 60) -> bytes:
    """调用 VOICEVOX 生成 WAV 字节（audio_query -> synthesis 两步）。"""
    qs = urllib.parse.urlencode({"speaker": speaker, "text": text})
    req = urllib.request.Request(
        f"{base_url}/audio_query?{qs}", method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, data=b"{}", timeout=timeout) as r:
        query = json.loads(r.read().decode("utf-8"))
    data = json.dumps(query).encode("utf-8")
    req2 = urllib.request.Request(
        f"{base_url}/synthesis?speaker={speaker}", data=data, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req2, timeout=timeout) as r2:
        return r2.read()


def wav_to_mp3(wav_bytes: bytes) -> bytes:
    """ffmpeg 转 64kbps 单声道 MP3（stdin -> stdout）。"""
    p = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", "24000", "-b:a", "64k", "-f", "mp3", "pipe:1"],
        input=wav_bytes, capture_output=True, timeout=120,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError(f"ffmpeg failed: {p.stderr.decode()[:200]}")
    return p.stdout


def gen_word(base_url, speaker, word_id, kana, out_dir, retries=3):
    mp3_path = os.path.join(out_dir, f"{word_id}.mp3")
    if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 0:
        return "skip"
    last_err = None
    for _ in range(retries):
        try:
            wav = synth_one(base_url, speaker, kana)
            mp3 = wav_to_mp3(wav)
            tmp = mp3_path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(mp3)
            os.replace(tmp, mp3_path)
            return "ok"
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2)
    return f"fail: {last_err}"


def main():
    ap = argparse.ArgumentParser(description="VOICEVOX 批量生成单词 MP3")
    ap.add_argument("--db", default="backend/data/seed/yuyu-vocab.db", help="种子库路径")
    ap.add_argument("--out", default="backend/data/audio", help="MP3 输出目录")
    ap.add_argument("--voicevox-url", default=DEFAULT_URL)
    ap.add_argument("--speaker", type=int, default=DEFAULT_SPEAKER,
                    help="style_id（2=四国めたん/女，3=ずんだもん/女，8=春日部つむぎ/女）")
    ap.add_argument("--workers", type=int, default=2, help="并发数")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个（测试用）")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    conn = sqlite3.connect(args.db)
    rows = conn.execute("SELECT id, kana FROM words ORDER BY id").fetchall()
    conn.close()
    if args.limit:
        rows = rows[: args.limit]
    total = len(rows)
    print(f"[gen_audio] {total} words, speaker={args.speaker}, workers={args.workers}", flush=True)

    # 先 ping 一下 VOICEVOX
    try:
        with urllib.request.urlopen(f"{args.voicevox_url}/speakers", timeout=10) as r:
            print(f"[gen_audio] voicevox ok ({len(r.read())} bytes speakers)", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[gen_audio] FATAL: voicevox 不可达 {args.voicevox_url}: {e}", flush=True)
        sys.exit(1)

    done = ok = skip = fail = 0
    lock = threading.Lock()
    t0 = time.time()

    def task(row):
        return row[0], gen_word(args.voicevox_url, args.speaker, row[0], row[1], args.out)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for wid, res in ex.map(task, rows):
            with lock:
                done += 1
                if res == "ok":
                    ok += 1
                elif res == "skip":
                    skip += 1
                else:
                    fail += 1
                    print(f"[gen_audio] {wid} {res}", flush=True)
            if done % 100 == 0 or done == total:
                el = time.time() - t0
                print(f"[gen_audio] {done}/{total} ok={ok} skip={skip} fail={fail} "
                      f"{el:.0f}s ({done / max(el, 1):.1f}/s)", flush=True)

    print(f"[gen_audio] DONE ok={ok} skip={skip} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
