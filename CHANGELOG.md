# 版本记录

## 未发布

- `ava_source` / `Runtime.source()` 支持 AVA 4.0.0 全部 14 种数据源：本地及 HTTP(S) 文件、内联
  CSV/JSON/text、MySQL/PostgreSQL/SQLite/MongoDB/ClickHouse/Supabase、飞书/Lark 多维表格。保留原
  `path` 调用，新增原生 `config`、`@配置文件` 与文件格式覆盖 `type`。配置通过 stdin 传入，报告来源只
  保存类型或本地文件名，加载错误移除已知连接凭据。查询使用数据源默认引擎的 SQL 方言。

- 分析流程迁入 MCP 工具描述，初始化 `instructions` 提供服务导航。删除独立 Skill、专家的 Skill 依赖和
  Skill 分发包；当前只构建运行 TGZ、连接器 ZIP 和专家 ZIP。工具参数、原生图表形状及证据绑定统一由
  MCP schema 说明。

- 静态资源集中到 `public/`；demo、模拟数据和 SQL 归入 `tests/`。移除生产端的 `ava_demo`、CLI
  `demo/smoke` 和库 `runDemo/smoke` 导出，正式工具保留分析与报告能力。统一换行、核心注释与职责分隔线
  。

- artifact 图表改用 AVA 原生 `chartType/config`，移除三种图表专用的字段转换。默认绑定 SQL 原生结果行
  ；`chartConfigField` 支持从单行查询配置对象绑定特殊数据结构。展示选项与图表类型校验交给 AVA，旧
  `type/categoryField/valueField` 参数不再支持。

- 精简运行时的重复会话状态、示例重复产物、模板隐藏字段与 CI 重复检查；分发包不再附带开发和发布文档。
  示例只生成一份报告及配套证据，移除 `chart`、`alternateArtifact` 返回字段。

- 新增 `ava_artifact` 和 `Runtime.artifact()`：按固定模板生成包含多轮问题、结论、指标、图表、结果表
  和 SQL 的 HTML，并保存同名证据 JSON，禁止覆盖已有文件。
- `ava_query` 返回 `queryId`；同一连接保留最近 32 次查询的不可变证据，报告直接使用实际 SQL 和结果。
  截断结果不绘图，图表失败仍保留表格与 SQL。
- SQL 支持离线语法高亮、折叠和原文复制；示例覆盖总体、产品贡献、回落追问与增量核对。
- 清理未接入正式功能的模型探测脚本、测试和实验文档，精简使用与发布说明；打包前清空生成目录，避免混入
  旧版本。

## 0.2.1 — 2026-11-06

- 专家名称统一为「AVA 数据分析助手」，标识为 `ava-workbuddy-assistant`。
- 发布包提供 8 个 MCP 工具、分析 Skill 和专家入口；使用预编译 TGZ 安装。

更早的变更见 Git 历史。
