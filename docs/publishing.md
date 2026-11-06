# 打包与发布

## 分发包

`npm run package` 会清空并重建 `dist/`，生成当前版本的四个包和 `SHA256SUMS`：

| 包 | 用途 |
| --- | --- |
| `ava-workbuddy-<version>.tgz` | 预编译 CLI 和 ESM 库，供 MCP 安装 |
| `ava-workbuddy-expert-<version>.zip` | 专家配置、头像、Skill 和内置 MCP |
| `ava-workbuddy-connector-<version>.zip` | 连接器元信息、MCP 配置和 Skill |
| `ava-workbuddy-skill-<version>.zip` | 单独导入分析指导，需配合 MCP |

Skill 唯一维护源是 `skills/ava/`。专家包中的 `.mcp.json` 来自 `connector/mcp.json`；打包保留 `.codebuddy-plugin` 等必需隐藏文件。GitHub 自动生成的源码归档不含 `lib/`，不能直接作为 MCP 安装包。

## 维护者发版

1. 同步 `package.json`、`npm-shrinkwrap.json`、连接器、专家、Agent、Skill、文档中的版本和安装 URL，更新 CHANGELOG。当前源码的报告功能尚未发布，不覆盖已发布 v0.2.1 文件。
2. 运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run test:integration`、`npm run test:package`。最后一项会构建、打包，并在新目录验证安装、类型声明、公开 API 和完整示例。
3. 推送源码与 tag，在对应 GitHub Release 上传四个同版本包和 `SHA256SUMS`。预览版标记 prerelease；已发布文件不覆盖。
4. 核对下载链接和校验和，再用远程 TGZ 地址执行 `npx --yes --package=<URL> ava-workbuddy smoke`。
5. 需要更新 WorkBuddy 专家或连接器时，另行上传新包并完成客户端验证和平台审核。

MCP 安装指向远程 TGZ。本地打包不会让现有连接自动切换到当前源码；调试请按 [README](../README.md#当前源码) 使用本地 `lib/cli.js`。

## WorkBuddy 验收

在 WorkBuddy 对应的专家、连接器或技能导入/发布入口上传 ZIP。专家字段以 `expert/.codebuddy-plugin/plugin.json` 为准，平台字段和唯一性要求以实际页面为准。GitHub 发版和平台审核分别进行。

支持 macOS / Linux、WorkBuddy 5.0.0+、Node.js 22.13+。验收时记录包版本、AVA 版本、客户端版本、系统和实际结果：

- 示例收入 30,000 → 37,500 美元，增加 7,500（25%），分项贡献与总额一致。
- 用户 CSV / XLSX、中文路径、追问和连接重启后重新加载可用。
- SQL、结果文件和 HTML 可打开，图表经过实际预览；报告功能使用当前源码构建验证。
- 同一对话只使用一个 AVA MCP 连接，避免重复启用专家内置连接与自定义连接。

自动化测试覆盖本地协议、计算与打包；客户端导入、平台审核和图表视觉预览需人工验收。
