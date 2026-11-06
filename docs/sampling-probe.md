# WorkBuddy Sampling 最小探测

这是开发用独立探测器，不改变现有 AVA MCP 的工具或模型配置。

## 本机实测结果（2026-11-06）

- WorkBuddy 桌面版：5.9.4。
- stdio 协议版本：2025-11-25。
- 连接器安装检查客户端 `workbuddy-mcp-probe:custom-mcp:ava-sampling-probe` 的能力为 `{}`。
- 实际聊天会话随后调用 `ava_sampling_capabilities`，其客户端 `ava-sampling-probe` 的能力也为 `{}`。
- 实际调用 `ava_sampling_probe` 返回 `Host did not advertise sampling capability; no model request sent.`。
- 因宿主没有声明 Sampling，探测器未发送 `sampling/createMessage`，也未执行 AVA SDK `analyze()`。

这说明当前客户端的第三方 stdio MCP 路径没有开放 Sampling。此结果不推断其他 WorkBuddy 版本、产品形态或内置组件的支持情况。

原始记录保存在本机 `workbuddy-sampling-probe-20261106` 目录中的 `handshake.json`、`events.jsonl` 和 `assessment.json`。区分安装检查握手与实际工具调用握手，不能仅凭安装成功推断 Sampling 可用。

## 复测

用 Node.js 22.13+ 启动：

```sh
node /absolute/path/to/ava-workbuddy/scripts/sampling-probe.mjs /absolute/path/to/new-probe-output
```

把该命令配置为独立的 stdio MCP；保留现有连接器。文件配置变更后，本次实测需要重启 WorkBuddy 才在自定义连接器管理页出现。随后按顺序调用：

1. `ava_sampling_capabilities`：保存实际握手能力与版本。
2. `ava_sampling_probe`：只在宿主声明 Sampling 时发送固定、无敏感信息的生成请求；返回实际模型和文本，同时检查测试标记。
3. `ava_sdk_analyze_demo`：仅在同一连接的真实 Sampling 回包成功后开放。通过文本模型适配器调用 AVA SDK 的 `analyze()`，使用随包 8 行模拟 CSV，核对 1 月收入为 30000、2 月为 37500，并释放 SDK 引擎。

整个探测不读取模型密钥或复制登录凭据。日志包含固定提示词和模拟数据；使用私有文件权限保存。适配器当前只支持非流式文本生成，不支持带工具或多模态的模型调用。

本地代码检查：`node --test test/sampling-probe.test.mjs`。夹具测试只验证探测器和 AI SDK 适配，不代表 WorkBuddy 的真实 Sampling 成功。
