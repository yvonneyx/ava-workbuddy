# AVA for WorkBuddy

在 WorkBuddy 中分析文件、数据库和飞书多维表格，核对指标变化，交付结论、结果表、交互图表和可追溯的 HTML 报告。

「AVA 数据分析与报告」专家直接预加载上游
[AVA Skill](https://github.com/antvis/AVA/tree/codex/ava-skill-reports/skills/ava)，使用 AVA
CLI 执行计算和制图。结构化数据分析无需额外模型 API Key；原生 `text` 数据源需要配置模型。

从 1.0.2 起只分发专家 ZIP，已移除 MCP 服务、连接器和运行 TGZ。功能对照与边界变化见[迁移说明](docs/ava-skill-migration.md)。

## 安装与使用

支持 macOS / Linux、Node.js 22.13+、WorkBuddy 5.0.0+，运行环境需支持后台进程与 Unix socket。

1. 在 WorkBuddy 的命令环境中安装或复用 AVA CLI 4.x，并检查可用性：

   ```sh
   node --version
   npm install -g @antv/ava@4
   ava source --help
   ```

2. 导入 `ava-workbuddy-expert-1.0.2.zip`，新建「AVA 数据分析与报告」专家对话。
3. 上传 CSV / Excel，或提供已授权的数据源，描述分析目标。使用新版专家时停用旧 AVA MCP。

专家 ZIP 已附带完整 Skill、报告脚本和模板；CLI 需单独安装，Skill 不会自动安装它。首次安装需访问 npm；数据库和飞书需对应网络、权限与凭据。其他文件类型和数据库配置见随包 Skill 的
`references/sources.md`，实际支持范围取决于 CLI 版本。

可直接提问：

> 分析我提供的数据，核对指标变化，生成包含结论、图表和查询依据的报告。然后比较各产品贡献，更新同一份分析。

专家使用 Skill 的 `scripts/report.mjs`
执行并记录查询，再从保存的证据生成 HTML 和 JSON。追问报告按章节 ID 合并，保留已有问题与证据；样式调整可使用任务内模板，无需重跑查询。简单问题直接回答即可。

上手案例见[使用教程](docs/ava-workbuddy-guide.md)。现有[分享链接][expert-share]仍是旧版 MCP 专家，尚未重新生成。

## 数据与外部服务

- 数据结构与查询结果返回 WorkBuddy，适用其模型服务的数据处理规则。数据库与飞书使用用户授权的只读凭据，不在本集成的运营后端存储。
- `text`
  会把文本发送到用户配置的模型服务，使用前需授权该接收方并配置模型。不要在对话或交付文件中提交密码、连接串或密钥。
- 会话由 CLI 管理，闲置 30 分钟或主动释放后失效。保存任务 ID，主动释放不再使用的会话；超时或不确定结果不能自动重试或释放。
- 报告证据保存在任务目录，会话结束后仍可使用。HTML、配套 JSON 和查询证据以 `600`
  权限保存且不覆盖已有文件；独立 `ava viz` 使用 CLI 自身的输出权限。
- 报告内嵌查询数据。交互图表从 unpkg.com 加载 GPT-Vis 脚本，脚本可访问图表数据；分享前需确认授权。正文、表格和 SQL 可离线查看，图表渲染需要网络。生成文件不等于通过浏览器视觉验收。
- 已移除原 MCP 的私有输入副本、SQLite
  WAL 快照、连接级归属与清理、统一错误过滤和入口禁用层；具体差异见[迁移说明](docs/ava-skill-migration.md)。

## 开发与打包

需要 Node.js 22.13+、npm、`zip`、`unzip`、`tar`，打包需访问 GitHub codeload。

```sh
npm ci --no-audit --no-fund
npm test
npm run test:package
```

| 命令                   | 用途                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `npm run validate`     | 校验专家、上游引用、版本和资源                             |
| `npm test`             | 验证配置及上游下载完整性检查                               |
| `npm run package`      | 生成专家 ZIP 与 `SHA256SUMS`，清空旧分发产物               |
| `npm run test:package` | 打包、解包，验证真实 CLI、证据、图表和会话释放后的追问报告 |

`expert/ava-skill.json` 固定上游提交与归档 SHA-256。打包时原样提取完整
`skills/ava`，不维护另一个 Skill 或报告实现。`@antv/ava@4.0.0` 仅是开发验证依赖，不随专家分发。

```text
expert/       专家身份、表达偏好、展示信息与上游 Skill 引用
scripts/      配置校验、打包和安装验证
tests/        CLI 集成示例和 fixtures
public/       专家图标、头像与宣传素材
dist/         生成的专家 ZIP 与校验和，不提交
```

发布与本机验收见[贡献指南](https://github.com/yvonneyx/ava-workbuddy/blob/main/CONTRIBUTING.md)。本项目是独立的社区集成，采用
[MIT License](LICENSE)；上游来源与许可证见 [NOTICE](NOTICE)。

[expert-share]:
  https://www.workbuddy.ai/work/launch/?sharecode=nm3SFE1xYGtxz8Cm7tWsV-c9oGpYLYAs6QQshRmf6sMqxhFWsHRFy6RIX8lMWx10&expertname=AVA+%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90%E5%B8%88&buddy_type=workbuddy-ai
