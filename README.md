# AntV for WorkBuddy

上传表格或连接数据库、飞书表格，帮你看懂数据、比较变化，生成带图表和计算依据的分析报告。

「AntV」专家直接使用上游
[AVA Skill](https://github.com/antvis/AVA/tree/codex/ava-skill-reports/skills/ava) 和 AVA
CLI。分析方法、业务口径、图表、报告及追问更新的说明均以该 Skill 为准。

## 使用

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+，运行环境需支持后台进程与 Unix socket。

1. 在 WorkBuddy 的命令环境中安装或复用 AVA CLI 4.x，运行 `ava source --help` 检查。尚未安装时可使用
   `npm install -g @antv/ava@4`。
2. 导入专家 ZIP，新建「AntV」专家对话。CLI 需单独安装，专家包不会自动安装它。
3. 上传表格或提供已授权的数据源，直接描述问题。数据库和飞书需要对应网络、权限与凭据。

例如：

> 比较这两个月的收入变化，拆解各产品的贡献，生成包含结论、图表和计算依据的报告。

结构化数据分析无需额外模型 API Key；原生 `text` 数据源需要配置模型。旧 AVA
MCP 已移除，使用新版专家时停用旧连接。

## 仓库与分发

本仓库维护 `expert/` 专家配置与上游 Skill 引用，以及 `public/`
图标、头像和宣传素材。不再维护 npm 工程、开发脚本、测试工程和独立文档目录。

制作专家 ZIP 时：

1. 以 `expert/` 为专家根目录，按配置将 `public/avatars/` 和 `public/expert-icon.svg` 分别放到
   `avatars/` 和 `icon.svg`。
2. 按 `expert/ava-skill.json` 的固定提交取得上游归档，核验 SHA-256，将完整 `skills/ava/`
   原样放入专家目录。该目录中的脚本、模板和参考文档都是运行资源，不能省略。
3. 附带 README、LICENSE 和 NOTICE，保留 `.codebuddy-plugin/` 隐藏目录，压缩为 ZIP 并记录校验和。

专家版本以 `expert/.codebuddy-plugin/plugin.json` 为准。不要在本仓库维护另一份 Skill 或报告实现。

## 数据与产物

- 数据结构与查询结果会返回 WorkBuddy。只使用已授权的数据源与只读凭据，不在对话或交付文件中放入密码和密钥。
- 报告内嵌查询结果，分享报告也会分享这些数据。交互图表从 unpkg.com 加载 GPT-Vis 脚本；正文、表格和 SQL 可离线查看。
- 会话和任务产物按上游 Skill 管理。原 MCP 的私有输入副本、连接级会话管理和额外入口限制已移除。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。来源与许可证见 [NOTICE](NOTICE)。
