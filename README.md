# 上下文压缩分档（Context compression tiers）

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的五档上下文压缩策略：设置页 + 智能体工具 + 实时占用提示 + 主动压缩。
>
> A five-tier context-compression policy for DeepSeek Harness: a settings page, three agent tools, a live occupancy line, and proactive compaction.
>
> 包名与仓库：`dsh-compression-tiers`（社区 `dsh-` 前缀；加载器行 id 为 `compression-tiers`）。

## 目录

- [这是什么](#这是什么)
- [安装](#安装)
- [使用](#使用)
- [全局规则](#全局规则)
- [GitHub CLI](#github-cli)
- [五档参数](#五档参数)
- [智能体工具](#智能体工具)
- [工作原理](#工作原理)
- [兼容性与限制](#兼容性与限制)
- [为什么是这五档](#为什么是这五档)
- [开发](#开发)
- [许可](#许可)

## 这是什么

官方 `@deepseek-ai/dsh-compaction-basic` 只暴露 `thresholdRatio` / `retainRatio` / `headroomTokens` 等字段，普通用户没有合适的地方改，也不清楚改完有效范围是多少。本插件把这组参数收成五档，并补齐五件事：

1. **设置页**：`设置 → 上下文压缩`，五个按钮直接切档，显示自动触发比例与逐字保留比例。
2. **引擎同步**：选中的档位立即写入每个已挂载的 Agent 预设压缩引擎（官方组合里真正运行的引擎在预设隔离域，家庭补丁碰不到）。
3. **智能体闭环**：`compression_context` 读实时占用，`compression_compact` 在需要时主动压缩并在本轮结束后自动续跑；对话尾部的 `[context]` 行给出同样的数字。
4. **全局规则**：同一页下半部分直接编辑官方指令文件 `<DSH home>/AGENTS.md`，保存即原子写入，不另存副本。
5. **GitHub CLI**：同一页管理 `gh`——识别系统 PATH、下载固定版本的托管副本、走设备码登录，供官方变更请求面板使用。

本包从 `homerdsh-workbench` 的压缩子系统拆出，状态独立、工具名独立，可单独安装；全局规则与 GitHub CLI 面板也由工作台合并而来。

## 安装

要求：DeepSeek Harness `0.2.2-rc.3`，Node.js ≥ 24.9。

**本地目录安装（推荐）**

1. 把本仓库放到任意目录；
2. 在 DSH 里打开 **插件（Plugins）→ 添加插件（Add plugin）**，选择这个目录；
3. 安装完成后打开新会话，进入 **设置 → 上下文压缩**。

也可以在会话中让智能体用 `plugin_manager` 的 `install_bundle` 安装这个目录。安装由 DSH 完成包管理与 bundle 选择，不要手工改 profile 的 `package.json` / `cordis.patch.yml`。

宿主包（`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-tools`）由 DSH 运行时提供，本包只把它们声明为可选 `peerDependencies`：这样即使以「链接到 DSH 外部目录」的方式安装（不复制进 profile），DSH 的解析层也能把这两个导入路由到安装自带的实现。

**升级**：替换目录后重新安装，或按插件页的升级流程操作；替换已安装包后需要重启 DSH 才能加载新的 Host 模块。

## 发布与版本

版本号以 `package.json` 为准，每个发布版本对应一个 `vX.Y.Z` tag，变更写在 [CHANGELOG.md](CHANGELOG.md)。

- 锁定版本安装：`git+https://github.com/Homer4033/dsh-compression-tiers.git#v1.3.1`
- CI（`.github/workflows/ci.yml`）在 Windows 与 Linux 上跑 `npm test`，随后跑 `node scripts/check-secrets.mjs`；后者与设置页推送前的检查同源
- 本地自查：`npm run check:secrets`

## 使用

打开 **设置 → 上下文压缩**，点一个档位即可。切换会：

- 写入 `<DSH home>/compression-tiers/settings.json`；
- 立即更新每个已挂载的预设压缩引擎（引擎行 `compaction-basic`）；
- 在页面底部显示已同步的引擎数量、上次压缩时间与设置文件路径。

同一页下半部分是全局规则编辑器，见 [全局规则](#全局规则)。

首次安装会读取已挂载引擎的 `thresholdRatio` / `retainRatio`：能对上五档就沿用该档，再写入状态文件；对不上五档（例如官方默认 `0.8 / 0.16`）时采用默认的 `standard`，并把它同步到引擎。之后只有手动切档才会改变生效值。

对话里仍然可以：

- 输入 `/compact` 立即压缩一次；
- 让智能体根据 `[context]` 行决定是否调用 `compression_compact`。

## 全局规则

设置页下半部分的「全局规则」编辑 `<DSH home>/AGENTS.md`——官方 `dsh-agent-instructions` 读取的那份用户级指令文件：

- **读取**：打开设置页时读取当前内容，显示字符数（上限 100,000）与文件路径；文件不存在时提示"保存后创建"。
- **保存**：点 **保存规则** 才写入，写入是原子的（同目录临时文件 + rename），并自动去掉 UTF-8 BOM、把 CRLF 归一成 LF、保证恰好一个结尾换行；超过 100,000 字符返回 413，不会悄悄截断规则。
- **生效**：官方加载器在之后的会话里注入这份文件，不需要重启 DSH；本会话的系统提示额外带最新 2,000 字符的摘要，让刚保存的规则立刻出现在上下文里。
- **边界**：智能体没有改写这个文件的工具，只有你在设置页保存才会写入；`homerdsh-workbench` 里的同名面板写的是同一个文件，不会出现两份互相打架的规则。
- **路由**：`GET/POST /compression-tiers/api/rules`，与压缩设置路由一样用 `connection.requestRejection` 做同源与浏览器认证，拿不到校验服务时 fail closed。

## GitHub CLI

官方「变更请求与工作树」bundle（`@deepseek-ai/dsh-experimental-forge-bundle`）靠本机 `gh` 读 PR、检查与评审。设置页的「GitHub CLI」面板负责三件事：

- **检测**：先看托管版 `<DSH home>/compression-tiers/gh/bin`，再看系统 PATH；两处都有时优先托管版，并在插件激活时把它插到宿主进程 PATH 最前面，官方面板随即可用。
- **下载**：内置固定版本 `gh 2.76.2`（Windows / Linux，x64 / arm64），从 `cli/cli` 官方 release 下载；支持 HTTP Range 断点续传、10 分钟超时、解压后先跑 `gh --version` 探测暂存副本，再原子替换，失败自动回滚旧二进制。
- **登录**：调 `gh auth login --web` 走设备码流程：页面显示一次性验证码（可复制）、打开授权页、取消；`gh` 子进程在后台轮询，完成后自动刷新成「已登录：账号」。凭据存在 gh 自己的存储里，不写 DSH 数据目录。

接口：`GET/POST /compression-tiers/api/github`（状态，动作 `download` / `login` / `cancel` / `configure` / `push` / `create` / `view`）与 `GET /compression-tiers/api/github/auth`（`gh auth status --json hosts` + `gh --version`），都走同一套同源校验。

**登录状态带 scopes**：`gh auth status --json hosts` 可用时读 JSON，老版本回落到文本解析；缺 `repo` scope 时面板直接提示——私有仓库推送会 403，不用等到失败才发现。

### 网络体检与推送

只判断「gh 装了没有、登没登录」还不够：真正耗时间的是下一层——`http.proxy` 指着一个没人监听的端口、`github.com` 解析到不是 GitHub 的地址、或者 `git push` 卡住不返回。面板因此多了三块：

- **网络体检**（`GET /compression-tiers/api/github/network`）：探 DNS、直连 443、对 `https://github.com/` 的 HEAD 请求、代理端口，给出 `direct` / `proxy` / `proxy-dead` / `blocked` 四种结论。只看 TCP 不够——被污染的解析结果照样能握手成功，只有 HTTPS 失败才说明此路不通；代理按「显式设置 → git `http.proxy` → 系统代理」的顺序确定，并在面板标出用的是哪一层。DNS 落在已知 GitHub 网段之外会单独提示（只是提示，不当失败）。
- **仓库状态**（`GET /compression-tiers/api/github/repo`）：仓库路径（默认本插件目录，可改并持久化到设置）、当前分支、本地/远端 HEAD、待推提交、未提交改动；远端用 `git ls-remote` 现查，失败只标记不抛错。
- **推送**（`POST` 动作 `push`）：`git push` 带 60 秒硬超时，超时用 `taskkill /T /F`（POSIX 下杀进程组）收掉整棵进程树，并设 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never` 防止卡在交互式认证；失败按 DNS / 网络代理 / 认证 / 非快进 / 仓库不存在分类，同时返回仍未推送的提交列表。代理可用时自动注入 `-c http.proxy=…`，不写进 git 全局配置。

**建仓**（动作 `create`）默认私有，必须 `confirm: true` 且仓库名合法才会执行 `gh repo create --source … --remote origin --push`；只在仓库还没有远端时出现在面板上，并且要在按钮上再点一次确认。

> 下载只校验大小与 `gh --version`，没有对压缩包固定 SHA-256；钉住的是官方 release URL。

## 五档参数

| 档位 | 自动触发 | 逐字保留 | 定位 |
| --- | ---: | ---: | --- |
| `gentle` 极轻 | 80% | 20% | 最贵、最晚，唯一对齐官方默认的档位 |
| `light` 轻量 | 70% | 18% | 比官方默认早一档 |
| `standard` 标准 | 60% | 16% | **默认**，长对话成本明显低于 0.8 |
| `aggressive` 积极 | 50% | 10% | 成本优先 |
| `max` 最大 | 40% | 6% | 最省：到窗口 40% 就把旧上下文收成一条摘要 |

官方公式：`floor(min(W × thresholdRatio, W − O − 65,536))`，逐字保留为 `(W − O) × retainRatio`。`W` 是模型窗口，`O` 是请求输出预留。

> `0.80` 是**最贵**的一档，不是中间档。默认 `standard` 取 0.60，让长对话更早压缩；只有 `gentle` 与官方默认一致。

## 智能体工具

| 工具 | 作用 |
| --- | --- |
| `compression_tiers` | 读取或切换档位；可选 `routeLines` 写入按路由覆盖（`provider model headroomTokens [retainTokens]`，每行一条，最多 16 条）。未知档位直接报错，不会静默回退。 |
| `compression_context` | 只读：已用 tokens、窗口、本档自动阈值、压缩后逐字保留量、距自动压缩还剩多少。 |
| `compression_compact` | 排队一次主动压缩：本轮 `turn/end` 后执行（可低于自动阈值），完成后发送 follow-up 自动续跑。 |

`compression_compact` 需要预设隔离域里的压缩引擎。宿主侧只有 token 计量时，它会明确返回"没有可用的压缩服务"，而不是假装成功。

## 工作原理

```text
设置页 / compression_tiers
        │  level + routeLines
        ▼
<DSH home>/compression-tiers/settings.json   ← 唯一事实来源
        │  reconciler（激活时 500ms 重试 40 次，之后每分钟）
        ▼
每个已挂载 Agent 预设里的 compaction-basic 行（entry.update 重启该行）
        │
        ├─ 自动压缩：官方压力压缩按档位阈值触发
        └─ 主动压缩：compression_compact → compactNow() → follow-up
```

- 不写 `$DSH_HOME/cordis.patch.yml`，不改宿主平面上的 `compaction-basic` 行：官方组合把那一行设为 `disabled`，真正运行的是预设隔离域里的副本，所以插件直接更新副本。
- 对预设结构的访问是防御式的：DSH 升级改了私有结构时，插件放弃更新并保留官方默认，而不是让预设激活失败。
- 设置路由走官方 `webServer`，并用 `connection.requestRejection` 做同源与浏览器认证；拿不到校验服务时 fail closed。
- 全局规则没有第二份状态：`<DSH home>/AGENTS.md` 本身就是唯一事实来源，插件只负责原子写入和提示摘要；文件删掉等于没有规则。
- GitHub CLI 的托管副本与下载暂存放在插件目录 `<DSH home>/compression-tiers/gh`，与工作台的 `homerdsh/components` 互不干扰；PATH 前插只影响本进程，不改系统环境变量。
- 状态文件与引擎都是可重建的：删掉设置文件后，下次激活会重新沿用当前引擎策略。

## 兼容性与限制

- **窗口**：五档按 ≥ 256k tokens 的窗口设计。官方 65,536 的输出余量会压住小窗口的阈值：128k 窗口下五档只剩保留量不同，≤ 64k 的窗口 `W − O − 65,536 ≤ 0`，官方引擎会拒绝该路由。此时用 `compression_tiers` 的 `routeLines` 给该路由写更小的 `headroomTokens`。
- **宿主平面**：只更新预设隔离域里的引擎。如果某个部署直接把 `compaction-basic` 挂在宿主平面并启用它，本插件不会改那一行。
- **不要和另一个管理同一批压缩引擎的插件同时启用**：两边的 reconciler 会互相覆盖策略。若同时装有 `homerdsh-workbench`，请在确认本插件工作后移除或停用工作台里的压缩部分。
- **重复的占用行**：同上，两个插件都会注入末尾占用行与各自工具；只用其中一个。
- **全局规则没有智能体工具**：档位可以用 `compression_tiers` 改，规则只能由人在设置页保存，避免智能体自行改写高优先级契约。写入的内容会被官方加载器注入后续每个会话，只保存你自己信任的规则，不要写密钥或一次性笔记。
- **规则大小**：单次保存上限 100,000 字符，超出直接 413；系统提示里的摘要固定 2,000 字符，超出部分仍由官方加载器在会话开始时读取。
- **GitHub CLI 需要网络**：托管版从 github.com 下载，企业代理或内网可能失败；失败会保留 `.part` 文件，重试时续传。下载只校验大小和 `gh --version`，不固定压缩包 SHA-256。
- **系统已有 gh**：面板显示「系统已安装（PATH）」，可以直接登录；点「仍要下载」会安装托管版并优先使用。
- **登录凭据位置**：`gh auth login` 把凭据写进 gh 自己的存储（Windows 上是 `%APPDATA%\GitHub CLI`），不写 DSH 数据目录，也不会进转移包。
- **浏览器刷新**：切换档位对引擎立即生效；设置页自身的状态通过接口刷新，个别情况下需要刷新页面重新读取。
- **中文/英文**：设置页与插件详情按 DSH 语言环境显示；智能体面向的提示与工具描述为英文。

## 为什么是这五档

- 官方 `dsh-compaction-basic` 默认 `0.8 / 0.16 / 65,536`。`gentle` 保留官方默认，作为"最贵、最晚"的对照档。
- 长上下文本身会降低可靠性：Chroma 的 [Context Rot](https://research.trychroma.com/context-rot) 与 EMNLP 2025 的 [Context Length Alone Hurts LLM Performance Despite Perfect Retrieval](https://aclanthology.org/2025.findings-emnlp.1264/) 都表明，即使检索正确、输入远低于标称窗口，性能也会随长度下降。因此默认档提前到 0.60。
- 逐字保留从"大尾巴"收紧到 6%–20%：压完仍要落在可用区间，摘要请求也不该再处理几十万 tokens。
- 更早压缩的代价是 KV cache 前缀重建与摘要调用变多；`gentle` 留给"绝不打断、接受更贵"的长跑。

## 开发

```bash
npm test          # node --test：档位公式、路由解析、状态读写、引擎同步、占用行、规则、GitHub CLI、manifest 规范
node --check index.js
```

目录：

```text
index.js              Host 插件入口：工具、系统提示、设置路由、reconciler
client.js             Web 设置页（settings.section）
src/levels.js         五档参数与官方阈值公式
src/presets.js        预设隔离域引擎的读取与更新
src/context-meter.js  实时占用计算、[context] 尾行、compression_context
src/manual-compact.js 主动压缩队列（compactNow + follow-up）
src/store.js          状态文件读写（JSON 与原子文本写入）
src/rules.js          全局规则文件：路径、读取、校验、原子写入、提示摘要
src/gh.js             GitHub CLI：托管下载（断点续传/回滚）、PATH 检测、设备码登录
src/routes.js         按路由覆盖解析
src/http.js           设置路由的同源/认证与 JSON 辅助
test/                 node:test 单元测试与 manifest 检查
docs/                 插件详情页与预览图
```

## 许可

[MIT](LICENSE)。
