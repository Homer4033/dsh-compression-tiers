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
- [五档参数](#五档参数)
- [智能体工具](#智能体工具)
- [工作原理](#工作原理)
- [兼容性与限制](#兼容性与限制)
- [为什么是这五档](#为什么是这五档)
- [开发](#开发)
- [许可](#许可)

## 这是什么

官方 `@deepseek-ai/dsh-compaction-basic` 只暴露 `thresholdRatio` / `retainRatio` / `headroomTokens` 等字段，普通用户没有合适的地方改，也不清楚改完有效范围是多少。本插件把这组参数收成五档，并补齐三件事：

1. **设置页**：`设置 → 上下文压缩`，五个按钮直接切档，显示自动触发比例与逐字保留比例。
2. **引擎同步**：选中的档位立即写入每个已挂载的 Agent 预设压缩引擎（官方组合里真正运行的引擎在预设隔离域，家庭补丁碰不到）。
3. **智能体闭环**：`compression_context` 读实时占用，`compression_compact` 在需要时主动压缩并在本轮结束后自动续跑；对话尾部的 `[context]` 行给出同样的数字。

本包从 `homerdsh-workbench` 的压缩子系统拆出，状态独立、工具名独立，可单独安装。

## 安装

要求：DeepSeek Harness `0.2.2-rc.3`，Node.js ≥ 24.9。

**本地目录安装（推荐）**

1. 把本仓库放到任意目录；
2. 在 DSH 里打开 **插件（Plugins）→ 添加插件（Add plugin）**，选择这个目录；
3. 安装完成后打开新会话，进入 **设置 → 上下文压缩**。

也可以在会话中让智能体用 `plugin_manager` 的 `install_bundle` 安装这个目录。安装由 DSH 完成包管理与 bundle 选择，不要手工改 profile 的 `package.json` / `cordis.patch.yml`。

**升级**：替换目录后重新安装，或按插件页的升级流程操作；替换已安装包后需要重启 DSH 才能加载新的 Host 模块。

## 使用

打开 **设置 → 上下文压缩**，点一个档位即可。切换会：

- 写入 `<DSH home>/compression-tiers/settings.json`；
- 立即更新每个已挂载的预设压缩引擎（引擎行 `compaction-basic`）；
- 在页面底部显示已同步的引擎数量、上次压缩时间与设置文件路径。

首次安装会读取已挂载引擎的 `thresholdRatio` / `retainRatio`：能对上五档就沿用该档，再写入状态文件；对不上五档（例如官方默认 `0.8 / 0.16`）时采用默认的 `standard`，并把它同步到引擎。之后只有手动切档才会改变生效值。

对话里仍然可以：

- 输入 `/compact` 立即压缩一次；
- 让智能体根据 `[context]` 行决定是否调用 `compression_compact`。

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
- 状态文件与引擎都是可重建的：删掉设置文件后，下次激活会重新沿用当前引擎策略。

## 兼容性与限制

- **窗口**：五档按 ≥ 256k tokens 的窗口设计。官方 65,536 的输出余量会压住小窗口的阈值：128k 窗口下五档只剩保留量不同，≤ 64k 的窗口 `W − O − 65,536 ≤ 0`，官方引擎会拒绝该路由。此时用 `compression_tiers` 的 `routeLines` 给该路由写更小的 `headroomTokens`。
- **宿主平面**：只更新预设隔离域里的引擎。如果某个部署直接把 `compaction-basic` 挂在宿主平面并启用它，本插件不会改那一行。
- **不要和另一个管理同一批压缩引擎的插件同时启用**：两边的 reconciler 会互相覆盖策略。若同时装有 `homerdsh-workbench`，请在确认本插件工作后移除或停用工作台里的压缩部分。
- **重复的占用行**：同上，两个插件都会注入末尾占用行与各自工具；只用其中一个。
- **浏览器刷新**：切换档位对引擎立即生效；设置页自身的状态通过接口刷新，个别情况下需要刷新页面重新读取。
- **中文/英文**：设置页与插件详情按 DSH 语言环境显示；智能体面向的提示与工具描述为英文。

## 为什么是这五档

- 官方 `dsh-compaction-basic` 默认 `0.8 / 0.16 / 65,536`。`gentle` 保留官方默认，作为"最贵、最晚"的对照档。
- 长上下文本身会降低可靠性：Chroma 的 [Context Rot](https://research.trychroma.com/context-rot) 与 EMNLP 2025 的 [Context Length Alone Hurts LLM Performance Despite Perfect Retrieval](https://aclanthology.org/2025.findings-emnlp.1264/) 都表明，即使检索正确、输入远低于标称窗口，性能也会随长度下降。因此默认档提前到 0.60。
- 逐字保留从"大尾巴"收紧到 6%–20%：压完仍要落在可用区间，摘要请求也不该再处理几十万 tokens。
- 更早压缩的代价是 KV cache 前缀重建与摘要调用变多；`gentle` 留给"绝不打断、接受更贵"的长跑。

## 开发

```bash
npm test          # node --test：档位公式、路由解析、状态读写、引擎同步、占用行、manifest 规范
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
src/store.js          状态文件读写
src/routes.js         按路由覆盖解析
src/http.js           设置路由的同源/认证与 JSON 辅助
test/                 node:test 单元测试与 manifest 检查
docs/                 插件详情页与预览图
```

## 许可

[MIT](LICENSE)。
