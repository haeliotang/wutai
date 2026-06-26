# Wutai 开发文档

本文档面向 Wutai 的后续实现、维护和审查。它描述当前仓库已经实现的开发边界、运行方式、验证方式，以及下一阶段应如何扩展。任何产品叙事或技术方案都必须继续区分：已实现、计划中、演示用、外部运行时能力。

## 1. 当前定位

Wutai 是个人电脑上的 agentic work 本地信任与证据层。它不试图成为替用户完成所有任务的 agent 应用，而是监督 agent 在本机上下文中做了什么、被允许访问什么、产生了什么成果物，以及哪些结论需要证据复核或人工背书。

当前 v0.1 仓库只实现一个受监督的研究任务链路，用它证明以下本地信任层闭环：

```text
自然语言任务
  -> 生成计划
  -> 任务级权限
  -> 研究适配器进度
  -> work packet
  -> Evidence Gate 复核
  -> 本地任务历史
```

当前未实现任意外部 agent 监督、MCP proxy、浏览器控制、Codex/Claude Code 适配、完整 computer-use、跨 agent credential broker、移动端确认器和生产打包。

## 2. 开发原则

- **不重造 agent runtime**：Wutai 包装 GPT Researcher、browser-use、Codex、Claude Code、MCP server 等外部能力，而不是重新实现它们。
- **默认本地可审计**：任务、事件、权限、成果物和证据结果应优先落入本地 ledger。
- **权限先于能力**：任何读取文件、使用凭证、写入成果物、执行命令、操作浏览器或调用外部服务的能力，都必须先有 scope 和审计记录。
- **Evidence Gate 不是 oracle**：证据闸只能说明被抽取的 claims 是否满足当前规则，不能保证整篇报告全部真实。
- **日志不是默认 UX**：普通用户看到 plain-language timeline；runtime logs 只进入 expert view 或 audit artifact。
- **人类背书不可自动化**：agent 可以准备 review surface，但不能替用户做最终 alignment / accountability 判断。
- **先证明 work packet，再扩展控制面**：下一阶段应先稳定跨任务 work-packet schema，再做更强的 MCP/browser/computer-use 权限边界。

## 3. 仓库结构

```text
src/
  App.tsx                         React 主界面和 v0.1 任务流
  domain/
    task.ts                       Task、event、permission、source、artifact 类型
    evidence.ts                   Evidence Gate UI 类型和解析
  runtime/
    researchAdapter.ts            研究适配器接口
    createResearchAdapter.ts      mock / gpt-researcher 工厂
    mockResearchAdapter.ts        离线 mock 研究适配器
    gptResearcherAdapter.ts       GPT Researcher 前端适配器
    researchProviderSetup.ts      Provider Profiles 类型和 Tauri 命令包装
  storage/
    taskStore.ts                  存储接口和 localStorage fallback
    sqliteTaskStore.ts            Tauri SQLite 存储实现
    createTaskStore.ts            运行时存储工厂
  artifacts/
    artifactWriter.ts             browser / Tauri artifact 写入边界
  styles.css                      桌面控制台样式

src-tauri/
  src/lib.rs                      Tauri 命令、keychain、sidecar、测试
  src/main.rs                     Tauri 入口
  capabilities/default.json       Tauri capability 配置
  tauri.conf.json                 Tauri 应用配置
  Cargo.toml                      Rust 依赖和构建配置

scripts/
  gpt_researcher_adapter.py       Python GPT Researcher sidecar
  evidence_gate.py                claim ledger 和 deterministic evidence rules

tests/
  e2e/                            Playwright UI / contract 测试
  python/test_evidence_gate.py    Evidence Gate 离线回归

docs/
  architecture.md                 架构分层
  security-model.md               权限和安全模型
  mvp.md                          MVP 定义
  prd/wutai-v0.1.md               v0.1 PRD
  technical-design/v0.1-scaffold.md
                                  v0.1 技术设计
  research/                       市场扫描和适配器候选
```

## 4. 技术栈

| 层 | 当前选择 | 用途 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 | 本地桌面应用、Rust 后端、轻量运行时 |
| 前端 | React + TypeScript + Vite | UI、任务流、Provider Profile 表单 |
| 本地存储 | SQLite / localStorage fallback | Tauri 持久化和 web preview 测试 |
| 密钥存储 | `keyring-rs` | 系统钥匙串中的 provider access keys |
| 研究 runtime | GPT Researcher sidecar | 可选真实研究任务 |
| 证据闸 | Python `scripts/evidence_gate.py` | claims 抽取、source tier、verification |
| e2e 测试 | Playwright | UI 核心路径和 Provider Profiles contract |
| Rust 测试 | Tauri mock runtime | command、IPC、keychain substitute、sidecar cancellation |

## 5. 环境准备

需要安装：

- Node.js 和 npm
- Rust 和 Cargo
- Python 3.11 到 3.13；可选 GPT Researcher sidecar 推荐 Python 3.13

安装前端依赖：

```bash
npm install
```

创建 Python venv，用于 `npm run test:evidence` 和可选真实研究适配器：

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-gpt-researcher.txt
```

如果只运行 Evidence Gate 单测，当前测试不需要外部 API key。

## 6. 运行方式

运行 web preview，默认使用离线 mock adapter：

```bash
npm run dev
```

运行 Tauri 桌面壳：

```bash
npm run tauri dev
```

运行可选 GPT Researcher sidecar：

```bash
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher npm run tauri dev
```

Wutai 默认优先使用项目内 `.venv`。如需覆盖 Python 解释器：

```bash
WUTAI_GPT_RESEARCHER_PYTHON=/path/to/python \
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher \
npm run tauri dev
```

如需覆盖 sidecar 脚本路径：

```bash
WUTAI_GPT_RESEARCHER_ADAPTER_SCRIPT=/path/to/gpt_researcher_adapter.py \
VITE_WUTAI_RESEARCH_ADAPTER=gpt-researcher \
npm run tauri dev
```

## 7. Provider Profiles

Provider Profile 将模型、搜索、嵌入配置分开管理：

- 模型：DeepSeek、OpenAI、OpenAI-compatible、Ollama
- 搜索：Tavily、DuckDuckGo
- 嵌入：OpenAI-compatible、Ollama

非密钥 profile metadata 存在 app-data 目录。访问密钥通过 `keyring-rs` 存入系统钥匙串，并按 profile、provider、purpose 分槽。开发者仍可使用以下环境变量作为 fallback：

```text
DEEPSEEK_API_KEY
OPENAI_API_KEY
TAVILY_API_KEY
```

密钥不得写入 profile metadata、task history、runtime log 或 artifact。Rust 后端会在 sidecar log、error response 和 audit payload 写出前替换已知密钥值为 `[REDACTED]`。

## 8. 任务和事件模型

当前核心类型在 `src/domain/task.ts`：

- `WutaiTask`
- `TaskEvent`
- `PermissionRequest`
- `SourceRecord`
- `ArtifactRecord`

当前 task 状态：

```text
draft
waiting_for_permission
running
completed
completed_with_warnings
failed
cancelled
```

当前 event 类型：

```text
TaskStarted
TaskStepUpdated
PermissionRequested
PermissionResolved
ArtifactCreated
SourceCaptured
ToolLogAdded
TaskCompleted
TaskFailed
```

事件必须包含 `visibility`：

- `user`：默认 timeline 可见
- `expert`：展开后可见
- `internal`：仅在安全时持久化调试

新增 runtime 时，不应直接把外部 log 泄漏到默认 UI；必须先翻译为 Wutai event。

## 9. Artifact 和 Work Packet

v0.1 的 work packet 至少包含：

```text
report.md
sources.json
claims.json
verification.json
audit.json
```

`report.md` 是用户可读成果物。
`sources.json` 是捕获来源。
`claims.json` 是可复核主张账本。
`verification.json` 是 Evidence Gate 输出。
`audit.json` 是任务权限、事件、provider metadata、redacted sidecar log 等上下文。

Tauri 模式下 artifact 写入 app-data：

```text
<app-data-dir>/artifacts/<task_id>/
```

Web preview 模式下 artifact 保留在浏览器内存/下载流，不代表生产落盘路径。

## 10. Evidence Gate

Evidence Gate 位于 `scripts/evidence_gate.py`，用于：

- 从报告中抽取最多 30 条 decision-relevant claims。
- 标准化 claim JSON shape。
- 按固定规则分类 source provenance。
- 计算 citation coverage、primary source count、high-risk gaps、conflicts。
- 输出 `pass` / `warning` / `fail`。

高风险 claims 包括 license、价格、发布日期、采用数据、产品身份、隐私、安全、能力声明等。

重要边界：

- Evidence Gate 是 review aid，不是事实 oracle。
- `pass` 只表示被抽取 claims 满足当前规则。
- `warning` 不丢弃报告，而是把任务标记为 `completed_with_warnings`。
- locked regressions 是回归种子，不是通用事实库。

## 11. Sidecar 边界

GPT Researcher 通过 Python sidecar 调用，而不是嵌进前端：

```text
scripts/gpt_researcher_adapter.py
```

Tauri 后端负责：

- 检查 Python、sidecar、package、Provider Profile、API key、Ollama endpoint。
- 按 `task_id` 注册 sidecar 进程。
- Stop 时调用 cancellation command 终止对应进程。
- 读取 stderr 并通过 Tauri IPC Channel 推送 progress events。
- 将 runtime logs 降级为 expert-only `ToolLogAdded`。
- 将完整 redacted logs 写入 `audit.json`。

stdout 必须保留为 parseable JSON。runtime logs 必须写 stderr。

## 12. 验证命令

前端构建：

```bash
npm run build
```

核心 e2e：

```bash
npm run test:e2e
```

Provider Profiles contract：

```bash
npm run test:e2e:providers
```

Evidence Gate 回归：

```bash
npm run test:evidence
```

Rust/Tauri command 和 IPC 测试：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

可选 sidecar smoke test：

```bash
cargo test --manifest-path src-tauri/Cargo.toml \
  installed_gpt_researcher_sidecar_smoke -- --ignored
```

提交前最低验证建议：

```bash
npm run build
npm run test:evidence
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

如果只改 README 或 docs，可至少运行：

```bash
git diff --check
```

但如果文档改动涉及命令、路径、状态、adapter 或 artifact 名称，应跑对应测试确认没有文档漂移。

## 13. 新功能开发流程

1. **先写验收标准**
   明确用户能看到什么、artifact 会写什么、权限如何被记录、哪些能力不在本次范围。

2. **确认能力边界**
   区分 Wutai 自有能力、外部 runtime 能力、demo-only 能力和 planned capability。

3. **更新类型和事件契约**
   如果新增 task state、event type、permission type 或 artifact type，先更新 `src/domain/`。

4. **实现 adapter 或 proxy**
   外部 runtime 输出必须转换为 Wutai event，不能直接作为默认 UI。

5. **接入权限和审计**
   每个敏感动作必须有 permission scope、approval/denial、audit trail。

6. **生成或扩展 work packet**
   需要明确 artifact 命名、内容 schema、hash/provenance、review status。

7. **补测试**
   前端路径用 Playwright；Evidence Gate 用 Python unittest；Tauri command、keychain substitute、sidecar/cancellation 用 Rust tests。

8. **更新文档**
   README 只写已验证路径；设计文档可以写 planned boundary，但必须标注未实现。

## 14. 适配器开发规则

新增 adapter 时必须满足：

- 有 `preflight()`，能解释缺什么。
- 有 `run()`，接收 task、abort signal、update handler、artifact writer。
- 能响应 cancellation。
- 默认 UI 只发 `user` visibility 的 plain-language events。
- 原始 runtime log 只进入 `expert` 或 `audit`。
- 输出 artifact 必须经 `artifactWriter`。
- 如调用外部服务，provider metadata 可入 audit，secret value 不可入 audit。
- 若不能 enforce Wutai permission boundary，必须标记 experimental，不进入默认路径。

推荐适配器优先级：

1. CLI wrapper 或 trace importer。
2. MCP proxy 或 tool-call recorder。
3. Browser agent supervision。
4. Coding-agent adapter。
5. Computer-use adapter。

不要在 permission broker 和 work-packet schema 稳定前直接做完整桌面接管。

## 15. 安全和隐私规则

高风险动作必须 explicit confirmation：

- 删除、覆盖、移动、发布用户文件。
- 发邮件、发消息、发帖或外部提交。
- 表单提交或个人数据外传。
- 安装软件或浏览器扩展。
- 修改系统设置。
- 访问密码、钱包、token、secret store。
- 启动 network listener。
- destructive shell command。
- 导出包含敏感路径或私有材料的 audit/artifact。

Wutai 默认不应把权限永久化。权限应按 task/session scope 记录，并支持 stop/revoke。

## 16. 下一阶段开发目标

### 16.1 Work Packet Schema v0.2

目标：把当前 research-specific artifacts 提升为跨 agent session 可用的 schema。

验收标准：

- schema 能表示 research、coding-agent session、browser task、local script。
- 每个 artifact 有 stable id、type、path、created_at、producer、hash。
- audit 能表示 tool call、permission decision、credential purpose、runtime event。
- evidence section 能保留 claims、sources、unsupported items、blind spots。
- README 和 technical design 明确哪些 runtime 已支持，哪些只是 schema 预留。

### 16.2 External Agent Supervision Wedge

目标：选择一个低风险入口验证任意外部 agent 的监督路径。

优先候选：

- CLI wrapper：`wutai run <command>`
- Claude Code / Codex trace importer
- MCP proxy 的最小 tool-call recorder

验收标准：

- 能生成 session ledger。
- 能捕获 command/tool/file/artifact evidence。
- 能生成 work packet。
- 能标记 coverage 和 blind spots。
- 不要求一开始 enforce 所有权限，但必须诚实声明 enforce 边界。

### 16.3 Credential Broker v0.2

目标：把现有 Provider Profiles/keychain 从 research sidecar 扩展为通用 credential purpose 记录。

验收标准：

- credential grant 记录 profile、provider、purpose、task/session id。
- secret value 不进入任何 artifact、event 或 log。
- adapter 只能拿到本次任务需要的 credential material。
- 不可 mediated 的 runtime 标记为 experimental。

## 17. 提交和发布规范

提交应保持单一意图：

- 文档定位：`Polish README project positioning`
- 架构调整：`Clarify supervised session architecture`
- 功能实现：`Add <capability>`
- 测试补充：`Add <area> regression coverage`

提交前检查：

```bash
git status --short
git diff --check
```

如果改动涉及代码或测试：

```bash
npm run build
npm run test:evidence
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

不要提交：

- `.venv/`
- `node_modules/`
- `dist/`
- `test-results/`
- `playwright-report/`
- API key、token、`.env`
- 本地 app-data 或 artifact 输出

## 18. 文档维护规则

README 应只承诺当前可运行、可验证的路径。
PRD 和 architecture 可以描述 planned boundary，但必须标明未实现。
technical design 必须记录真实模块、命令和测试边界。
security model 必须优先描述不能做什么，而不是只描述未来能力。
market scan 中的行业/竞品事实容易过期，外部使用前必须重新查证。

每次新增能力时至少检查：

- `README.md`
- `AGENTS.md`
- `docs/architecture.md`
- `docs/security-model.md`
- `docs/technical-design/v0.1-scaffold.md`
- 相关 PRD 或 MVP 文档

## 19. 当前接受标准摘要

v0.1 当前可接受的事实表述：

- Wutai 有一个可运行的本地桌面 scaffold。
- Wutai 支持一个受监督 research workflow。
- Wutai 支持任务级 public web-research permission。
- Wutai 可通过 Provider Profiles 和系统钥匙串配置真实 research sidecar。
- Wutai 会生成 `report.md`、`sources.json`、`claims.json`、`verification.json`、`audit.json`。
- Evidence Gate 会把弱证据报告标记为需要 review。
- Rust、Playwright、Python 测试覆盖当前核心边界。

当前不可接受的事实表述：

- Wutai 已经是通用 agent control plane。
- Wutai 已经监督 Claude Code、Codex、MCP、browser-use 或 computer-use。
- Wutai 已经实现跨 agent credential broker。
- Evidence Gate 能保证报告真实。
- Wutai 可以安全地完整接管用户电脑。
