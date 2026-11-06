# AVA for WorkBuddy

<img src="connector/icon.svg" width="88" alt="AntV logo">

在 WorkBuddy 中分析本地 CSV / Excel，核对指标变化，交付结论、结果表、交互图表和可追溯的 HTML 报告。

WorkBuddy 理解问题并编写 SQL，AVA 在本地执行计算和制图，无需额外模型 API Key。本仓库提供 MCP 连接器、分析 Skill 和「AVA 数据分析助手」专家包。

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+。

## 开始使用

### 已发布版本

将 [`connector/mcp.json`](connector/mcp.json) 添加到 WorkBuddy 的自定义 MCP 配置。它通过 `npx` 下载固定的 **v0.2.1** 预编译包；首次运行需要访问 GitHub 和 npm。已有其他服务时，只合并 `mcpServers.yvonneyx-ava`。

启用连接器后发送：

```text
请用 AVA 检查环境，再用内置示例分析收入变化。
核对收入总额与各产品贡献，给出结论、结果表、图表和 SQL 文件链接。
如果没有实际预览图表，请说明。
```

示例包含 8 行模拟销售数据：2025 年 1 月收入 30,000 美元，2 月 37,500 美元，增加 7,500 美元（25%）。Analytics 贡献净增量的 80%，Reporting 减少 1,000 美元。数据支持变化拆解，不能证明原因。

分析自己的文件时，导入 [AVA Skill ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-skill-0.2.1.zip)，上传 CSV / XLSX，再描述问题。先检查真实字段、确认业务口径、核对计算，再生成图表。建议把 SQL、结果和报告保存在工作空间的新目录中。

完整入口可使用 [专家 ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-expert-0.2.1.zip)；单独发布连接器可使用 [连接器 ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-connector-0.2.1.zip)。同一对话启用一个 AVA MCP 连接即可。包校验和与发布流程见 [发布指南](docs/publishing.md)。

### 当前源码

当前源码提供 **9 个工具**；已发布 v0.2.1 提供 8 个，尚无 `ava_artifact` 和查询证据编号。要体验完整 HTML 报告，使用本地构建：

```sh
npm ci
npm run build
node lib/cli.js demo /absolute/path/to/a-new-directory
```

本地 MCP 配置：将 `connector/mcp.json` 中的 `command` 改为受支持 Node.js 的绝对路径，`args` 改为本仓库 `lib/cli.js` 的绝对路径和 `serve`。远程 Release 配置不会自动使用本地代码。

## 核心流程

**加载文件 → 查看结构 → 执行只读查询 → 核对结果 → 生成图表或报告 → 释放会话**

| 工具 | 用途 |
| --- | --- |
| `ava_check` | 检查运行环境和依赖版本 |
| `ava_demo` | 运行示例并核对总额与分项 |
| `ava_source` | 加载本地 CSV / XLSX |
| `ava_schema` | 查看真实表、字段和查询规则 |
| `ava_query` | 执行只读 SQL，返回结果、截断状态与 `queryId` |
| `ava_semantic` | 读取或完整替换会话业务定义 |
| `ava_viz` | 将已核实的数据渲染为新 HTML |
| `ava_artifact` | 将多轮问题、结论、指标、图表、结果表和 SQL 汇总为报告 |
| `ava_dispose` | 释放当前连接创建的空闲会话 |

`ava_artifact` 使用 [`templates/artifact.html`](templates/artifact.html) 固定模板，从实际查询记录取得 SQL 和结果，并保存同名证据 JSON。图表沿用 AVA 的 `chartType/config`，数据从查询证据绑定，外观交给 AVA。相同的配置结构也用于 `ava_viz`。同一连接保留最近 32 次查询；追问时传入完整章节，使用新文件名生成新版报告。参数见 [工具说明](skills/ava/references/tools.md#analysis-artifact)。

- 数据在本地 AVA 进程中计算；查询结果返回 WorkBuddy，适用其模型服务的数据处理规则。
- 源文件只读，已有输出不覆盖。进程使用 WorkBuddy 授予的本地权限，本项目不提供额外文件系统沙箱。
- Excel 首次读取可能下载 DuckDB `excel` 扩展；交互图表需联网加载 GPT-Vis。HTML 生成成功与实际视觉预览分别验证。
- 会话闲置 30 分钟或连接重启后需重新加载文件；超时可能仍在计算，不要自动重试或释放。
- 报告内嵌查询结果，分享 HTML 也会分享这些数据。正文、表格和 SQL 可离线查看。

## 开发与验证

核心是严格模式 TypeScript，编译为 ESM 和类型声明；`@antv/ava@4.0.0` 作为原样依赖，依赖版本由 `npm-shrinkwrap.json` 锁定。

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 重新生成 `lib/` |
| `npm run typecheck` | 类型检查 |
| `npm test` | 构建并运行单元测试和配置校验 |
| `npm run test:integration` | 真实 MCP、CSV/XLSX、只读查询、图表与报告验证 |
| `npm run smoke` | 临时目录中的完整示例 |
| `npm run test:package` | 构建、打包，在新目录安装并验证公开 API 和首次分析 |
| `npm run package` | 重建 `dist/`，生成 TGZ、三个 ZIP 和 `SHA256SUMS`；需要 zip/unzip |

集成测试和 CLI 使用编译结果，修改源码后先构建。CI 覆盖 macOS / Linux、Node.js 22 / 24。

```text
src/          TypeScript 运行时、MCP、CLI、报告和示例
skills/ava/   分析指导及工具、图表参考，唯一维护源
connector/    连接器元信息、MCP 配置和图标
expert/       专家配置、指令和头像
templates/    固定 HTML 报告模板
examples/     模拟数据与可复现 SQL
scripts/      配置校验、打包和安装验证
test/         单元、集成测试与 XLSX 夹具
docs/         API 和发布指南
lib/、dist/   生成文件，不提交
```

库使用方式与错误处理见 [API](docs/api.md)，开发约定见 [贡献指南](CONTRIBUTING.md)，当前版本变化见 [CHANGELOG](CHANGELOG.md)。

## 常见问题

| 情况 | 处理 |
| --- | --- |
| 找不到 MCP / Skill 导入入口 | 检查 WorkBuddy 版本和企业策略 |
| 首次连接失败 | 检查 GitHub / npm 下载和实际错误信息 |
| `listen EPERM` | 检查后台进程、Unix socket 和临时目录权限 |
| Excel 加载失败 | 检查 `excel` 扩展下载，或导出为 CSV |
| HTML 图表空白 | 检查预览环境能否访问 unpkg.com |
| 输出已存在 | 使用新文件名或新目录 |

当前支持本地 CSV / XLSX；Windows 和远程数据库尚未支持。图表沿用 AVA 的 GPT-Vis CDN 地址，渲染器 URL 未锁定版本。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。上游来源和许可证见 [NOTICE](NOTICE)。
