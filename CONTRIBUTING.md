# 参与开发

本仓库只维护 WorkBuddy 专家配置与打包。分析流程、业务语义、图表和报告直接使用上游 AVA
Skill，不另行维护运行服务或 Skill 副本。

## 开发与验证

需要 macOS / Linux、Node.js 22.13+、npm、`zip`、`unzip` 和 `tar`。

```sh
npm ci --no-audit --no-fund
npm test
npm run test:package
```

打包需访问 GitHub codeload；真实 CLI 验证需要子进程、Unix
socket 和 AVA 的运行依赖。测试只使用模拟数据，不需要模型密钥或远程数据源凭据。

## 修改约定

- `expert/` 维护身份、表达偏好与上游引用。`plugin.json` 声明 `./skills/ava`，Agent 的
  `skills: [ava]` 负责预加载，不附带 MCP 配置。
- 上游 Skill 只维护 `expert/ava-skill.json`
  中的分支来源、提交和归档 SHA-256。更新时读取分支实际内容，核验提交和完整归档，再运行测试；不直接编辑打包后的 Skill。
- `scripts/` 维护打包与校验代码，`tests/` 放测试、示例和 fixtures，`public/`
  集中维护专家图标和头像。
- 文件与子进程边界保留校验，运行命令使用参数数组，不拼接 shell。行为变化补必要回归，分发变化通过解包后的真实 CLI 验证。
- 不提交 `dist/`、缓存、生成文件或本机绝对路径。保持 `.prettierrc.json` 格式。

## 本机专家验收

先完成打包测试，再备份并同步本机专家源和 WorkBuddy 实际加载的安装目录。升级时移除专家内的旧
`.mcp.json`，停用本机同名 AVA MCP；保留其他连接器和专家设置。

新建专家对话，确认实际 Skill 路径与固定提交一致，检查 Node.js、CLI 包版本和工具说明，再验证查询、报告、图表与追问。CLI 的安装路径属于本机环境，不得写进分发包；接收方也需安装 AVA
CLI 4.x。

用户要求分享时再重新生成链接，完成客户端安全检测并更新 README 和教程。首次分发应在另一台机器验证导入和 CLI 安装；本机安装成功不能替代接收方验收。

## 手动发布

1. 同步 `package.json`、`npm-shrinkwrap.json` 与专家版本，更新 CHANGELOG，完成测试并提交。
2. 用 `gh api user --jq .login` 核验账号为 `yvonneyx`。按 AGENTS.md 在同一 shell 启动 SSH
   agent、添加指定密钥并核对欢迎信息，再推送源码与 tag。
3. 创建 GitHub Release，上传 `dist/ava-workbuddy-expert-<版本>.zip` 与
   `dist/SHA256SUMS`。不覆盖已发布附件，修复使用新版本。
4. 用户要求线上发布时，再上传 WorkBuddy 专家 ZIP 或更新分享链接，验证接收方能发现完整 Skill 并调用 CLI。
