# AVA for WorkBuddy

<img src="public/icon.svg" width="88" alt="AntV logo">

在 WorkBuddy 中分析本地 CSV / Excel，核对指标变化，交付结论、结果表、交互图表和可追溯的 HTML 报告。

WorkBuddy 理解问题并编写 SQL，AVA 在本地执行计算和制图，无需额外模型 API Key。本仓库提供 MCP 连接器
、分析 Skill 和「AVA 数据分析助手」专家包。

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+。

## 开始使用

### 已发布版本

按使用方式选择一种安装入口：

| 使用方式                  | 安装包                                                                                                                                           | 包含                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 直接使用 AVA 专家（推荐） | [专家 ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-expert-0.2.1.zip)                                    | 专家角色、Skill、MCP 配置   |
| 给现有助手添加 AVA        | [连接器 ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-connector-0.2.1.zip)                               | 连接器信息、Skill、MCP 配置 |
| 手动配置                  | [`mcp.json`](connector/mcp.json) + [Skill ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-skill-0.2.1.zip) | 分别接入工具和分析方法      |

在 WorkBuddy 对应入口导入。同一对话只启用一个 AVA MCP 连接，无需重复导入 Skill。手动配置时，只将
`mcpServers.yvonneyx-ava` 合并到已有 MCP 配置。

以上入口均安装 **v0.2.1**；首次运行需访问 GitHub 和 npm。安装后发送：

```text
分析我上传的 CSV / Excel，核对指标变化，给出结论、结果表和图表链接。
```

上传 CSV / XLSX 并描述问题；也可下载 [模拟数据](tests/fixtures/sales.csv) 后上传体验。包校验和与发布
流程见[发布指南](docs/publishing.md)。

### 当前源码

当前源码提供 **8 个工具**，新增 `ava_artifact` 和查询证据编号，移除了内置 demo 入口。已发布 v0.2.1
尚无报告功能。要体验完整 HTML 报告，使用本地构建：

```sh
npm ci
npm run build
node lib/cli.js check
```

本地 MCP 配置：将 `connector/mcp.json` 中的 `command` 改为受支持 Node.js 的绝对路径，`args` 改为本仓
库 `lib/cli.js` 的绝对路径和 `serve`。远程 Release 配置不会自动使用本地代码。

## 核心流程

**加载文件 → 查看结构 → 执行只读查询 → 核对结果 → 生成图表或报告 → 释放会话**

工具参数由 MCP 的描述和输入 schema 提供。可选的 [AVA Skill](skills/ava/SKILL.md) 补充指标核对、证据
组织和交付方法。库调用见 [API](docs/api.md)。报告包含结论、结果表、SQL 和可选图表，数据来自实际查询
证据。

- 数据在本地 AVA 进程中计算；查询结果返回 WorkBuddy，适用其模型服务的数据处理规则。
- 源文件只读，已有输出不覆盖。进程使用 WorkBuddy 授予的本地权限，本项目不提供额外文件系统沙箱。
- Excel 首次读取可能下载 DuckDB `excel` 扩展；交互图表需联网加载 GPT-Vis。HTML 生成成功与实际视觉预
  览分别验证。
- 会话闲置 30 分钟或连接重启后需重新加载文件；超时可能仍在计算，不要自动重试或释放。
- 报告内嵌查询结果，分享 HTML 也会分享这些数据。正文、表格和 SQL 可离线查看。

## 开发与验证

核心是严格模式 TypeScript，编译为 ESM 和类型声明；`@antv/ava@4.0.0` 作为原样依赖，依赖版本由
`npm-shrinkwrap.json` 锁定。

| 命令                       | 用途                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run build`            | 重新生成 `lib/`                                                  |
| `npm run typecheck`        | 类型检查                                                         |
| `npm test`                 | 构建并运行单元测试和配置校验                                     |
| `npm run test:integration` | 真实 MCP、CSV/XLSX、只读查询、图表与报告验证                     |
| `npm run test:package`     | 构建、打包，在新目录安装并验证公开 API 和首次分析                |
| `npm run package`          | 重建 `dist/`，生成 TGZ、三个 ZIP 和 `SHA256SUMS`；需要 zip/unzip |

集成测试和 CLI 使用编译结果，修改源码后先构建。CI 覆盖 macOS / Linux、Node.js 22 / 24。

```text
src/          TypeScript 运行时、MCP、CLI 和报告
public/       HTML 报告模板、图标和头像的唯一维护源
tests/        单元与集成测试、demo helper 和 fixtures
skills/ava/   分析流程与参考资料，唯一维护源
connector/    连接器元信息和 MCP 配置
expert/       专家身份、表达偏好和展示信息
scripts/      配置校验、打包和安装验证
docs/         API 和发布指南
lib/、dist/   生成文件，不提交
```

库使用方式与错误处理见 [API](docs/api.md)，开发约定见 [贡献指南](CONTRIBUTING.md)，当前版本变化见
[CHANGELOG](CHANGELOG.md)。

## 常见问题

| 情况                        | 处理                                     |
| --------------------------- | ---------------------------------------- |
| 找不到 MCP / Skill 导入入口 | 检查 WorkBuddy 版本和企业策略            |
| 首次连接失败                | 检查 GitHub / npm 下载和实际错误信息     |
| `listen EPERM`              | 检查后台进程、Unix socket 和临时目录权限 |
| Excel 加载失败              | 检查 `excel` 扩展下载，或导出为 CSV      |
| HTML 图表空白               | 检查预览环境能否访问 unpkg.com           |
| 输出已存在                  | 使用新文件名或新目录                     |

当前支持本地 CSV / XLSX；Windows 和远程数据库尚未支持。图表沿用 AVA 的 GPT-Vis CDN 地址，渲染器 URL
未锁定版本。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。上游来源和许可证见 [NOTICE](NOTICE)。
