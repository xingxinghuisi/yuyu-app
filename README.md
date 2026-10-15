# 语屿 KOTOBA

每天十五分钟，筑一座日语之岛。

面向中国学习者的日语背词 / JLPT 备考 App（当前为可安装的 PWA，原生 iOS 版规划中）。

## 技术栈

- 后端：FastAPI + SQLite，JWT 登录
- 前端：原生 HTML / CSS / JS（无构建步骤），Liquid Glass 风格 PWA
- 记忆算法：FSRS（`py-fsrs`）
- 部署：单 Docker 容器，`docker compose up -d --build`

## 本地运行

```bash
cp .env.example .env   # 填入 JWT_SECRET
docker compose up -d --build
curl http://127.0.0.1:8000/api/health
```

冒烟测试：`python3 smoke_test.py`

## 学习与个人考试

- 同一账号在当前浏览器中退出或刷新后，再选同一本词书会继续原学习批次，保留单词顺序、当前位置和已作答状态。进度不会跨设备同步；每次学习词数的新设置从下一批生效。
- 底栏提供「考试」入口，支持私人试卷、听力播放、续考和交卷回顾。资料与考试记录放在持久化 `data/` 中，不随源码发布；部署后需单独配置资料所有者并导入试卷，见 [个人考试说明](docs/personal-exams.md)。

## 词库

N5–N1 词汇、例句、汉字种子库位于 `backend/data/seed/`（数据源：OpenJLPT / JMdict，CC BY-SA 4.0，署名见 `ATTRIBUTION.md`）。

## License

应用代码 MIT；词库数据遵循其各自来源协议（CC BY-SA 4.0）。
