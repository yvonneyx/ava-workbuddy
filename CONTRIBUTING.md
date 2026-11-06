# 参与开发

本项目独立维护 WorkBuddy 接入，AVA 通过固定版本的 npm 依赖使用，不复制或修改上游核心实现。

## 本地开发

需要 macOS/Linux、Node.js 22.13+、npm；打包还需要 `zip`、`unzip` 和 `tar`。

```sh
npm ci
npm run build
npm test
npm run test:integration
```

`src/` 是 TypeScript 源码，`lib/` 是生成的 ESM、类型声明与源码映射。测试使用编译后的代码，避免只验证源码而漏掉分发问题。`npm test` 自动重新构建；修改源码后单独运行集成测试或 CLI 时，先执行 `npm run build`。

## 修改约定

- 开启 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`，不要用 `any` 或关闭检查来绕过类型错误。
- `Runtime` 管理会话和任务生命周期；`ava.ts` 集中处理 AVA 子进程、环境和文件路径校验；`server.ts` 负责 MCP 协议；示例保持在 `demo.ts`。库导入不得写 stdout、启动服务或安装信号处理器。
- 在文件、子进程和 MCP 边界保留校验。运行命令使用参数数组和 stdin，不拼接 shell；不转发模型凭据；不要覆盖用户文件。
- 会话只属于创建它的运行时；同一会话串行执行。超时、输出溢出或不可信响应都可能留下仍在执行的操作，不能自动重试或强制释放。
- 修改行为时补充能复现问题的测试。协议和安装方式变化必须跑集成测试与真实打包安装测试。
- Skill 只维护 `skills/ava/` 一份，分发时自动复制。文档中的版本与安装配置必须同步。

提交 PR 时说明触发场景、行为变化和实际执行的验证命令。保持修改聚焦，不提交 `lib/`、`dist/`、缓存或本机绝对路径。

## 提交前验证

```sh
npm run typecheck
npm test
npm run test:integration
npm run test:package
```

最后一项会构建和打包，随后在新目录安装 TGZ，检查公开导入、TypeScript 声明、本地查询和 CLI 首次分析。真实 AVA 测试需要允许子进程和 Unix socket；Excel 和图表部分可能访问网络。

发版流程见 [发布指南](docs/publishing.md)。GitHub 发版与 WorkBuddy 平台上架分别进行。
