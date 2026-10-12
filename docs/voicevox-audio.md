# No.7 单词与例句音频：VPS A 生成，VPS B 播放

VPS A（4 核 24GB）运行 VOICEVOX，VPS B（语屿项目服务器）只保存、播放 MP3。
不在 B 安装合成引擎；不使用 Gemini，不传输用户数据库，不把音频提交到 Git。

默认声线 `No.7 / ノーマル`，style ID **29**，不是 7。脚本会向 `/speakers` 核实角色和声线。
使用当前种子库：10,641 个词条 + 18,191 条例句/关联表达，重复句子去重后生成 17,756 份句子音频。
单词用 `kana`，例句用完整 `sentence_ja`，文件分别放在 `words/`、`examples/`。
句子文件名采用内容 SHA-256，词库调整 ID 后也不会播放到别的句子。

## VPS A：准备引擎

以下是新建的生成工作目录 `/opt/yuyu-audio-build`，不是猜测现有项目安装目录。
首次执行前需要已安装 Docker。

```bash
sudo apt-get update && sudo apt-get install -y ffmpeg git python3
docker run -d --name yuyu-voicevox-no7 --restart unless-stopped \
  -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-latest
```

镜像下载与启动结束后，确认引擎已就绪：

```bash
curl -fsS http://127.0.0.1:50021/speakers | python3 -c 'import json,sys; print([(s["name"],t["name"],t["id"]) for s in json.load(sys.stdin) if s["name"]=="No.7" for t in s["styles"]])'
```

应看到 `No.7`、`ノーマル`、`29`。如果同名容器已存在，改用 `docker start yuyu-voicevox-no7`。
该 API 仅绑定本机地址，不需要开放 50021 防火墙端口。

## VPS A：下载代码并生成

```bash
git clone --branch feat/anime-archipelago --single-branch \
  https://github.com/xingxinghuisi/yuyu-app.git /opt/yuyu-audio-build
cd /opt/yuyu-audio-build
```

如果这个生成目录已经克隆过，进入该目录后执行 `git pull --ff-only origin feat/anime-archipelago`。
先生成每类 3 个文件检查引擎和 ffmpeg（不是完整音频包）：

```bash
python3 tools/gen_audio_voicevox.py --limit 3 --workers 2
```

全量后台生成，同时生成最终传输包：

```bash
nohup python3 -u tools/gen_audio_voicevox.py \
  --workers 2 --package /opt/yuyu-audio-build/data/yuyu-no7-audio.tar.gz \
  > /opt/yuyu-audio-build/data/no7-generation.log 2>&1 < /dev/null &
echo "GENERATION_PID=$!"
```

查看进度（Ctrl+C 只退出日志查看，不终止后台生成）：

```bash
tail -n 20 /opt/yuyu-audio-build/data/no7-generation.log
```

只有看到 **`PACKAGE_READY=...` 和最后的 `AUDIO_OK`** 才表示完整生成、校验、打包成功。
不能仅凭后台 PID 或进程退出判断成功。失败会以非零状态退出；修复后重跑同一条命令可续跑。
脚本验证文字、文件大小与 SHA-256 后才跳过已有 MP3，不会将旧声线当作新音频。
默认 2 并发、单个音频失败最多 3 次；每 50 个文件保存进度。
实际耗时以采样和日志速度为准，例句比单词更长，不承诺固定小时数。
CPU 合成通常受 CPU 限制，24GB 内存不会让速度按内存容量成倍提升。

需要重新校验/打包时，不必运行引擎：

```bash
python3 tools/gen_audio_voicevox.py --verify-only \
  --package /opt/yuyu-audio-build/data/yuyu-no7-audio.tar.gz
```

## VPS A → VPS B：传输完整音频包

在 A 执行（B 为语屿域名对应服务器，SSH 使用 root 和默认 22 端口）：

```bash
scp /opt/yuyu-audio-build/data/yuyu-no7-audio.tar.gz root@yuyu.wyao.cc:/tmp/yuyu-no7-audio.tar.gz
```

需要时在终端输入 B 的 SSH 密码，不把密码或私钥放进命令、聊天或仓库。
SSH 首次连接时核对主机指纹；不关闭主机密钥检查。

## VPS B：更新代码并安装音频

先找实际 Compose 工作目录和数据挂载目录，不沿用文档旧版本的 `/www/wwwroot/yuyu-app` 示例。

```bash
docker ps -q --filter label=com.docker.compose.service=yuyu | \
  xargs -r docker inspect --format '{{.Name}} project={{index .Config.Labels "com.docker.compose.project.working_dir"}} {{range .Mounts}}{{if eq .Destination "/data"}}data={{.Source}}{{end}}{{end}}'
```

核实输出后，设置实际路径：

```bash
PROJECT_DIR='/实际输出的项目目录'
DATA_DIR='/实际输出的data目录'
cd "$PROJECT_DIR" &&
git pull --ff-only origin feat/anime-archipelago &&
docker compose up -d --build yuyu &&
python3 tools/install_voicevox_audio.py /tmp/yuyu-no7-audio.tar.gz --data-dir "$DATA_DIR"
```

安装脚本会检查当前 `app.db` 的词汇/例句是否与音频包一致，并验证完整性。
仅提取受限的常规文件，不接受目录穿越、符号链接、重复条目或过大文件。
音频存放在现有 `/data` 挂载卷中的 `audio/voicevox/releases/`，无需 COPY 到镜像。
全部校验通过后原子切换 `active.json`；导入失败时继续使用原来的音频。
旧音频包保留，可恢复 `active.json` 中的 `previous_release`；移走 `active.json` 则恢复旧播放路径。
不修改 `app.db`、学习进度、收藏或账户。生成包本身不含数据库。

播放路径：

- 单词：`/api/audio/{word_id}.mp3`，兼容旧词条别名。
- 例句：词汇 API 返回 `examples[].audio_url`，在新词、复习、词条详解中点击「播放例句」。
- 已安装的 No.7 优先；单词缺失时回退原词库录音和旧合成文件；例句未就绪或播放失败时回退系统 TTS。
- 所有音频尊重现有语速设置。前端版本升级至 v1.3.2，API 音频不进入 Service Worker 缓存。
- HTTP `X-Audio-Source: voicevox-no7` 表示正在播放新音频；`Cache-Control: no-cache` 允许切包后重新核验。

安装后从 API 获取一个例句地址进行核验：

```bash
EXAMPLE_PATH=$(curl -fsS 'http://127.0.0.1:8000/api/vocab?level=N5&limit=20' | \
  python3 -c 'import json,sys; print(next(w["examples"][0]["audio_url"] for w in json.load(sys.stdin) if w["examples"]))')
curl -fsS -D - -o /dev/null "http://127.0.0.1:8000$EXAMPLE_PATH"
```

也可直接在网页「我的 → 发音设置」试听单词，再进入词条详解试听例句。
如果反向代理另有音频长缓存规则，需要让 `/api/audio/` 尊重上游 Cache-Control。
生成完成后 A 的引擎可停止以节省资源：`docker stop yuyu-voicevox-no7`。

## 来源与署名

音频为 **合成语音**，不是 No.7 真人录制。
应用关于页保留 `VOICEVOX:No.7` 署名。No.7 个人非商业使用可按官方条款使用；其他商业用途需向制作委员会事先确认。

- [No.7 官方介绍](https://voicevox.hiroshiba.jp/product/number_seven/)
- [官方声线编号与许可摘要](https://github.com/VOICEVOX/voicevox_vvm/blob/main/README.md)
- [No.7 使用条款](https://voiceseven.com/#j0200)

验证：`python -m unittest discover -s tests -p test_voicevox_audio.py -v`；
`node --test tests/audio-playback.test.cjs tests/map-sw.test.cjs`。
本地验证使用临时数据库与测试音频字节，不调用实际引擎；真实音质由 A 生成后试听确认。
