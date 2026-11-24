# 更新簿数据源

为更新簿微信小程序提供公开的 AI 产品更新和中文导读。每条记录有发布日期、官方链接和导读来源。

GitHub Actions 每小时第 17 分钟检查 OpenAI 的 Codex CLI 正式发行版和 DeepSeek API 的官方更新日志。新增或修改的记录由 Qwen3-4B 在本次运行的 Ubuntu 机器上生成中文导读。首次收录的一批记录附有编辑核对的导读。模型暂时不可用时，中文来源先展示官方摘录，英文来源显示待补充，并于后续采集重试。

采集器每次检查每个来源最近的 6 条，保留最多 200 条历史。单个来源中断时沿用旧记录。两个来源都中断时保留上次发布版本。Actions 同时只运行一轮，每次最多生成 8 条新导读。

只读接口位于本仓库 GitHub Pages 地址下的 `feed.json`。同一份公开数据也写进仓库根目录，供小程序通过 GitHub API 或 jsDelivr 备用线路读取。可以在 Actions 手动运行“更新官方日志和中文导读”，查看采集日志和 Pages 发布结果。

- `node --test test.mjs` 运行回归测试。
- `node run.mjs` 在本地更新 `state.json` 并生成 `site/feed.json`。本地也可通过 `NOTEBOOK_MODEL_URL` 和 `NOTEBOOK_MODEL_NAME` 连接兼容的模型服务。
- 云端按需从官方发行版下载模型与 llama.cpp，使用固定版本和 SHA-256 校验。模型只在本机回环地址监听，运行结束后退出。

[Codex CLI 官方发行页](https://github.com/openai/codex/releases) · [DeepSeek 官方更新日志](https://api-docs.deepseek.com/zh-cn/updates/) · [模型仓库](https://huggingface.co/Qwen/Qwen3-4B-GGUF)
