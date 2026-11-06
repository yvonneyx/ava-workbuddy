# AVA for WorkBuddy

把本地 CSV / Excel 交给 WorkBuddy，用 AVA 计算并交付可核对的结论、结果表和交互图表。

这是独立的社区集成仓库。**不修改 AVA，不要求额外的模型 API Key，不提供远程数据托管。** WorkBuddy 负责理解问题、编写查询、解释结果；固定版本的 AVA 负责本地数据接入、计算和图表 HTML 生成。WorkBuddy 自身的模型使用和计费规则仍然适用。

## 立即接入 WorkBuddy

要求：**macOS / Linux，WorkBuddy 5.0.0+**。初次启动需要联网访问 GitHub 和 npm；配置中的 `runtime` 让受支持的 WorkBuddy 版本准备 Node 22.13+。本版本不支持 Windows。

### 路径一：先用自定义 MCP 体验，无需等待市场审核

1. 在 WorkBuddy 的「专家·技能·连接器 → 连接器」进入自定义连接器/MCP 配置，添加本仓库的 [`connector/mcp.json`](connector/mcp.json) 内容。若企业策略隐藏自定义入口，需要管理员开放相应能力。
2. 首次连接等待 `npx` 下载集成及依赖。连接成功后应能发现本文后面的 8 个工具。
3. 新建对话，启用这个连接器，发送：

   > 请调用 AVA 的 ava_check，然后调用 ava_demo，用示例数据体验收入变化分析。读取工具返回的实际结果，给我结论、结果表、图表和查询文件链接；如果没有预览图表，请明确说明。

4. 正确示例结果：1 月 30,000 美元、2 月 37,500 美元，增长 25%；Analytics 增加 6,000，Automation 增加 2,000，Support 增加 500，Reporting 减少 1,000，合计增加 7,500 美元。
5. 如需完整分析指导，从 [Releases](https://github.com/yvonneyx/ava-workbuddy/releases) 下载 Skill ZIP，在「技能 → 添加技能 → 上传技能」导入。单独安装 Skill 不会自动连接 MCP，需先完成步骤 1。
6. 上传自己的 CSV/XLSX，发送：

   > 使用 AVA 分析我上传的表格。先查看真实结构，再比较两个时期的收入，按产品拆解变化并核对合计。保存 SQL、结果数据和图表，说明指标口径及无法证明的原因。

可直接使用的 MCP 配置（与包内配置相同）：

```json
{
  "mcpServers": {
    "yvonneyx-ava": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "--yes",
        "--package=https://github.com/yvonneyx/ava-workbuddy/archive/refs/tags/v0.1.0.tar.gz",
        "ava-workbuddy",
        "serve"
      ],
      "runtime": { "type": "node", "version": ">=22.13.0 <23" },
      "timeout": 120000
    }
  }
}
```

此配置从已发布的版本标签安装，不需要先向 npm 发布本集成，也不依赖开发机的绝对路径。如果编辑的是现有配置，只合并 `mcpServers.yvonneyx-ava`，保留其他服务。初次包下载所需时间与工具调用超时是不同阶段；等待明确失败后再诊断，不连续重试安装。

### 路径二：按专家形式分发

[Releases](https://github.com/yvonneyx/ava-workbuddy/releases) 提供三种包：

| 文件 | 用途 |
| --- | --- |
| `ava-workbuddy-expert-0.1.0.zip` | 专家定义、头像、预加载 Skill、内置 `.mcp.json`，支持客户端/企业控制台提供的专家包导入流程 |
| `ava-workbuddy-connector-0.1.0.zip` | 提交 WorkBuddy 开放平台连接器审核的标准目录包 |
| `ava-workbuddy-skill-0.1.0.zip` | 手动上传技能；与已连接的 MCP 配合使用 |

导入专家包后选择「AVA 数据分析师」，按内联卡片连接其内置 MCP，再点击第一个推荐问题体验示例。专家包使用 `dependencies.mcpServers`，首次试用不依赖已上架的连接器 ID。不同账号和版本的导入入口可能不同；如果客户端没有专家包导入入口，先使用上面的自定义 MCP + Skill 路径，或由企业管理员上传专家包。

公开市场分发使用你提供的 [创建专家入口](https://open.workbuddy.cn/expert/publish?action=create&step=1)：上传专家 ZIP、按要求补齐平台资料，通过审核后发布。操作清单见 [发布指南](docs/publishing.md)。**GitHub 发布不等于 WorkBuddy 市场上架。** 审核和账号资料由仓库维护者在平台完成。

## 仓库结构

```text
connector/                       # 官方 Connector 目录格式
  connector-meta.json
  mcp.json
  icon.svg
expert/                          # 官方 Expert 目录格式
  .codebuddy-plugin/plugin.json
  agents/ava-data-analyst.md
  avatars/expert.png
skills/ava/                      # 官方 Skill 目录格式；唯一维护源
  SKILL.md
  references/
src/                             # 本地 stdio MCP，内部调用固定版本 AVA CLI
examples/                        # 8 行模拟销售数据和可复现 SQL
scripts/                         # 校验、生成三个 ZIP
test/                            # 行为测试、真实 MCP 集成测试、XLSX fixture
```

构建时将同一份 Skill 复制到连接器和专家包，并把 `connector/mcp.json` 复制成专家包根目录的 `.mcp.json`。发布包保留 `.codebuddy-plugin` 等隐藏文件，不复制 `node_modules`、本地配置、真实业务数据或凭证。

为什么使用 MCP + Skill：本集成是本地、免登录的数据工具；stdio 有明确的本地进程生命周期和结构化工具参数，适合 WorkBuddy 的标准接入方式。CLI 连接器的认证流程不适合用虚假的登录态替代。这里仍然复用 AVA CLI 的执行能力。

## 工具

| 工具 | 作用 |
| --- | --- |
| `ava_check` | 轻量检查 Node、平台、集成和 AVA 版本 |
| `ava_demo` | 独立核对示例总额与分项，保存查询、结果、HTML 并清理示例会话 |
| `ava_source` | 加载用户提供的本地 CSV/XLSX |
| `ava_schema` | 查看真实表、字段、查询语言及规则 |
| `ava_query` | 执行只读 SQL，返回真实结果及截断状态 |
| `ava_semantic` | 读取或完整替换当前会话的业务定义 |
| `ava_viz` | 将已核实数据渲染为新 HTML 文件 |
| `ava_dispose` | 释放本连接创建的空闲会话 |

示例交付包括 `sales.csv`、`schema.json`、`query.sql`、`result.json`、独立核对用的 `totals.json`、`chart.json`、`chart.html`、`report.txt`。默认输出到新建临时目录；传入 `outputDirectory` 可保存到工作空间中的新目录。临时文件的长期保留由系统决定，需要留存时请选择工作空间目录。

## 本地开发和验证

```sh
git clone https://github.com/yvonneyx/ava-workbuddy.git
cd ava-workbuddy
npm ci
npm test
npm run test:integration
npm run smoke
npm run test:package
npm run package
```

Node 22.13+，打包机还需要 `zip` / `unzip`。本地开发无需编译，使用原生 JavaScript ESM 和 Node 测试运行器。`npm-shrinkwrap.json` 将依赖版本随分发包锁定。`npm run package` 在 `dist/` 生成三个 ZIP 和 `SHA256SUMS`；本集成不定义安装后脚本，也不自动跑分析。

调试命令：

```sh
node src/cli.mjs check
node src/cli.mjs smoke
node src/cli.mjs demo /absolute/path/to/a-new-demo-directory
node src/cli.mjs serve
```

本地 MCP 调试配置可将 `command` 改为受支持 Node 的绝对路径，将 `args` 改为本仓库 `src/cli.mjs` 的绝对路径及 `serve`。不要把开发机路径提交到共享配置。

CI 在 macOS/Linux、Node 22/24 上检查元信息、测试真实 MCP 协议、CSV/XLSX、查询只读性、结果截断、不覆盖输出、会话清理与重启，并生成可下载的构建产物。CI 通过不代表 WorkBuddy 客户端导入或图表视觉预览已验证。

## 运行边界和故障排查

- 数据计算在本地 AVA 进程中进行；查询结果会返回 WorkBuddy 参与推理。数据仍受 WorkBuddy 模型服务的数据处理规则约束，不能据此承诺整个分析完全离线。
- 无远程 HTTP 服务、账号、OAuth、遥测或数据上传接口。进程具有 WorkBuddy 授予的本地文件权限，本项目不提供额外文件系统沙箱。
- 首次 Excel 读取可能从 DuckDB 官方下载 `excel` 扩展；失败时报告具体错误或改用 CSV，不自动安装另一套分析环境。
- 图表 HTML 需要联网加载 unpkg.com 上的 GPT-Vis。生成成功与浏览器预览成功分别记录；当前 AVA 4.0.0 的渲染器 URL未锁定版本。
- 会话闲置 30 分钟会过期。MCP 重启后重新加载源文件，恢复已确认口径；保存的会话 ID 不是持久化数据。
- 命令执行超时后可能仍在计算，本集成阻止对该会话自动重试/释放，并保留到 AVA 空闲过期。检查任务后再决定下一步。
- `listen EPERM` 通常表示宿主禁止 Unix socket/后台进程；确认 WorkBuddy 的执行环境权限，不修改全局安全设置。
- 已存在的输出文件和目录会被拒绝，选择一个新路径。
- 第三方 Skill/MCP 的安装可能受企业策略限制，需要管理员允许。Windows 支持、远程数据库、定时任务和文档联动不在 0.1.0 范围内。

## 官方规范与许可证

包结构参考 [WorkBuddy 连接器规范](https://open.workbuddy.cn/docs/connector)、[专家规范](https://open.workbuddy.cn/docs/expert)、[Skill 规范](https://open.workbuddy.cn/docs/skill)。MCP 使用官方 SDK 的当前稳定 v2 server/client 包。

MIT。上游 AVA 及其 Skill 来源、许可证见 [NOTICE](NOTICE)。本项目不代表 Tencent 或 AntV 官方。
