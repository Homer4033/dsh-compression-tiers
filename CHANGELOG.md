# 变更记录

> 版本号以 `package.json` 为准，每个发布版本对应一个 `vX.Y.Z` tag。安装方可以锁 `git+https://github.com/Homer4033/dsh-compression-tiers.git#v1.6.3`。

## 1.6.3 — 2026-11-19

- 修复会话头胶囊**没有样式**的问题：样式表以前是作为设置页里的 `<style>` 渲染的，只有打开过设置页才生效，于是首屏的胶囊按 SVG 默认 300×150 撑爆了标签行。现在插件加载时就把 `style[data-compression-tiers]` 注入 `document.head`，卸载时移除；设置页不再自带 `<style>`。
- 测试：新增断言样式表在 `apply` 阶段注入且包含胶囊规则，设置页树里不再有 `<style>`。

## 1.6.2 — 2026-11-19

- 会话头的在线仓库选择器改成**标题下方 View 标签行右侧**的胶囊控件：仓库图标 +「仓库」标签 + 当前 `owner/name`（未绑定显示「未绑定」）+ 箭头；有绑定时用选中色描边，悬停/聚焦有反馈，长名字省略。官方 header 会裁剪标题旁的动作（`.titleCluster { overflow: clip }`），所以胶囊通过 React portal 挂到 `[data-conversation-tabs]` 所在行的末尾；没有标签行（少于两个 View）时退回标题旁内联显示。
- 原生 `<select>` 仍铺在胶囊上负责键盘与选择行为；原来的裸下拉与灰色提示文字被这层外观替换。

## 1.6.1 — 2026-11-19

- **包名改为 `dsh-harness-toolbox`**：功能已经不止压缩（全局规则、`gh` 管理、`github_push`、会话发布仓库、ffmpeg/ffprobe），旧名不再贴切。加载器行 id（`compression-tiers`）、状态目录、工具名都不变；bundle 名就是包名，所以升级要在插件页移除旧条目再添加本目录。
- **npm 发布改走暂存**：npm 已对 2FA-bypass token 关闭直接发布，`npm publish` 会被拒；改为 `npm stage publish`，再由维护者在 npmjs.com 的 Staged Packages 或 `npm stage approve <id>` 完成 2FA 审批。旧名下的 `0.0.0-stage` 占位版本不再使用。
- 音视频面板在状态还没读到时不再误报「当前系统没有托管版」，改为「读取中…」；只有平台确实没有托管源时才显示不可用。

## 1.6.0 — 2026-11-19

- **兼容新运行时**：`engines.dsh` 从钉死的 `0.2.2-rc.3` 放宽为 `>=0.2.2-rc.3 <0.3.0`，`0.2.2-rc.5` 不再报「不兼容」；用 Node 自带 semver 验证过 rc.3 / rc.5 满足、0.3.0 拒绝。
- **会话发布仓库**：会话标题右侧新增「仓库」选择器，按持久会话 id 把当前会话绑到某个在线仓库（`settings.json` 的 `sessionRepos`，最多 200 条）。绑定后 `github_push` 默认推到 `https://github.com/<owner/name>.git`——只换推送目标，不克隆、不切分支、不改工作区。列表来自 `GET /api/github/online`（`gh repo list --limit 100`，客户端缓存 5 分钟，未安装/未登录/网络不通分别说明），绑定接口是 `GET/POST /api/github/binding?session=…`。
- **音视频工具管理**：设置页新增「音视频工具」面板，检测 `ffmpeg` / `ffprobe`（托管版优先、再看 PATH），显示两者版本与路径；可从 gyan.dev 下载 Windows essentials 构建（约 110 MB，HTTP Range 断点续传、20 分钟超时），解压后先跑 `-version` 自检暂存副本再原子替换 `bin` 目录、失败回滚，最后插到本进程 PATH 最前。接口 `GET/POST /api/ffmpeg`。
- 新模块 `src/ffmpeg.js`；`src/gh.js` 增加 `listRepos` / `parseRepoList` 并把 `runCommand` / `extractArchive` 导出复用；`src/http.js` 增加 `queryParam`；`src/store.js` 增加 `sessionRepos` 归一化（`normalizeRepoName` / `normalizeSessionRepos`）；`src/push-flow.js` 的 `pushFlow` 新增 `target`（URL 作为远端时不取仓库快照）。
- 客户端：新增会话头 `conversation.session.header.actions` 注册（id `compression-repo`，order 60）与设置页音视频面板、对应 zh/en 文案与样式。
- 测试：新增 `test/ffmpeg.test.js`、`test/http.test.js`，并补 `parseRepoList` / `listRepos`、`sessionRepos` 归一化、`pushFlow` 的 `target` 与报告文案、设置页音视频面板与会话头选择器；共 113 条。

## 1.5.1 — 2026-11-19

- **设置页不再有仓库**：删掉「默认仓库」输入框、仓库状态行、推送 / 建仓 / 查看按钮与仓库路径的保存动作。GitHub 这一栏只剩 `gh` 的安装、登录与网络体检；发布只走 `github_push` 工具。
- 接口收敛：`/api/github` 只保留 `download` / `login` / `cancel`，`configure` / `push` / `create` / `view` 下线；`GET /api/github/repo` 删除；网络体检固定在本插件检出目录上跑（只为读 git 的 `http.proxy`）。
- 设置里删掉 `github.repoPath`（升级后下一次写入即清掉），`resolveRepoPath` 一并移除；`github_push` 的目录选择变成「显式 `path` → 本会话工作目录」，不再有配置兜底。
- 测试同步：`test/push-flow.test.js` 覆盖「显式 → 会话、无兜底」，`test/store.test.js` 断言 `repoPath` / `repos` 从内存与磁盘上一起消失；共 92 条。
## 1.5.0 — 2026-11-19

- **删掉左侧栏「仓库」面板**：官方「变更请求与工作树」bundle 已经在管仓库与工作树 UI，自建面板与它重复。移除 `sidebar.panellist` / `main` 两个注册、面板组件与图标、`repos*` 文案、`GET /api/github/repos` 路由和 `configure` 的 `repos` 字段（现在返回 400 说明已下线）。
- **发布能力改成工具 `github_push`**：默认推本会话的工作目录（`workingDirectory`），其次设置页的「默认仓库」，可用 `repo` 指定绝对路径。内部固定走「网络体检 → 密钥扫描 → 60 秒超时的 push → 失败分类 + 待推列表」，命中密钥时阻止并提示可 `force`。
- 新模块 `src/push-flow.js`：`resolvePushCwd` / `pushFlow` / `pushReportText`，设置页的 `push` 动作与工具共用同一段流程，安全规则不会两边不一致。
- `github.repos` 从状态与归一化里移除（升级后下一次写入即清掉旧字段）；`push`/`create`/`view` 的 `repo` 参数改为接受任意存在的绝对目录。
- 设置页 GitHub 一节补一句说明：那一栏只推默认仓库，工作区发布交给 `github_push`。
- 新增 `test/push-flow.test.js`（目录解析、密钥拦截与放行、失败分类、报告文案、无仓库早退）。

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
