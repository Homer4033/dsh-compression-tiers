# AGENTS.md

> 本仓库是 DeepSeek Harness 插件 `dsh-compression-tiers` 的维护契约。任何工程代码、资产或系统变更操作前先读本文件。

## 目录

- [范围](#范围)
- [事实来源](#事实来源)
- [工程约束](#工程约束)
- [验证要求](#验证要求)
- [文档索引](#文档索引)
- [变更记录](#变更记录)

## 范围

- 本仓库只负责五档上下文压缩、全局规则编辑与 GitHub CLI 管理：档位参数、设置页、`compression_tiers` / `compression_context` / `compression_compact` 三个工具、把档位同步进预设隔离域的 `compaction-basic` 引擎、设置页里对 `<DSH home>/AGENTS.md` 的读取与原子写入，以及托管 `gh` 的下载、PATH 检测与设备码登录。
- 不负责：`dsh-compaction-basic` 本身的压缩算法、会话历史、摘要模型选择、官方 `/compact` 命令；不解析或改写规则内容，只把它当作文本原样保存；不实现 PR/检查/评审面板本身（官方 `dsh-experimental-forge-bundle` 负责），只保证它找得到已登录的 `gh`。
- 不提供改写全局规则的智能体工具：高优先级契约只能由人在设置页保存。
- 不维护 `homerdsh-workbench` 的其它子系统（会话、GitHub、记忆、视频、投研终端）。

## 事实来源

- 当前策略：`<DSH home>/compression-tiers/settings.json`。引擎配置是派生态，可重建。
- 全局规则唯一来源：`<DSH home>/AGENTS.md`，由官方 `dsh-agent-instructions` 读取；本插件不复制、不缓存，删文件即等于没有规则。
- GitHub CLI 版本唯一来源：`src/gh.js` 的 `GH_VERSION`（当前 `2.76.2`）与官方 release URL；托管副本在 `<DSH home>/compression-tiers/gh`，登录凭据在 `gh` 自己的存储里，插件不读取。
- 档位参数唯一来源：`src/levels.js` 的 `COMPRESSION`；文档与界面不得写出与之不一致的比例。
- 官方阈值公式：`floor(min(W × thresholdRatio, W − O − 65,536))`，逐字保留 `(W − O) × retainRatio`。

## 工程约束

1. 不手工改已安装 profile 的 `package.json` / `cordis.patch.yml`；安装与启用通过 `plugin_manager`。
2. 新增运行时文件必须同时更新 `package.json` 的 `files` 与 `exports`；locale、图标、详情文档保持在包内。
3. 不引入 Harness Client 包作为模块；设置页只用主题 token 与自有控件。
4. 状态写入必须原子（临时文件 + rename）；手改坏的 JSON 回落到默认值，不得让插件崩溃。
5. 预设结构访问保持防御式：拿不到结构时放弃更新，保留官方默认。
6. 插件不写 `$DSH_HOME/cordis.patch.yml`，不改宿主平面上的 `compaction-basic` 行。
7. 文档内容冲突时优先级：AGENTS.md > README.md > locale 文案。
8. 全局规则只写 `<DSH home>/AGENTS.md`，不写工作区 `AGENTS.md`；写入必须原子、去 BOM、CRLF 归一为 LF、保留单个结尾换行，超过 100,000 字符返回 413 而不是截断。
9. 系统提示只带规则的最新 2,000 字符摘要，不得整份注入或把摘要写回文件。
10. GitHub CLI 下载固定 `GH_VERSION` 与官方 release URL；解压后必须先跑 `--version` 探测暂存副本再原子替换，失败回滚旧二进制；只把托管 `bin` 目录插到本进程 PATH 最前，不改系统环境变量。
11. 登录只驱动 `gh auth login --web` 的设备码流程，不读取、不复制、不代存 `gh` 凭据；取消时结束子进程并丢弃会话状态。

## 验证要求

- 改动后运行 `npm test`；新增档位、路由或同步逻辑必须补 `node:test` 用例。
- 修改 `src/rules.js`、`/compression-tiers/api/rules` 或设置页规则面板后，必须让 `test/rules.test.js` 与 `test/client.test.js` 覆盖读取、归一化、413、摘要与面板状态。
- 修改 `src/gh.js`、`/compression-tiers/api/github` 或 GitHub CLI 面板后，`test/gh.test.js` 必须覆盖状态、断点续传、416 重启、PATH 前插与设备码解析；真实下载/安装只在临时 home 验证，不写用户 DSH home。
- 修改 manifest、locale、图标或 `client.js` 注册方式后，检查 `test/manifest.test.js` 全绿。
- 安装验证以插件页的 `application` 结果与新会话中的工具/设置为准，不以下载或日志推断成功。
- 无法在浏览器中确认的视觉效果，交付时明确写"渲染未验证"。

## 文档索引

- [README.md](README.md)：安装、使用、档位表、工具、原理、限制。
- [docs/DETAIL.md](docs/DETAIL.md)：插件详情页（英文，单图）。
- [docs/DETAIL.zh.md](docs/DETAIL.zh.md)：插件详情页（中文，单图）。
- [locale/en.json](locale/en.json)、[locale/zh.json](locale/zh.json)：插件管理器元数据与描述。
- [test/](test/)：单元测试与 manifest 规范检查。

## 变更记录

- 2026-11-17：从 `homerdsh-workbench` 拆出，独立包、独立状态、独立工具名；首次安装尽量沿用现有引擎档位，未匹配五档时采用 `standard`。
- 2026-11-17：把 `homerdsh-workbench` 的全局规则设置合并进来：新增 `src/rules.js` 与 `/compression-tiers/api/rules`，设置页增加规则面板，系统提示带最新 2,000 字符摘要；`src/store.js` 增加原子文本写入；版本升到 1.1.0。
- 2026-11-17：设置页文案精简（档位说明改为一句话、删除主动压缩说明段、规则面板文案缩短），版本 1.1.1；结构与接口未变。
- 2026-11-18：合并 GitHub CLI 功能：新增 `src/gh.js`（固定 `gh 2.76.2`、断点续传、原子安装回滚、设备码登录）、`/compression-tiers/api/github` 与 `/auth` 路由、设置页 GitHub CLI 面板；版本升到 1.2.0。
- 2026-11-18：把 `@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-tools` 声明为可选 `peerDependencies`：以本地目录链接（linked root）方式安装时，DSH 的解析层靠包的 peer 声明把宿主导入路由到运行时实现，缺声明会导致 Host 半区导入失败、插件不激活；版本 1.2.1。
