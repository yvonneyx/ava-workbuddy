# 库 API

核心代码使用 TypeScript，提供 Node.js ESM 与生成的 `.d.ts`。支持 macOS/Linux、Node.js 22.13+。这是本
地分析库，需要文件系统、子进程和 Unix socket，不适用于浏览器运行环境。

## 安装

本文描述当前源码 API；已发布 v0.2.1 不含 `artifact()` 和查询证据编号。报告功能需从源码构建。

```sh
npm install https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-0.2.1.tgz
```

Release 的 TGZ 已编译，使用者不需要 TypeScript 编译器。源码开发者需要 `npm ci && npm run build`。不
要安装 GitHub 自动生成的源码归档来直接运行 CLI。

## 公开入口

| 入口                | 导出                                                        |
| ------------------- | ----------------------------------------------------------- |
| `ava-workbuddy`     | `Runtime`、`AVACommandError`、`checkEnvironment` 及结果类型 |
| `ava-workbuddy/mcp` | `createServer`、`serve`                                     |

仅这两个入口属于公开 API；不要依赖 `lib/` 内部文件。0.x 阶段的 API 变化记录在 CHANGELOG，调整接口时
升级次版本。

## Runtime

一个实例管理一组自己创建的会话。所有方法返回 Promise，同一会话的并发操作会被拒绝。

| 方法                               | 返回与约束                                                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source(path)`                     | `{ datasetId }`；绝对路径、现存本地 CSV/XLSX，文件只读                                                                                                                                                                                                         |
| `schema(datasetId)`                | `SchemaResult`；真实表、字段、类型及查询语言                                                                                                                                                                                                                   |
| `query(datasetId, sql, maxRows?)`  | `ExecutedQueryResult`（含 `queryId`）；只读 SQL，最多 512 KiB；返回行数 1–10000，默认 200                                                                                                                                                                      |
| `semantic(datasetId, definition?)` | `SemanticDefinition`；省略时读取，传入对象时完整替换，不自动改写 SQL                                                                                                                                                                                           |
| `viz(spec, output)`                | `{ output }`；`spec` 包含 `chartType` 和 `config`，输出必须是新 `.html` 绝对路径，父目录已存在                                                                                                                                                                 |
| `artifact(input)`                  | 固定模板分析 HTML；图表使用 AVA 原生 `{ chartType, config }`，数据从 `queryId` 的结果绑定，特殊结构通过 `chartConfigField` 引用；内嵌 SQL、来源和图表，自动保存同名 `.json`，返回 `output`、`dataOutput`、章节数、查询数及 `chartErrors`；两份文件均不得已存在 |
| `dispose(datasetId)`               | `{ datasetId, disposed: true }`；释放当前实例拥有的空闲会话                                                                                                                                                                                                    |
| `close()`                          | `CleanupReport`；拒绝新任务、等待已接受任务、释放确定空闲的会话；重复调用复用同一结果                                                                                                                                                                          |

`QueryResult.data` 为 `Record<string, unknown>[]`。字段来自用户数据，取值前检查或转换类型；不要假定
数字一定以 JavaScript number 返回。`truncated === true` 时结果不完整，需修改聚合或限制后再分析。

当前源码新增（尚未发布）：`query()` 返回兼容 `QueryResult` 的 `ExecutedQueryResult`，额外包含
`queryId`。同一 Runtime 保留最近 32 次查询的不可变证据快照，数据集释放后仍可生成报告；关闭 Runtime
后清除。`ArtifactInput` 从公开库入口导出，字段说明和校验由
[artifact 输入 schema](../src/artifact.ts) 统一维护，原生数据形状见
[图表参考](../skills/ava/references/charts.md)。报告生成不会自行验证助手结论，
`chartPreviewVerified` 保持 false，直到宿主实际预览。

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

示例 SQL 仅适用于 [测试 CSV](../tests/fixtures/sales.csv) 的字段。业务文件应先读取 `schema`，按真实
表名、字段和确认过的指标口径编写查询。

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

- `checkEnvironment()`：检查 Node.js、系统和固定 AVA 版本；不验证 socket 可用性或图表视觉效果。

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
