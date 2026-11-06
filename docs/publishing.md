# 发布到 WorkBuddy

## 专家入口

打开维护者提供的官方入口：

[https://open.workbuddy.cn/expert/publish?action=create&step=1](https://open.workbuddy.cn/expert/publish?action=create&step=1)

本仓库根据官方专家包文档准备 ZIP，字段名称和步骤以平台显示为准。v0.1.3 已完成实际表单上传并提交审核；平台审核与客户端验收独立于代码测试。

1. 从本仓库 GitHub Releases 下载 `ava-workbuddy-expert-0.2.0.zip`，可用同页 `SHA256SUMS` 核对。
2. 在创建专家流程中上传该 ZIP。它包含 `.codebuddy-plugin/plugin.json`、Agent 定义、512px PNG 头像、完整 Skill，以及内置 MCP 的 `.mcp.json`。
平台要求 `profession.zh`（专家职称）和 `name`（内部标识）在同类型资产中唯一。已有草稿占用时，应修改代码包内对应字段后重新上传，不能仅修改页面花名。本包使用 `AVA 4.0 数据分析` 和 `ava-workbuddy-analyst`。

3. 如表单要求手工补充，使用：名称「AVA 4.0 数据分析师」、专家职称「AVA 4.0 数据分析」、分类「数据智能 / 04-DataAI」、版本 `0.2.0`、作者 `yvonneyx`、主页 `https://github.com/yvonneyx/ava-workbuddy`。介绍与三个推荐问题以 `expert/.codebuddy-plugin/plugin.json` 为准。
4. 在平台可用的预览/试用环节召唤专家。按内联引导连接其本地 MCP，等初次下载结束；确认发现 8 个 AVA 工具。
5. 点击第一个推荐问题。核对收入 30,000 → 37,500 美元、增加 7,500（25%），并打开实际结果文件和 HTML。保存至工作空间时给 `ava_demo` 一个新的绝对输出目录。
6. 上传一份自己的 CSV，再上传一份 XLSX，测试一次追问。确认 Excel 首次扩展下载、中文路径、图表 CDN、连接重启恢复在目标电脑上可用。
7. 根据账号能力保存草稿、提交审核，并在审核通过后发布。公开上架需要维护者完成平台资料和审核流程；本仓库不会代用户接受条款或冒充已上架。

支持 macOS/Linux，WorkBuddy 5.0.0+，Node 22.13+。平台字段中应明确这些要求；发布给 Windows 用户前需另行解决 AVA 的会话兼容性。

## 三种包如何选择

- 专家 ZIP：完整首用体验，内置 MCP，不依赖市场连接器已注册。
- 连接器 ZIP：在开放平台的连接器发布流程提交，供用户单独安装。`source` 暂定 `yvonneyx-ava`，全局唯一性以平台审核为准；若更改，同步修改 MCP key、文档和校验脚本后重新打包。
- Skill ZIP：在 WorkBuddy 的技能上传入口导入；需先添加本仓库的自定义 MCP。不要把 Skill ZIP 上传到专家入口。

不要为同一次对话同时启用专家内置 MCP 和重复配置的同名自定义 MCP。已连接同一服务时应复用现有连接。

## 发布记录

发布时记录 GitHub tag、集成版本、AVA 版本、WorkBuddy 客户端版本、操作系统和人工验收结果。CI 覆盖本地协议与计算；客户端安装、平台审核和图表视觉预览需要独立记录。

### 维护者发版步骤

1. 同步 `package.json`、shrinkwrap、连接器、专家、Agent、Skill 和文档中的版本及安装 URL，更新 CHANGELOG。
2. 运行 `npm ci`、`npm run typecheck`、`npm test`、`npm run test:integration`、`npm run smoke`、`npm run test:package`。最后一个命令先构建并生成全部分发包，再从新目录安装和验证。
3. 推送源码和对应 tag，在 GitHub Release 上传 `dist/` 中同版本的 TGZ、三个 ZIP 和 `SHA256SUMS`。版本仍在预览阶段时标记 prerelease。已发布版本的文件不覆盖。
4. 核对 Release 下载链接及校验和，再用 `connector/mcp.json` 中的远程 TGZ 地址执行一次 `npx --yes --package=<URL> ava-workbuddy smoke`。
5. 需要升级 WorkBuddy 时，另行上传新专家包并完成平台验证与审核。GitHub 发版不代表 WorkBuddy 自动升级或市场已上架。

从 v0.2.0 开始，MCP 安装 URL 指向带有 `lib/*.js` 和 `lib/*.d.ts` 的预编译 TGZ。GitHub 自动生成的源码归档不含 `lib/`，不能直接作为 MCP 安装包。源码开发仍需先运行 `npm run build`。现有 v0.1.3 安装地址与送审资产保持不变。
