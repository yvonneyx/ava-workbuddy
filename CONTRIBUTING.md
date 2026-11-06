# 参与开发

本项目维护 WorkBuddy 接入，AVA 通过固定版本的 npm 依赖使用。

## 本地开发与验证

需要 macOS/Linux、Node.js 22.13+、npm、`zip`、`unzip` 和 `tar`。

```sh
npm ci
npm test
npm run test:integration
npm run test:package
```

`npm test` 自动构建；单独运行集成测试或 CLI 前先执行 `npm run build`。`test:package` 会打包并在新目录
安装验证。真实测试需要子进程、Unix socket 和网络访问。

## 修改约定

- 开启 `strict`、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`，不要用 `any` 或关闭检查
  来绕过类型错误。
- `src/` 放运行代码，`tests/` 放测试、示例和 fixtures，`public/` 放模板、图标和头像。
- 在文件、子进程和 MCP 边界保留校验。运行命令使用参数数组和 stdin，不拼接 shell；只调用无需模型的
  AVA 命令；不要覆盖用户文件。
- 会话只属于创建它的运行时；同一会话串行执行。超时、输出溢出或不可信响应都可能留下仍在执行的操作，不
  能自动重试或强制释放。
- 库导入不得写 stdout、启动服务或安装信号处理器。
- 分析规则写在 MCP 工具描述中，参数与原生图表形状写在 schema 中，服务级 `instructions` 只作导航。
- `expert/` 维护身份与表达偏好，`connector/` 维护连接配置和展示信息；资源与 MCP 配置只维护一份。
- 行为修改补回归测试；协议或安装方式变化需通过集成和打包安装测试。

提交 PR 时说明触发场景、行为变化和实际执行的验证命令。保持修改聚焦，不提交 `lib/`、`dist/`、缓存或本
机绝对路径。

## 手动发布

1. 同步 `package.json`、`npm-shrinkwrap.json`、连接器和专家配置中的版本，更新 `connector/mcp.json` 的
   Release 安装 URL、CHANGELOG 和相关文档。完成上面的验证并提交待发布改动。

2. 在同一终端启用指定 SSH 密钥，核对欢迎信息中的账号为 `yvonneyx`。`ssh -T` 认证成功时也可能返回 1。

   ```sh
   eval `ssh-agent -s`
   ssh-add ~/.ssh/id_rsa_github
   ssh -T git@github.com
   gh api user --jq .login
   ```

   `origin` 使用 `git@github.com:yvonneyx/ava-workbuddy.git`，`gh` 登录账号也应为 `yvonneyx`。

3. 推送源码和 tag，创建 Release 并上传三个分发包与校验和：

   ```sh
   release_version=$(node -p "require('./package.json').version")
   git tag -a "v${release_version}" -m "Release ${release_version}"
   GIT_SSH_COMMAND='ssh -i ~/.ssh/id_rsa_github -o IdentitiesOnly=yes' \
     git push origin main "v${release_version}"
   gh release create "v${release_version}" \
     "dist/ava-workbuddy-${release_version}.tgz" \
     "dist/ava-workbuddy-expert-${release_version}.zip" \
     "dist/ava-workbuddy-connector-${release_version}.zip" \
     dist/SHA256SUMS \
     --repo yvonneyx/ava-workbuddy --verify-tag \
     --title "v${release_version}" --generate-notes
   ```

   预发布加 `--prerelease`；已发布附件不覆盖，修复使用新版本。

4. 用公开地址验证安装，再到 WorkBuddy 开放平台上传专家或连接器 ZIP、提交审核：

   ```sh
   release_url="https://github.com/yvonneyx/ava-workbuddy/releases/download/v${release_version}"
   npx --yes \
     --package="${release_url}/ava-workbuddy-${release_version}.tgz" \
     ava-workbuddy check
   ```

客户端验收：导入 ZIP 后分析 `tests/fixtures/sales.csv`，核对收入 30,000 → 37,500、增长 25%，检查报告与
图表，并验证连接重启后可重新加载。同一对话只启用一个 AVA MCP。

平台字段以[专家规范](https://open.workbuddy.cn/docs/expert)和
[连接器规范](https://open.workbuddy.cn/docs/connector)为准。
