# 库 API

提供 Node.js ESM 与 `.d.ts`，支持 macOS/Linux、Node.js 22.13+。需要文件系统、子进程和 Unix socket，
不能在浏览器中运行。

## 安装

本文描述当前源码 API；已发布 v0.2.1 不含 `artifact()` 和查询证据编号。已发布版本的安装入口见
[README](../README.md#已发布版本)。使用本文接口，先从源码打包：

```sh
npm ci
npm run package
```

在调用方项目执行 `npm install /absolute/path/to/ava-workbuddy-<version>.tgz`，安装 `dist/` 中生成的
预编译包。调用方无需 TypeScript 编译器。

## 公开入口

| 入口                | 导出                                                        |
| ------------------- | ----------------------------------------------------------- |
| `ava-workbuddy`     | `Runtime`、`AVACommandError`、`checkEnvironment` 及公开类型 |
| `ava-workbuddy/mcp` | `createServer`、`serve`                                     |

仅这两个入口属于公开 API；不要依赖 `lib/` 内部文件。0.x 阶段的 API 变化记录在 CHANGELOG，调整接口时
升级次版本。

## Runtime

一个实例管理自己创建的会话。方法均返回 Promise；同一会话的并发操作会被拒绝。

| 方法                               | 返回与约束                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `source(path)`                     | `{ datasetId }`；绝对路径、现存本地 CSV/XLSX，文件只读                                         |
| `schema(datasetId)`                | `SchemaResult`；真实表、字段、类型及查询语言                                                   |
| `query(datasetId, sql, maxRows?)`  | `ExecutedQueryResult`，含 `queryId`；只读 SQL，最多 512 KiB；`maxRows` 为 1–10000，默认 200    |
| `semantic(datasetId, definition?)` | `SemanticDefinition`；省略时读取，传入对象时完整替换，不自动改写 SQL                           |
| `viz(spec, output)`                | `{ output }`；`spec` 包含 `chartType` 和 `config`，输出必须是新 `.html` 绝对路径，父目录已存在 |
| `artifact(input)`                  | 从查询证据生成 HTML 和同名 JSON；返回文件路径、章节数、查询数与 `chartErrors`，详见下文        |
| `dispose(datasetId)`               | `{ datasetId, disposed: true }`；释放当前实例拥有的空闲会话                                    |
| `close()`                          | `CleanupReport`；拒绝新任务、等待已接受任务、释放确定空闲的会话；重复调用复用同一结果          |

`QueryResult.data` 为 `Record<string, unknown>[]`。字段来自用户数据，取值前检查或转换类型；不要假定
数字一定以 JavaScript number 返回。`truncated === true` 时结果不完整，需修改聚合或限制后再分析。

```ts
import { Runtime } from 'ava-workbuddy';

const runtime = new Runtime();
try {
  const { datasetId } = await runtime.source('/absolute/path/to/sales.csv');
  const schema = await runtime.schema(datasetId);
  console.log(schema.models);
  const result = await runtime.query(datasetId, 'SELECT SUM(revenue) AS revenue FROM data');
  if (result.truncated) throw new Error('结果不完整');
  console.log(result.data);
} finally {
  const report = await runtime.close();
  if (report.retained.length) console.error(report);
}
```

示例仅打印查询结果，假设表名为 `data` 且有 `revenue` 列。业务文件应先读取 `schema`，按真实字段和确认
的口径查询。

### 报告与证据保存

- `query()` 返回 `queryId`，对应实际 SQL、结果、来源和执行时间。同一 Runtime 保留最近 32 次查询的不
  可变快照，释放数据集后仍可生成报告；关闭 Runtime 后清除。
- `artifact()` 自动保存 HTML 和同名 JSON（`dataOutput`），内含 SQL、结果与证据，无需每次查询后重复导
  出。输出使用新 `.html` 绝对路径，父目录须存在；HTML 和 JSON 均不可覆盖。
- 需要保留的证据须在关闭 Runtime 或移出缓存前生成报告或导出。保存的文件不能恢复有效 `queryId`；新
  Runtime 需重新查询。
- 图表使用 `{ chartType, config }`，从查询证据绑定数据；特殊数据形状使用 `chartConfigField`。
  `ArtifactInput` 字段与校验以[输入 schema](../src/artifact.ts) 为准，数据形状见
  [图表参考](../skills/ava/references/charts.md)。
- 图表失败时报告仍保留表格和 SQL，错误见 `chartErrors`。工具不核验结论文案； `chartPreviewVerified`
  返回 false，宿主需另行验证图表预览。

### 错误与清理

输入错误和执行失败会抛出 Error。子进程超时、输出溢出或响应格式异常会产生 `AVACommandError`；其
`uncertain` 为 true 时，当前会话后续操作被阻止，以免误重试或释放仍在执行的查询。

`close()` 不把清理失败伪装成成功，也不把诊断写入库使用者的 stdout/stderr。返回：

```ts
interface CleanupReport {
  disposed: string[];
  retained: string[];
  errors: { datasetId: string; message: string }[];
}
```

`retained` 包括结果不确定或释放失败的会话。先检查任务状态；不要把 `dispose` 当作取消操作。AVA 会话在
无运行任务且闲置 30 分钟后到期。source 在返回 datasetId 前失败时，库可能无法获知新会话 ID，不能承诺
主动回收未知会话。

## 环境检查

`checkEnvironment()` 检查 Node.js、系统和固定 AVA 版本，不验证 socket 或图表预览。

## 嵌入 MCP

```ts
import { createServer } from 'ava-workbuddy/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const connection = createServer();
try {
  await connection.server.connect(new StdioServerTransport());
  // 宿主管理服务运行时间。
} finally {
  const cleanup = await connection.close();
  console.error(cleanup);
}
```

`createServer()` 不安装进程信号处理器。其 `close()` 关闭连接、等待已接受的工具调用，再关闭 Runtime；
连接自然结束时也会开始清理。关闭后不要再操作 `connection.runtime`。

`serve()` 是面向 CLI 的完整 stdio 生命周期，处理 EOF、SIGINT、SIGTERM，完成清理后返回。协议内容写
stdout，关闭错误写 stderr。普通库使用者应选择 `Runtime` 或 `createServer()`，由宿主管理生命周期。
