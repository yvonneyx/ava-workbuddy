# AVA for WorkBuddy

<img src="public/icon.svg" width="88" alt="AntV logo">

在 WorkBuddy 中分析文件、数据库和飞书多维表格，核对指标变化，交付结论、结果表、交互图表和可追溯的
HTML 报告。

WorkBuddy 理解问题并编写 SQL，AVA 执行计算和制图。结构化数据分析无需额外模型 API Key；原生 `text` 数
据源的文本提取需要配置模型。本仓库提供 MCP 连接器和「AVA 数据分析师」专家包。

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+。

## 开始使用

### 1.0.0（待发布）

1.0.0 已完成本地构建与验证，尚未创建 GitHub Release。`dist/` 中的正式包：

| 使用方式   | 本地文件                            |
| ---------- | ----------------------------------- |
| AVA 专家   | `ava-workbuddy-expert-1.0.0.zip`    |
| 连接器     | `ava-workbuddy-connector-1.0.0.zip` |
| MCP 运行包 | `ava-workbuddy-1.0.0.tgz`           |

ZIP 内 MCP 配置已预设 v1.0.0 的公开 TGZ 地址；发布前该地址不可用，尚不能用于正式投递安装。本地调试按
下方说明使用本仓库构建。发布后，同一对话只启用一个 AVA MCP 连接。示例问题：

```text
分析我上传的 CSV / Excel，核对指标变化，给出结论、结果表和图表链接。
```

上传 CSV / XLSX 并描述问题；也可下载 [模拟数据](tests/fixtures/sales.csv) 后上传体验。包校验和与发布
流程见[发布指南](docs/publishing.md)。

### 本地开发

1.0.0 提供 **8 个工具**，支持 AVA 4.0.0 的全部 14 种数据源类型。报告与查询证据通过 MCP 提供，不依赖
独立 Skill。需要修改源码或本地调试时：

```sh
npm ci
npm run build
node lib/cli.js check
```

本地 MCP 配置：将 `connector/mcp.json` 中的 `command` 改为受支持 Node.js 的绝对路径，`args` 改为本仓
库 `lib/cli.js` 的绝对路径和 `serve`。远程 Release 配置不会自动使用本地代码。

## 核心流程

**加载数据源 → 查看结构 → 执行只读查询 → 核对结果 → 生成图表或报告 → 释放会话**

MCP 的工具描述和输入 schema 提供分析规则、参数与原生图表配置，无需加载额外指导文件。库调用见
[API](docs/api.md)。报告包含结论、结果表、SQL 和可选图表，数据来自实际查询证据。

- 文件、内联数据和飞书表格由本地 DuckDB 查询，MySQL/PostgreSQL/SQLite/MongoDB 通过 DuckDB 扩展接入
  ；ClickHouse 和 Supabase 使用远程引擎。查询结果返回 WorkBuddy，适用其模型服务的数据处理规则。
- 源文件只读，已有输出不覆盖。进程使用 WorkBuddy 授予的本地权限，本项目不提供额外文件系统沙箱。
- Excel 首次读取可能下载 DuckDB `excel` 扩展；交互图表需联网加载 GPT-Vis。HTML 生成成功与实际视觉预
  览分别验证。
- 会话闲置 30 分钟或连接重启后需重新加载数据源；超时可能仍在计算，不要自动重试或释放。
- 报告内嵌查询结果，分享 HTML 也会分享这些数据。正文、表格和 SQL 可离线查看。

## 数据源

`ava_source` 保留 `path` 参数，新增 `config` 和文件格式覆盖 `type`。`path` 与 `config` 二选一；具体
配置示例见 [API](docs/api.md#数据源配置)。

| 数据源                            | 入口                                             |
| --------------------------------- | ------------------------------------------------ |
| CSV、JSON、Parquet、Excel、SQLite | 本地绝对路径；无扩展名时指定 `type`              |
| HTTP(S) CSV、JSON、Parquet、Excel | URL；鉴权请求头放在 `config.options.headers`     |
| 内联 CSV、JSON、文本              | `config.type` 为 `csv`、`json`、`text`           |
| MySQL、PostgreSQL、MongoDB        | 原生连接配置，支持 AVA 的 SSH 等选项             |
| ClickHouse、Supabase              | 原生连接配置，AVA 自动选择对应引擎               |
| 飞书 / Lark 多维表格              | `/base/`、`/wiki/` URL，或 `feishu-bitable` 配置 |

也可用 `path: "@/absolute/path/source.json"` 读取本机配置，避免在对话中传递密码；普通 `.json` 路径按
数据读取。配置通过 stdin 传给 AVA，报告来源只保存数据源类型或本地文件名。使用有权访问的只读账号，配
置文件自行限制权限并妥善保管。

飞书凭据需预先通过 `AVA_FEISHU_APP_ID` / `AVA_FEISHU_APP_SECRET`、`~/.ava/feishu.json` 或配置提供，
MCP 不进行交互式绑定。Wiki 还需 Wiki 读取权限和空间成员权限；加载的是整张表，`view` 筛选不生效。
`text` 需 `OPENAI_API_KEY`，并会把文本发送到配置的模型服务。

## 开发与验证

核心是严格模式 TypeScript，编译为 ESM 和类型声明；`@antv/ava@4.0.0` 作为原样依赖，依赖版本由
`npm-shrinkwrap.json` 锁定。

| 命令                       | 用途                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run build`            | 重新生成 `lib/`                                                  |
| `npm run typecheck`        | 类型检查                                                         |
| `npm test`                 | 构建并运行单元测试和配置校验                                     |
| `npm run test:integration` | 真实 MCP、文件/内联/HTTP 数据源、只读查询、图表与报告验证        |
| `npm run test:package`     | 构建、打包，在新目录安装并验证公开 API 和首次分析                |
| `npm run package`          | 重建 `dist/`，生成 TGZ、两个 ZIP 和 `SHA256SUMS`；需要 zip/unzip |

集成测试和 CLI 使用编译结果，修改源码后先构建。CI 覆盖 macOS / Linux、Node.js 22 / 24。

```text
src/          TypeScript 运行时、MCP、CLI 和报告
public/       HTML 报告模板、图标和头像的唯一维护源
tests/        单元与集成测试、demo helper 和 fixtures
connector/    连接器元信息和 MCP 配置
expert/       专家身份、表达偏好和展示信息
scripts/      配置校验、打包和安装验证
docs/         API 和发布指南
lib/、dist/   生成文件，不提交
```

库使用方式与错误处理见 [API](docs/api.md)，开发约定见 [贡献指南](CONTRIBUTING.md)，当前版本变化见
[CHANGELOG](CHANGELOG.md)。

## 常见问题

| 情况                | 处理                                                          |
| ------------------- | ------------------------------------------------------------- |
| 找不到 MCP 导入入口 | 检查 WorkBuddy 版本和企业策略                                 |
| 首次连接失败        | 检查 GitHub / npm 下载和实际错误信息                          |
| `listen EPERM`      | 检查后台进程、Unix socket 和临时目录权限                      |
| Excel 加载失败      | 检查 `excel` 扩展下载，或导出为 CSV                           |
| HTML 图表空白       | 检查预览环境能否访问 unpkg.com                                |
| 输出已存在          | 使用新文件名或新目录                                          |
| 报告未使用固定模板  | 确认调用 `ava_artifact`；停用旧同名 Skill 或旧 MCP 后新建会话 |

Windows 尚未支持。数据库与飞书连接需要对应网络、权限和凭据，部分数据源需下载 DuckDB 扩展。图表沿用
AVA 的 GPT-Vis CDN 地址，渲染器 URL 未锁定版本。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。上游来源和许可证见 [NOTICE](NOTICE)。
