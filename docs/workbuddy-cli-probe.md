# WorkBuddy 内置 CLI → AVA SDK 实测

2026-11-06，在 WorkBuddy AI 5.9.4、Node.js 22.22.0、`@antv/ava` 4.0.0 上测试。

## 结果

| 检查 | 真实结果 |
| --- | --- |
| 不指定模型，使用默认模型及现有登录 | 返回 `Authentication required`，未成功推理；进程退出码仍为 0 |
| 显式选择当前会话的 `custom-local:deepseek-v4-pro` | 返回 `AVA_CLI_OK_20261106`，结果事件为 `success` |
| 同一模型通过自定义 AI SDK LanguageModel 接入 AVA | 完整 `AVA.analyze()` 成功，两次模型调用 |
| SQL 实际执行结果 | 2025-01：30000 美元；2025-02：37500 美元 |
| 模型生成的中文结论 | 增加 7500 美元，环比增长 25%；与计算结果一致 |

本次复用的是 WorkBuddy **已配置的自定义模型**。CLI 自行加载本机模型配置，探测脚本没有读取、复制或导出 API Key、登录 token。

这不证明 WorkBuddy 内置账号模型或积分可复用。独立 CLI 的默认模型调用失败，日志中认证存储报告 `missing-key`，随后返回登录要求。不能把 `apiKeySource` 字段或进程退出码 0 当作登录复用成功的证据。

## 调用方式

应用包的普通 `cli/bin/codebuddy` 入口引用了本安装中不存在的 `dist/codebuddy`；本次直接执行实际随包发布的入口：

```text
/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs
```

为该子进程设置 `WORKBUDDY_CONFIG_DIR`、`CODEBUDDY_CONFIG_DIR` 指向本机的 `~/.workbuddy-ai`，`ACC_PRODUCT_CONFIG_PATH` 指向同一安装包的 `cli/product.json`。没有更改全局环境变量。

`--model custom-local:deepseek-v4-pro` 与探测会话在 WorkBuddy 数据库中保存的模型一致。**模型选择需要显式传入**，不传时本机 CLI 使用的是 `default-model`。

适配器使用 `--tools ''` 禁用工具、`--strict-mcp-config` 加空 MCP 配置隔离连接器，使用独立新会话且关闭会话持久化。结果解析器会拒绝工具调用、错误结果、空文本和模型选择不匹配。CLI 的 init 事件仍列出注册的工具清单，该清单不等同于本次启用工具；实测响应没有工具调用。

## 复现

在本仓库根目录，用 Node.js 22.13+ 运行，显式传入本机已配置的模型 ID：

```sh
node scripts/workbuddy-cli-analyze.mjs /absolute/path/to/new-probe-output custom-local:your-model-id
```

使用随包的 `examples/sales.csv`，仅含 8 行模拟数据。真正调用 `AVA.source()`、`AVA.analyze()`，最终在 `finally` 中调用 `AVA.dispose()`。SQL 由模型生成，DuckDB 执行，说明由第二次模型调用生成。断言检查两行金额、无截断、SQL/结论均存在及模型调用次数。

第一轮 SQL 执行成功，但结果说明把可选字符串 `nextStep` 返回成了 `null`，未通过 AVA 的 schema 校验。给 CLI 系统提示补充“可选字段不存在时省略，不返回 null”后，重新运行整个流程成功；没有修改或伪造模型结果，也没有修改 AVA SDK。

目录中的 `first-attempt-sdk-model-call-*.json` 保存首次调用，`sdk-model-call-*.json` 保存最终成功的模型调用；`sdk-analysis.json` 为 SDK 原始返回，`sdk-verification.json` 为计算断言结果，`assessment.json` 为本次结论。

## 范围

这是开发用实验适配器，未接入专家包或公开库 API。默认读取当前用户的 `~/.workbuddy-ai`，可用 `WORKBUDDY_CONFIG_DIR` 覆盖；默认使用上述 macOS 应用路径，可用 `WORKBUDDY_CLI_ROOT` 覆盖 CLI 根目录。输出目录必须是新目录，模型 ID 必须显式传入。只覆盖 direct 分析使用的文本、非流式生成，不支持工具策略、图片、流式输出，也没有映射采样参数。内置 CLI 路径和行为可能随 WorkBuddy 升级改变。

解析器夹具测试：`node --test test/workbuddy-cli-model.test.mjs`。它验证错误与模型选择校验，不调用真实模型，也不代表内置账号额度可复用。

自定义模型调用是否收费，由该模型服务决定。本次不能推断其消耗 WorkBuddy 内置积分。
