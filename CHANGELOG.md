# 变更记录

> 版本号以 `package.json` 为准，每个发布版本对应一个 `vX.Y.Z` tag。安装方可以锁 `git+https://github.com/Homer4033/dsh-compression-tiers.git#v1.3.1`。

## 1.4.1 — 2026-11-19

- **面板不再有隐式仓库**：列表为空就是空面板，不会再自动出现插件自己的检出目录（之前那份兜底确实容易让人以为「没填路径也能推」）。github.repos 只装你显式添加的仓库。
- 「默认仓库」只服务设置页那一节和单仓库动作；设置页推送现在显式带上它自己的路径。

## 1.4.0 — 2026-11-18

- **左侧栏「仓库」面板**（`sidebar.panellist` id `compression-repos` + `main`）：每个仓库独立成行，各自推送；多个 agent 同时推不同仓库时不再互相覆盖全局路径。
- `github.repos`：绝对路径数组，按平台去重；列表为空时回落到插件自己的检出目录。设置页那一项改为「默认仓库」，只作兜底。
- 新增 `GET /api/github/repos`；`configure` 接受 `repos` 数组并校验目录存在；`push` / `create` / `view` 接受 `repo` 参数，且只接受配置列表内的路径（否则 400）。
- 面板沿用密钥扫描：命中即阻止，行下会出现「仍然推送」按钮（带 `force`，只作用于该仓库）。

## 1.3.1 — 2026-11-18

- **推送前密钥扫描**：`scanSecrets` 检查将被发布的文件——文件名（`.env`、`keys.json`、`*token*.txt`、`*.pem`、`id_rsa`）和内容（GitHub / OpenAI / AWS / Slack 令牌、私钥头、`token = "…"` 这类赋值）。命中时设置页阻止推送并列出 `文件:行`，人工确认后可以「仍然推送」。
- `npm run check:secrets` 与 CI 复用同一扫描，终端里的推送也能在 CI 被拦下。
- CI 覆盖 Windows 与 Linux（前者是主要开发平台）。
- 发布规范：补本文件，按版本打 tag。

## 1.3.0 — 2026-11-18

- **网络体检**：DNS、直连 443、对 `https://github.com/` 的 HEAD、代理端口分层探测，结论为 `direct` / `proxy` / `proxy-dead` / `blocked`。只有 HTTPS 成功才算可达——被污染的解析结果照样能完成 TCP 握手。
- **代理**：优先级为显式设置 → git `http.proxy` → 系统代理；push 时用 `-c http.proxy=…` 注入，不改全局配置。
- **推送看门狗**：60 秒硬超时，超时结束整棵进程树（`taskkill /T /F`），并设 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`；失败按 DNS / 网络代理 / 认证 / 非快进 / 仓库不存在分类，回带未推提交列表。
- **仓库**：快照（本地/远端 HEAD、待推、未提交）、路径可配置、建仓（默认私有，需二次确认）、`gh repo view`。
- **认证**：`gh auth status --json hosts` 读取 scopes，缺 `repo` scope 时提前提示。

## 1.2.1 — 2026-11-18

- 把 `@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-tools` 声明为可选 `peerDependencies`：以本地目录链接（linked root）方式安装时，DSH 的解析层靠 peer 声明把宿主导入路由到运行时实现；缺声明会导致 Host 半区导入失败、插件不激活。

## 1.2.0 — 2026-11-18

- 合并 GitHub CLI 管理：固定 `gh 2.76.2`、断点续传下载、解压后探测暂存副本再原子替换（失败回滚）、PATH 检测与托管插前、`gh auth login --web` 设备码登录；新增 `/compression-tiers/api/github` 与 `/auth` 路由和设置页面板。

## 1.1.1 — 2026-11-17

- 设置页文案精简：档位说明改为一句话，删除主动压缩说明段，规则面板文案缩短。

## 1.1.0 — 2026-11-17

- 合并全局规则编辑：`src/rules.js` 与 `/compression-tiers/api/rules`，设置页规则面板，系统提示带最新 2,000 字符摘要；`src/store.js` 增加原子文本写入。

## 1.0.0 — 2026-11-17

- 从 `homerdsh-workbench` 拆出的独立插件：五档上下文压缩、`compression_tiers` / `compression_context` / `compression_compact` 三个工具、把档位同步进预设隔离域的 `compaction-basic` 引擎、设置页。
