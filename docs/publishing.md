# 打包与发布

## 分发包

`npm run package` 会清空并重建 `dist/`，生成当前版本的四个包和 `SHA256SUMS`：

| 包                                      | 用途                              |
| --------------------------------------- | --------------------------------- |
| `ava-workbuddy-<version>.tgz`           | 预编译 CLI 和 ESM 库，供 MCP 安装 |
| `ava-workbuddy-expert-<version>.zip`    | 专家配置、头像、Skill 和内置 MCP  |
| `ava-workbuddy-connector-<version>.zip` | 连接器元信息、MCP 配置和 Skill    |
| `ava-workbuddy-skill-<version>.zip`     | 单独导入分析指导，需配合 MCP      |

维护边界见[贡献指南](../CONTRIBUTING.md#修改约定)。组包规则：

- 三个 ZIP 共用 `skills/ava/`，不单独维护副本。
- 专家包的 `.mcp.json` 来自 `connector/mcp.json`；保留 `.codebuddy-plugin` 等必需隐藏文件。
- 图标和头像从 `public/` 复制到平台要求的位置。TGZ 只附带运行所需的模板和图标，测试与 demo 不入包。
- GitHub 自动生成的源码归档不含 `lib/`，不能直接作为 MCP 运行包。

## 发布验证

先运行 `npm ci`，再依次执行：

| 命令                       | 验证内容                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm test`                 | 单元测试、配置版本、资源和专家的 Skill 名称引用                                                      |
| `npm run test:integration` | 真实 MCP、CSV/XLSX、查询和报告流程                                                                   |
| `npm run test:package`     | 三个 ZIP 的完整 Skill、两份 MCP 配置及资源与维护源逐字节一致；隔离安装 TGZ，验证类型、API 和完整分析 |

`test:package` 自动重建分发包。自动化不包含 WorkBuddy 客户端导入、平台审核或图表视觉验收。

## 维护者发版

1. 同步包、锁文件、连接器、专家和 Skill 的版本，更新 MCP 安装 URL、文档链接与 CHANGELOG。当前源码的
   报告功能尚未发布，须发新版本，不覆盖已发布 v0.2.1 文件。
2. 通过上述发布验证。
3. 推送源码与 tag，在对应 GitHub Release 上传四个同版本包和 `SHA256SUMS`。预览版标记 prerelease；已
   发布文件不覆盖。
4. 核对下载链接和校验和，再用远程 TGZ 地址执行 `npx --yes --package=<URL> ava-workbuddy check`。
5. 需要更新 WorkBuddy 专家或连接器时，另行上传新包并完成客户端验证和平台审核。

MCP 安装指向远程 TGZ。本地打包不会让现有连接自动切换到当前源码；调试请按
[README](../README.md#当前源码) 使用本地 `lib/cli.js`。

## WorkBuddy 验收

在 WorkBuddy 对应的专家、连接器或技能导入/发布入口上传 ZIP。专家字段以
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
