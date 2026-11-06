# 项目约定

- 用户要求：后续项目修改完成并验证后，自动创建 Git commit。
- 向 GitHub 上传或推送代码时，使用 `~/.ssh/id_rsa_github` 对应的账号和 SSH remote。推送前在同一 shell 会话依次运行 `eval \`ssh-agent -s\``、`ssh-add ~/.ssh/id_rsa_github`、`ssh -T git@github.com`，核对欢迎信息中的账号；认证成功也可能返回退出码 1。推送命令设置 `GIT_SSH_COMMAND='ssh -i ~/.ssh/id_rsa_github -o IdentitiesOnly=yes'`。
