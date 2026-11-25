# AntV for WorkBuddy

支持数据探索、指标计算与可视化设计，生成交互图表和分析报告，并提供可复核的计算依据与方法说明。

「AntV」根据问题和数据选择分析方法，核对口径与证据，并通过上游
[AVA Skill](https://github.com/antvis/AVA/tree/v4.0.3/skills/ava) 和 AVA
CLI 执行查询、图表渲染与报告生成。

## 使用

需要 Node.js 22.13+、AVA CLI 4.0.3 或更高版本，以及 WorkBuddy 5.0.0+。

1. 在 WorkBuddy 的命令环境中安装或更新 AVA CLI，执行
   `npm install -g @antv/ava`。首次使用时用一份 CSV 执行 `ava source`，确认能获得
   `datasetId`，验证后释放测试会话。
2. 导入专家 ZIP，新建「AntV」专家对话。CLI 需单独安装，专家包不会自动安装它。
3. 上传表格或提供已授权的数据源，直接描述问题。数据库和飞书需要对应网络、权限与凭据。

例如：

> 比较两组观测数据的分布与差异，说明样本量、统计口径和适用限制，生成带图表与查询依据的报告。

结构化数据分析无需额外模型 API Key；原生 `text` 数据源需要配置模型。旧 AVA
MCP 已移除，使用新版专家时停用旧连接。

## 仓库与分发

本仓库维护 `expert/` 专家配置与上游 Skill 引用，以及 `public/`
图标、头像和宣传素材。不再维护 npm 工程、开发脚本、测试工程和独立文档目录。

制作专家 ZIP 时：

1. 以 `expert/` 为专家根目录，按配置将 `public/avatars/` 和 `public/expert-icon.svg` 分别放到
   `avatars/` 和 `icon.svg`。
2. 按 `expert/ava-skill.json` 的固定提交从 GitHub API 的 `repos/antvis/AVA/tarball/<commit>`
   获取归档，核验 SHA-256，将完整 `skills/ava/` 原样放入专家目录，保留脚本、模板和参考文档。
3. 附带 README、LICENSE 和 NOTICE，保留 `.codebuddy-plugin/` 隐藏目录，压缩为 ZIP 并记录校验和。

专家版本以 `expert/.codebuddy-plugin/plugin.json` 为准。不要在本仓库维护另一份 Skill 或报告实现。

专家使用随包的固定版本 Skill；更新全局同名 Skill 不会替换专家内置副本。升级时须同步上游引用、专家版本与实际安装目录。已有 HTML 内嵌了生成时的模板，需要另存新版报告才会采用新布局。

## 数据与产物

- 数据结构与查询结果会返回 WorkBuddy。只使用已授权的数据源与只读凭据，不在对话或交付文件中放入密码和密钥。
- 报告内嵌查询结果，分享报告也会分享这些数据。交互图表从 `registry.npmmirror.com`
  加载 GPT-Vis。正文、表格和 SQL 可离线查看，完整预览需要启用 JavaScript。
- 会话和任务产物按上游 Skill 管理。原 MCP 的私有输入副本、连接级会话管理和额外入口限制已移除。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。来源与许可证见 [NOTICE](NOTICE)。
