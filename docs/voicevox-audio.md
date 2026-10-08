# v0.7 VOICEVOX 真人发音部署指南

用 VOICEVOX（日本开源免费 TTS）批量生成 14445 个单词的真人女声 MP3，
实现全平台统一发音。音频约 170MB，存 VPS 本地，不进 git。

## 1. 启动 VOICEVOX（VPS 上执行）

```bash
# 拉镜像（约 1GB，首次较慢）并启动，CPU 版
docker run -d --name voicevox --restart unless-stopped \
  -p 127.0.0.1:50021:50021 \
  voicevox/voicevox_engine:cpu-latest

# 验证（返回 speakers JSON 即正常）
curl -s http://127.0.0.1:50021/speakers | head -c 200
```

发音人（style_id，可用 `/speakers` 查询）：
| id | 发音人 | 说明 |
|----|--------|------|
| 2 | 四国めたん ノーマル | 默认。标准清晰女声，适合背词 |
| 3 | ずんだもん ノーマル | 偏角色音 |
| 8 | 春日部つむぎ ノーマル | 温柔女声 |

## 2. 装 ffmpeg

```bash
apt update && apt install -y ffmpeg
```

## 3. 批量生成（后台跑，约数小时）

```bash
cd /www/wwwroot/yuyu-app

# 先小批量测试 5 个
python3 tools/gen_audio_voicevox.py --limit 5 --out backend/data/audio
ls -la backend/data/audio/*.mp3   # 确认有文件且可播放

# 全量后台跑（2 并发，断点续跑，可随时中断重跑）
nohup python3 tools/gen_audio_voicevox.py \
  --out backend/data/audio \
  --workers 2 > /tmp/gen_audio.log 2>&1 &

# 看进度
tail -f /tmp/gen_audio.log
# 查数量
ls backend/data/audio/*.mp3 | wc -l   # 目标 14445
```

脚本参数：
- `--voicevox-url`：默认 `http://127.0.0.1:50021`
- `--speaker`：发音人 id，默认 2
- `--workers`：并发数，默认 2（VPS 配置低就改 1）
- `--limit N`：只处理前 N 个（测试用）
- `--db`：种子库路径，默认 `backend/data/seed/yuyu-vocab.db`

## 4. 重建 app 容器

```bash
cd /www/wwwroot/yuyu-app
git pull
docker compose up -d --build
```

Dockerfile 会把 `backend/data/audio/` COPY 进镜像。
验证：`curl -sI https://yuyu.wyao.cc/api/audio/<任意word_id>.mp3`
应返回 `200` + `audio/mpeg`；不存在的 id 返回 404（前端自动回退浏览器 TTS）。

## 5. 可选：停掉 VOICEVOX

生成完就不需要了，省内存：

```bash
docker stop voicevox && docker rm voicevox
```

## 注意事项

- 音频目录通过 `AUDIO_DIR` 环境变量配置，默认 `backend/data/audio`
- 前端 `speak()` 优先播 MP3，404/失败时自动回退浏览器 TTS（"我的"页发音设置保留）
- 170MB 音频不进 git（.gitignore 已配），换机器部署需重新生成
- 新增单词后，单独跑脚本即可补音频（已存在的自动跳过）
