# 打包与发布

1.0.0 的运行包、专家包、连接器包和校验和统一通过
[GitHub Release](https://github.com/yvonneyx/ava-workbuddy/releases/tag/v1.0.0) 分发。
WorkBuddy 平台投递与审核另行进行。

## 分发包

`npm run package` 会清空并重建 `dist/`，生成当前版本的三个包和 `SHA256SUMS`：

| 包                                      | 用途                              |
| --------------------------------------- | --------------------------------- |
| `ava-workbuddy-<version>.tgz`           | 预编译 CLI 和 ESM 库，供 MCP 安装 |
| `ava-workbuddy-expert-<version>.zip`    | 专家配置、头像和内置 MCP          |
| `ava-workbuddy-connector-<version>.zip` | 连接器元信息与 MCP 配置           |

维护边界见[贡献指南](../CONTRIBUTING.md#修改约定)。组包规则：

- 专家包的 `.mcp.json` 来自 `connector/mcp.json`；保留 `.codebuddy-plugin` 等必需隐藏文件。
- 图标和头像从 `public/` 复制到平台要求的位置。TGZ 只附带运行所需的模板和图标，测试与 demo 不入包。
- GitHub 自动生成的源码归档不含 `lib/`，不能直接作为 MCP 运行包。

## 发布验证

先运行 `npm ci`，再依次执行：

| 命令                       | 验证内容                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm test`                 | 单元测试、MCP 初始化说明、配置版本与资源                                                               |
| `npm run test:integration` | 真实 MCP、CSV/XLSX、查询和报告流程                                                                     |
| `npm run test:package`     | 两个 ZIP 的 MCP 配置和资源与维护源逐字节一致，确认不含旧 Skill；隔离安装 TGZ，验证类型、API 和完整分析 |

`test:package` 自动重建分发包。自动化不包含 WorkBuddy 客户端导入、平台审核或图表视觉验收。

## 维护者发版

1. 同步包、锁文件、连接器和专家的版本，更新 MCP 安装 URL、文档链接与 CHANGELOG。已发布文件不覆盖，版
   本变化使用新的 Release。
2. 通过上述发布验证。
3. 推送源码与 tag，在对应 GitHub Release 上传三个同版本包和 `SHA256SUMS`。预览版标记 prerelease；已
   发布文件不覆盖。
4. 核对下载链接和校验和，再用远程 TGZ 地址执行 `npx --yes --package=<URL> ava-workbuddy check`。
5. 需要更新 WorkBuddy 专家或连接器时，另行上传新包并完成客户端验证和平台审核。

MCP 安装指向远程 TGZ。本地打包不会让现有连接自动切换到当前源码；调试请按
[README](../README.md#本地开发) 使用本地 `lib/cli.js`。

## WorkBuddy 投递

专家投递上传 `ava-workbuddy-expert-1.0.0.zip`；连接器投递上传
`ava-workbuddy-connector-1.0.0.zip`。TGZ 位于同一公开 GitHub Release，供包内 MCP 配置通过 `npx`
安装。校验文件为同一 Release 中的 `SHA256SUMS`。

专家字段由 ZIP 内 `.codebuddy-plugin/plugin.json` 提供，Agent 声明、头像和 `.mcp.json` 已组包。平台
需填写的名称、介绍、分类、标签和快捷提问以该文件为准。专家无需独立 Skill。连接器字段由 ZIP 内
`connector-meta.json` 提供，图标与 `mcp.json` 已组包；本地 stdio 无独立服务登录。

投递入口与字段以 [WorkBuddy 专家规范](https://open.workbuddy.cn/docs/expert) 和
[连接器规范](https://open.workbuddy.cn/docs/connector) 为准。提交后由平台审核，GitHub 发版不会自动上
架。

## WorkBuddy 验收

在 WorkBuddy 对应的专家或连接器导入/发布入口上传 ZIP。专家字段以
`expert/.codebuddy-plugin/plugin.json` 为准，平台字段和唯一性要求以实际页面为准。GitHub 发版和平台审
核分别进行。

支持 macOS / Linux、WorkBuddy 5.0.0+、Node.js 22.13+。验收时记录包版本、AVA 版本、客户端版本、系统和
实际结果：

- 上传 `tests/fixtures/sales.csv`：示例收入 30,000 → 37,500 美元，增加 7,500（25%），分项贡献与总额
  一致。
- 用户 CSV / XLSX、中文路径、追问和连接重启后重新加载可用。
- 报告 HTML 与证据 JSON 可打开，SQL 和结果与实际查询一致；无需额外生成重复文件。
- 跨连接或查询证据移出缓存前完成保存；连接重启后重新查询。图表单独验证实际预览效果。
- 同一对话只使用一个 AVA MCP 连接，避免重复启用专家内置连接与自定义连接。
