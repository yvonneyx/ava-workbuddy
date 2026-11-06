// -----------------------------------------------------------------------------
// 公开库入口；导入不会启动 MCP 或注册进程信号
// -----------------------------------------------------------------------------

export { Runtime } from './runtime.js';
export { AVACommandError, checkEnvironment } from './ava.js';
export type { ArtifactInput } from './artifact.js';
export type {
  ChartSpec,
  CleanupReport,
  SourceResult,
  SchemaResult,
  QueryResult,
  ExecutedQueryResult,
  SemanticDefinition,
} from './contracts.js';
