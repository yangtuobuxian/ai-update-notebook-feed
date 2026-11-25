# Now in AI 数据源

用微信扫描固定二维码，或直接打开网页，就能读到 AI 产品的官方更新和中文导读。每条记录有发布日期、官方链接和导读来源。[打开 Now in AI](https://yangtuobuxian.github.io/ai-update-notebook-feed/) · [保存二维码](https://yangtuobuxian.github.io/ai-update-notebook-feed/qr.png)

GitHub Actions 每小时第 17 分钟检查六个官方来源。Codex CLI、Claude Code 和 Ollama 取正式发行版，DeepSeek、智谱 GLM 和 Kimi 取中文更新日志。Kimi 按官方月份收录。新增或修改的记录由 Qwen3-4B 在本次运行的 Ubuntu 机器上生成中文导读。首批收录的部分版本附有与官方说明核对过的导读。模型暂时不可用时，中文来源先展示官方摘录，英文来源显示待补充，后续采集会重试。

采集器每次检查每个来源最近的 6 条，保留最多 200 条历史。单个来源中断时沿用旧记录。全部来源中断时保留上次发布版本。Actions 同时只运行一轮，每次最多生成 8 条新导读。

本仓库 GitHub Pages 下的 `edition-v2.json` 提供六个来源的更新。`edition.json` 保留原有四个来源，`feed.json` 为最早的客户端提供 Codex CLI 与 DeepSeek 的更新。三个文件同时写入仓库根目录，供 GitHub API 与 jsDelivr 备用线路读取。

- `node --test test.mjs` 运行回归测试。
- `node run.mjs` 在本地采集并生成 `site/`，其中包括网页成品、固定二维码和三份 JSON 数据。本地也可通过 `NOTEBOOK_MODEL_URL` 和 `NOTEBOOK_MODEL_NAME` 连接兼容的模型服务。
- 云端按需从官方发行版下载模型与 llama.cpp，使用固定版本和 SHA-256 校验。模型只在本机回环地址监听，运行结束后退出。

[Codex CLI 官方发行页](https://github.com/openai/codex/releases) · [DeepSeek 官方更新日志](https://api-docs.deepseek.com/zh-cn/updates/) · [模型仓库](https://huggingface.co/Qwen/Qwen3-4B-GGUF)
