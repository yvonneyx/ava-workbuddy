# 项目约定

## 修改与可读性

- 后续项目修改完成并验证后，自动创建 Git commit。
- 合理换行，避免一行包含多条语句；格式遵循 `.prettierrc.json`。
- 核心流程用简短注释解释原因，以带标题的分隔线划分大块职责。
- `src/` 维护正式运行代码；`tests/` 维护测试、demo 和 fixtures；`public/` 集中维护报告模板、图标和头
  像。
- 资源通过打包复制或生成报告时内嵌，避免维护重复副本。
- MCP 描述和输入 schema 维护工具契约；Skill 只保留分析、交付方法及按需参考；专家配置定义身份与表达偏
  好，不重复工具手册。
- `lib/`、`dist/` 等生成目录不作为手工维护源。

## GitHub 推送

统一使用 `~/.ssh/id_rsa_github` 对应的 GitHub 账号和 SSH remote。推送前，在同一 shell 会话依次运行：

```sh
eval `ssh-agent -s`
ssh-add ~/.ssh/id_rsa_github
ssh -T git@github.com
```

核对欢迎信息中的账号。GitHub 不提供 shell，认证成功也可能返回退出码 1。推送命令设置指定密钥：

```sh
GIT_SSH_COMMAND='ssh -i ~/.ssh/id_rsa_github -o IdentitiesOnly=yes' git push origin main
```
