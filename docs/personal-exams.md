# 个人考试

## v1.5.0：文字试卷与私人批量安装

考试页按 N1/N2、年份、月份选择，记忆上次选择，并只请求当前试卷的历史记录。文字题、带下划线的题干、四个编号选项、共用阅读文章和表格直接显示；「原卷对照」保留原图。听力使用整条原录音，恢复播放位置；逐题时间点仍需另行核对。

题目支持 `reference` 与 `withheld` 两种批改状态。待核对题可以作答，结果显示「暂不计分」，从正确率、计分题数和错题筛选中排除；全部待核对时正确率为空。参考答案来自用户提供资料，原始正确率不是 JLPT 官方量尺分。交卷前不返回正确答案、解析、资料备注或听力原文。

每次考试固定题库版本。更新同一套试卷后，旧考试仍使用开始时的题目、答案与音频；默认继续最近一次未交卷记录。旧版无版本号的记录必须在替换旧 `exam.json` **之前**保存快照。安装器执行该迁移，并先使用 SQLite backup API 备份记录；旧媒体文件保留。

`scripts/prepare-exam-library.py` 将来源可追溯的私有整理稿转换为 v2 题库、媒体生成计划和 SHA256 清单，不上传云端。Git 仓库仅提供通用程序，不包含整理稿或试卷内容。

`scripts/install-exam-library.py` 为独立离线安装器，依赖 `pypdfium2==5.14.0`、`Pillow==12.3.0`。默认只校验；PDF、MP3、题库清单、页码和所有引用通过检查后，才可显式安装。读取权限、校验失败或所有者不符时中止。图片按源文件哈希和渲染参数缓存，重复执行复用已完成工作。`--data-dir` 指应用的 DATA_DIR，题库默认安装到其 `private-exams/` 子目录；设置 PRIVATE_EXAMS_DIR 时传 `--library-dir`。

```bash
# 原资料与应用同一台机器：先检查，再安装。
python install-exam-library.py --bundle library --source-root /path/to/source --data-dir /path/to/app/data --owner YOUR_APP_USERNAME --dry-run
python install-exam-library.py --bundle library --source-root /path/to/source --data-dir /path/to/app/data --owner YOUR_APP_USERNAME --install

# 处理 VPS 与网站服务器不同时：先生成私人媒体目录，转移后再发布。
python install-exam-library.py --bundle library --source-root /path/to/source --build-only --build-output /path/to/ready
python install-exam-library.py --bundle library --ready-root /path/to/ready --data-dir /path/to/app/data --install
```

已有 `access.json` 时沿用所有者，可省略 `--owner`。首次安装需使用网站登录用户名。媒体生成结果包含 `ready-manifest.json`，不含访问配置或考试记录；发布前验证文件哈希。已有原卷图像试卷继续兼容。

验证：12 项真实后端测试覆盖权限、续答、严格选项校验、交卷、排除计分、截止时间、并发开始及版本快照。安装器测试使用真实 PDF 渲染，验证备份迁移、重复安装、跨机器媒体发布、源哈希不符和路径越界。新浏览器测试在 390px/1280px 使用独立 HTTP API/媒体夹具，验证级别/年份选择、文字材料、待核对计分展示、保存失败恢复、旧图片题和固定听力控制栏；夹具测试不代表 OCR 全文准确率。

## v1.4.0 原卷图像样版

入口：底栏「探索 / 学习 / 复习 / 考试 / 我的」中的考试 Tab；我的页不再放考试入口。v1.4.0 发布程序代码；个人 PDF、音频、扫描图、答案、OCR 草稿与考试记录均保存在根目录 `data/`，该目录已被 `.gitignore` 和 `.dockerignore` 排除，不随 GitHub 源码或 Release 分发。

## 这一版

- 原卷图像答题：前 47 题按题裁切；篇章语法与阅读保留共用材料和跨页图像。听力有纸面选项的题按题裁切，其中双列选项依原序排为四行，2-5 的跨页选项单独展示。点按图片可全屏放大；原卷缩放支持 50%–400%，滑杆或输入数值，并按试卷/分区记忆。下划线、排序星号、表格与注音保持原样。
- 文字/词汇/语法/阅读与听力分开练习或计时；N2 分区用时按 [JLPT 官方说明](https://www.jlpt.jp/cn/guideline/testsections.html) 配置为 105 和 50 分钟。
- 点击答题卡跳题、待检查标记、清除答案、保存进度、刷新恢复、完整录音播放和播放位置恢复。
- 听力页的答案及上一题/下一题栏固定于视口，录音播放器吸顶；切题保持页面位置与音频播放，答题卡跳题则回到题目位置。题图独立滚动，避免整页扫描图导致反复下滑。
- 每套试卷的每个分区默认仅展示最近一次记录；未交卷时默认续答，不重置题号、答案、听力位置、模式或截止时间。显式「重新开始」才创建新考试。旧记录保留，兼容原有直接链接；列表不再重复展示。服务端用事务防止连续点击或并发请求创建重复进度。
- 交卷后服务端按上传的参考答案批改，显示正确率、未答数、错题筛选与对应解析/听力原文。没有将正确率折算成官方量尺分。
- 计时考试由服务端保存截止时间；退出或刷新不会暂停，截止后不能补答。

这是原卷图像版本，不是已经全文校对完成的可检索文字题库。OCR 只辅助题号定位；参考答案从扫描答案表人工核对录入。第一轮视觉检查修正了跨页第 10 题与 OCR 未识别的第 39 题边界。

听力使用完整原录音；尚未提供逐题切片或逐句字幕。提供资料的标题、年月按用户文件记录，未宣称经过主办方原卷认证。

## 资料与权限

目录结构：

```
data/private-exams/
  access.json                 # {"owner_username": "你的语屿用户名"}
  attempts.sqlite3            # 个人考试记录
  jlpt-n2-2026-07/
    exam.json                 # 题号、参考答案、图片/解析页对应及源文件 SHA256
    source/                   # paper.pdf / answers.pdf / listening.mp3
    assets/                   # paper/ / answers/ / questions/
    import/                   # 本地 OCR 与人工核对的 spec；不由 API 提供
```

所有试卷 API 要求已登录且用户名与 `access.json` 的所有者完全一致。没有配置所有者时默认拒绝访问。更改用户名后需要同步更新该配置。

题图和音频通过专用 API 提供，不挂载成公共静态文件。媒体使用短期、HttpOnly、SameSite=Strict 的认证 Cookie，音频支持 HTTP Range。解析图必须有关联的已交卷记录才能读取。API 和媒体响应为 `private, no-store`，Service Worker 排除所有 `/api/`。

程序允许环境变量 `PRIVATE_EXAMS_DIR` 覆盖资料目录，默认是 `DATA_DIR/private-exams`。本机样版使用隔离的 `data/exam-preview/app.db` 和独立预览账号 `exam_preview`；不影响原学习进度。仅本机的预览启动器放在忽略的 `.runtime/`，不会部署到 VPS。

## 后续导入

`scripts/import-private-exam.py` 接收经过核对的私有 spec JSON、题册、答案 PDF、MP3 与所有者用户名。导入电脑需要 `pypdfium2`、`Pillow`；线上运行只使用已生成的图片和 JSON，不需要 OCR/PDF 依赖。

```
python scripts/import-private-exam.py --spec reviewed-spec.json --paper paper.pdf --answers answers.pdf --audio listening.mp3 --owner YOUR_USERNAME --data-dir data
```

spec 的 `sections` 定义分区、题数、分钟；`questions` 定义唯一 ID、分区、原题号、题型、选项数、正确选项、题图列表、解析页；可选 `crops` 按源页像素区域生成题图。导入器检查题数、重复题号、答案范围、解析页、图片缺失和裁切越界，并记录源文件 SHA256。未核对的 OCR 结果不能直接替代这个 spec。

`scripts/ocr-private-exam.cjs` 使用本机 Tesseract 语言模型生成辅助文本/坐标；不会上传试卷。模型与 OCR 输出也放在 `data/`。后续私有仓库或网盘资料下载到同类目录后，按等级和年月逐套核对导入；不要把私有资料放进 `frontend/`、种子库或 Release 附件。

## 验证

- `tests/test_private_exams.py`：所有者权限、匿名及其他账号拒绝、交卷前答案/解析不泄露、Cookie 注销、HTTP Range、严格选项校验、原子保存、恢复进度、漏答计分、交卷不可修改、服务端截止时间、默认续答保留截止时间、显式重开与最近记录、过期考试结算后再开始。
- `tests/private-exams-browser.cjs`：本机 Chrome 390px/1280px，实际 API 和本套私有资料；选择/标记/刷新恢复、保存失败重试恢复、原图放大、保留阅读表格、交卷结果、错题筛选、30 个听力作答项、3 选项听力题、末段双小问、录音实际播放与位置恢复；逐个验证全部 101 个答案位置的批改映射。
- `tests/map-sw.test.cjs`：包括个人题图/音频的 `/api/` 请求不进入 SW 缓存。

2026-10-13 的交互修订另验证五个 Tab 顺序与高亮、听力 2-4 → 2-5 页位置和固定栏位置不变、页面滚动时操作栏仍固定、225%/275% 缩放与刷新记忆、退出后直接继续同一条进度。该轮 UI 验证使用独立的本机 8771 服务和 `data/exam-ui-tests/`，不写入用户在 8770 预览中的考试记录。

本套资料：题册 18 页，答案解析及听力原文 26 页；71 + 30 = 101 个作答项；音频经浏览器读取时长约 47 分 06 秒。批改映射测试通过不代表每一题参考答案都经过语言专家复审。

## 本地批量 OCR 与答案表校验（2026-10-14）

独立 OCR 工具的整批结果已完成 18 + 26 页，失败文件为 0。OCR 的疑点数量按文字行统计，不是错题数量；原卷图像答题无需先逐行校对全文。整页文字识别不适合直接解析有格线的答案表。

`scripts/extract-private-exam-answer-grid.py` 针对具有矩形格线、题号/答案交替行的扫描答案表，检测单元格并对齐题号，保留合并题号格对应多个作答项的关系。按单元格去除边框后，将数字集中识别；两种语言模型结果不一致时，对单格使用两种分割模式重读。输出与已有 reviewed spec 对照，存在差异、重复、未知题号、答案越界或缺题时返回非零状态，不修改试卷和考试记录。

此适配器在本套资料的 14 个文字/阅读答案表和 5 个听力答案表上定位了全部 101 个答案位置。首轮 94 个一致；7 个疑难数字通过单格重读后，全部与现有参考答案映射一致。负例将第一题参考答案改成不同选项，检查器返回非零状态并精确报告该题差异。其他扫描排版需要单独验证，不能据此推断所有年份和等级都能自动准确提取。

本次经过核验的 spec、数字识别原图/坐标和报告保存在私有资料目录 `import/` 下。使用现有导入器在隔离的 `data/exam-import-staging/` 组装了完整图片试卷；检查了全部题图引用、解析页范围、分区题数、唯一题号与输入文件 SHA256。分区和判分映射与现有样版一致。没有覆盖用户的考试记录，没有发布线上；OCR 文字继续作为未全文校对的辅助草稿。
