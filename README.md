# AVA for WorkBuddy

<img src="public/icon.svg" width="88" alt="AntV logo">

在 WorkBuddy 中分析文件、数据库和飞书多维表格，核对指标变化，交付结论、结果表、交互图表和可追溯的 HTML 报告。

WorkBuddy 理解问题并编写 SQL，AVA 执行计算和制图。结构化数据分析无需额外模型 API Key；原生 `text`
数据源的文本提取需要配置模型。本仓库提供 MCP 连接器和「AVA 数据分析与报告」专家包。

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+。

## 开始使用

### 安装包

运行 `npm run package` 后，`dist/` 中生成：

| 使用方式   | 本地文件                            |
| ---------- | ----------------------------------- |
| AVA 专家   | `ava-workbuddy-expert-1.0.1.zip`    |
| 连接器     | `ava-workbuddy-connector-1.0.1.zip` |
| MCP 运行包 | `ava-workbuddy-1.0.1.tgz`           |

ZIP 的 MCP 配置使用同版本 GitHub Release 中的 TGZ；正式投递前需完成
[手动发布](CONTRIBUTING.md#手动发布)。同一对话只启用一个 AVA MCP 连接。示例问题：

```text
分析我上传的 CSV / Excel，核对指标变化，给出结论、结果表和图表链接。
```

上传 CSV / XLSX 并描述问题；也可下载 [模拟数据](tests/fixtures/sales.csv)
后上传体验。包校验和与发布流程见[手动发布](CONTRIBUTING.md#手动发布)。

### 本地开发

提供 **8 个 MCP 工具**，参数和分析规则由工具 schema 与描述提供。本地调试：

```sh
npm ci
npm run build
node lib/cli.js check
```

本地 MCP 配置：将 `connector/mcp.json` 中的 `command` 改为受支持 Node.js 的绝对路径，`args`
改为本仓库 `lib/cli.js` 的绝对路径和 `serve`。远程 Release 配置不会自动使用本地代码。

## 核心流程

**加载数据源 → 查看结构 → 执行只读查询 → 核对结果 → 生成图表或报告 → 释放会话**

MCP 工具描述和输入 schema 提供分析规则、参数与图表配置。报告包含结论、结果表、SQL 和可选图表，数据来自实际查询。

本地文件以私有副本分析，修改原文件后需重新加载；SQLite 快照包含已提交的 WAL 数据。会话闲置 30 分钟或连接重启后需重新加载；超时可能仍在计算，不要自动重试或释放。

## 数据源

`ava_source` 的 `path` 与 `config` 二选一；`type` 可覆盖文件格式。具体参数见 MCP 工具 schema。

| 数据源                            | 入口                                             |
| --------------------------------- | ------------------------------------------------ |
| CSV、JSON、Parquet、Excel、SQLite | 本地绝对路径；无扩展名时指定 `type`              |
| 内联 CSV、JSON、文本              | `config.type` 为 `csv`、`json`、`text`           |
| MySQL、PostgreSQL、MongoDB        | 直连数据库的原生配置                             |
| ClickHouse、Supabase              | 原生连接配置，AVA 自动选择对应引擎               |
| 飞书 / Lark 多维表格              | `/base/`、`/wiki/` URL，或 `feishu-bitable` 配置 |

也可用 `path: "@/absolute/path/source.json"` 读取本机配置，避免在对话中传递密码；普通 `.json`
路径按数据读取。配置通过 stdin 传给 AVA，报告来源只保存数据源类型或本地文件名。使用有权访问的只读账号，配置文件自行限制权限并妥善保管。

通用 HTTP(S) 文件和内置 SSH 隧道暂不支持，入口在执行前拒绝。对应上游问题：
[SSH 主机身份校验](https://github.com/antvis/AVA/issues/1082)、
[远程文件鉴权头转发](https://github.com/antvis/AVA/issues/1083)。请使用已授权的本地文件或直连数据库。

飞书凭据需预先通过 `AVA_FEISHU_APP_ID` / `AVA_FEISHU_APP_SECRET`、`~/.ava/feishu.json`
或配置提供，MCP 不进行交互式绑定。Wiki 还需 Wiki 读取权限和空间成员权限；加载的是整张表，`view`
筛选不生效。

## 数据与外部服务

- 数据源结构和查询结果会返回 WorkBuddy，适用其模型服务的数据处理规则。数据库和飞书按用户授权访问，不在本集成的运营后端存储。
- `text` 会把原始文本发送到用户配置的模型服务，使用前需授权该接收方并配置
  `OPENAI_API_KEY`。第三方账号、订阅和模型费用按相应服务规则处理。
- 输入副本与临时文件在正常释放会话后删除；超时或清理失败时保留，确认任务结束后可手动删除。最近 32 次查询证据在 MCP 连接关闭后清除，需保留时用
  `ava_artifact` 导出。
- 图表和报告以 `600`
  权限保存，内嵌查询数据；用户可自行删除，向他人分享前需确认数据授权。交互图表从 unpkg.com 加载 GPT-Vis 脚本，脚本可访问图表数据；无图表的报告可离线查看正文、表格和 SQL。
- 外部授权在数据库或飞书服务中撤回。只使用必要的只读权限，不在对话中提交密码或密钥。

## 开发与验证

核心是严格模式 TypeScript，编译为 ESM 和类型声明；`@antv/ava@4.0.0` 作为原样依赖，依赖版本由
`npm-shrinkwrap.json` 锁定。

| 命令                       | 用途                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `npm run build`            | 重新生成 `lib/`                                                  |
| `npm run typecheck`        | 类型检查                                                         |
| `npm test`                 | 构建并运行单元测试和配置校验                                     |
| `npm run test:integration` | 真实 MCP、文件/内联数据、禁用入口、只读查询、图表与报告验证      |
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
lib/、dist/   生成文件，不提交
```

开发与发布见[贡献指南](CONTRIBUTING.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。

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

Windows 尚未支持。数据库与飞书连接需要对应网络、权限和凭据，部分数据源需下载 DuckDB 扩展。图表沿用 AVA 的 GPT-Vis
CDN 地址，渲染器 URL 未锁定版本。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。上游来源和许可证见 [NOTICE](NOTICE)。
