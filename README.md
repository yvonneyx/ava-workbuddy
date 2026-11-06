# AVA for WorkBuddy

<img src="connector/icon.svg" width="88" alt="AntV logo">

**在 WorkBuddy 中分析本地 CSV / Excel，得到有依据的结论、结果表和交互图表。**

上传表格、描述问题，WorkBuddy 负责理解需求和组织分析，AVA 负责读取数据、执行计算和生成图表。你可以继续追问，也可以查看实际执行的 SQL 和结果，核对每个结论。

[开始试用](#开始试用) · [发布专家](#发布专家) · [开发与验证](#开发与验证) · [常见问题](#常见问题)

> **当前版本：v0.2.1 预览版**
>
> 支持 **macOS / Linux、WorkBuddy 5.0.0+**，暂不支持 Windows。沿用 WorkBuddy 的模型，无需另配模型 API Key。

## 可以用它做什么

| 你的问题 | 交付内容 |
| --- | --- |
| 两期收入发生了什么变化？ | 总额、增减金额、变化比例，以及产品等维度的贡献拆解 |
| 这个数字怎么算出来的？ | 使用的指标口径、实际执行的 SQL 和结果数据 |
| 能把分析画成图吗？ | 根据已核实数据生成的交互图表 HTML，可保存和继续查看 |

本仓库提供三部分：**MCP 连接器**让 WorkBuddy 调用 AVA 工具，**Skill**提供分析与核验指导，**专家包**把这些能力组织成「AVA 数据分析助手」入口。

## 开始试用

自己体验时，可以先添加自定义 MCP，无需等待 WorkBuddy 市场审核。

### 1. 连接 AVA

在 WorkBuddy 的「专家·技能·连接器 → 连接器」中，进入自定义连接器 / MCP 配置，添加 [`connector/mcp.json`](connector/mcp.json) 的内容。

<details>
<summary>展开并复制 MCP 配置</summary>

```json
{
  "mcpServers": {
    "yvonneyx-ava": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "--yes",
        "--package=https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-0.2.1.tgz",
        "ava-workbuddy",
        "serve"
      ],
      "runtime": { "type": "node", "version": ">=22.13.0 <23" },
      "timeout": 120000
    }
  }
}
```

已有其他 MCP 服务时，只合并 `mcpServers.yvonneyx-ava`，保留原配置。

</details>

首次连接会从 GitHub Release 和 npm 下载固定版本的预编译包及依赖，无需在用户电脑上编译 TypeScript，请等待安装结束。支持托管运行时的 WorkBuddy 会按配置准备 Node.js；手动运行时需要 Node.js 22.13+。连接成功后可发现 `ava_check`、`ava_demo` 等 8 个工具。

### 2. 用示例验证一次

新建对话，启用 AVA 连接器，发送：

```text
请用 AVA 检查运行环境，再用内置示例数据分析收入变化。
核对收入总额与各产品的变化贡献，给出结论、结果表、图表和查询文件链接。
如果没有实际预览图表，请说明。
```

示例使用 **8 行模拟销售数据**。工具会分别计算月度总额和产品贡献，核对后才返回成功。预期结果为：

| 2025 年 1 月收入 | 2025 年 2 月收入 | 增加金额 | 增长比例 |
| ---: | ---: | ---: | ---: |
| 30,000 美元 | 37,500 美元 | 7,500 美元 | 25% |

其中 Analytics 增加 6,000 美元，占净增量的 80%；Reporting 减少 1,000 美元。这份数据可以说明变化来自哪些产品，无法证明变化的原因。

结果目录保留 SQL、结果 JSON、图表配置、HTML 和简短报告。需要长期保存时，请让 WorkBuddy 使用工作空间中的新目录；默认临时目录可能被系统清理。

### 3. 换成自己的表格

建议先下载并导入 [AVA Skill ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-skill-0.2.1.zip)：在「技能 → 添加技能 → 上传技能」中完成安装。Skill 提供分析指导，需配合第 1 步连接的 MCP 使用。

然后上传本地 CSV 或 XLSX，描述你的问题，例如：

```text
请用 AVA 分析我上传的表格。
先查看数据结构，再比较两个时期的收入，按产品拆解变化并核对合计。
如果有影响结果的业务口径，请先确认。
保存 SQL、结果数据和图表，说明结论的依据与局限。
```

后续可以继续问：「按渠道拆解」「换成日均口径」「核对退款是否扣除」。有用的业务定义可以保存下来，供后续分析复用。

## 发布专家

如果希望其他用户通过「AVA 数据分析助手」入口使用，可以上传专家包到 WorkBuddy 开放平台。

1. 下载 [专家 ZIP](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-expert-0.2.1.zip)。
2. 打开 [创建专家页面](https://open.workbuddy.cn/expert/publish?action=create&step=1)，上传 ZIP，补齐平台要求的信息。
3. 在平台可用的试用环节连接内置 MCP，验证示例及自己的文件，再按流程提交审核和发布。

专家包已包含专家定义、头像、Skill 和 MCP 配置。客户端或企业控制台提供专家包导入入口时，也可按对应流程导入。**GitHub Release 已发布；WorkBuddy 市场上架仍需平台审核。**

三个分发包的用途不同：

| 下载 | 用途 |
| --- | --- |
| [专家包](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-expert-0.2.1.zip) | 提供完整的「AVA 数据分析助手」入口，内置 Skill 和 MCP 配置 |
| [连接器包](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-connector-0.2.1.zip) | 提交连接器市场审核，供用户单独安装 AVA 工具 |
| [Skill 包](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-skill-0.2.1.zip) | 手动导入分析指导，与已连接的 MCP 配合使用 |

文件校验值见 [SHA256SUMS](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/SHA256SUMS)，完整操作步骤见 [发布指南](docs/publishing.md)。同一对话使用一个 AVA MCP 连接即可，避免重复启用专家内置连接与手动添加的同名连接。

## 它如何工作

**你的问题 → WorkBuddy 规划分析 → AVA 本地计算 → 核对结果 → 交付结论与图表**

本集成通过本地 stdio MCP 调用固定版本的 `@antv/ava@4.0.0` CLI。AVA 作为原样依赖使用；本仓库负责 WorkBuddy 的接入、分析指导、示例和分发。

- **计算位置**：数据在本地 AVA 进程中计算，查询结果返回 WorkBuddy 参与推理，仍适用其模型服务的数据处理和计费规则。
- **文件权限**：进程使用 WorkBuddy 授予的本地权限；源数据只读，已有输出文件不会被覆盖。本项目不提供额外的文件系统沙箱。
- **网络需求**：安装需要 GitHub / npm；Excel 首次读取可能下载 DuckDB 的 `excel` 扩展；图表 HTML 需要联网加载 GPT-Vis。

<details>
<summary>查看 8 个 MCP 工具</summary>

| 工具 | 作用 |
| --- | --- |
| `ava_check` | 检查 Node.js、操作系统、集成和 AVA 版本 |
| `ava_demo` | 运行示例，核对总额与分项，保存产物并释放示例会话 |
| `ava_source` | 加载用户提供的本地 CSV / XLSX |
| `ava_schema` | 查看真实表、字段、查询语言及规则 |
| `ava_query` | 执行只读 SQL，返回结果及截断状态 |
| `ava_semantic` | 读取或完整替换当前会话的业务定义 |
| `ava_viz` | 将已核实的数据渲染为新 HTML 文件 |
| `ava_dispose` | 释放当前连接创建的空闲会话 |

</details>

## 开发与验证

开发环境需要 **Node.js 22.13+**；生成 ZIP 还需要 `zip` 和 `unzip`。核心代码使用 TypeScript（严格模式），编译为 ESM 并生成类型声明；依赖通过 `npm-shrinkwrap.json` 锁定。

```sh
git clone https://github.com/yvonneyx/ava-workbuddy.git
cd ava-workbuddy
npm ci
npm run build
```

按需运行检查：

| 命令 | 检查内容 |
| --- | --- |
| `npm run typecheck` | 严格检查 TypeScript 类型，不生成文件 |
| `npm run build` | 生成 `lib/` 中的 JavaScript、类型声明及源码映射 |
| `npm test` | 运行环境、输入边界、会话归属、超时处理与包配置 |
| `npm run test:integration` | 真实 MCP 调用、CSV / XLSX、只读查询、制图及会话重启 |
| `npm run smoke` | 示例从加载、计算到生成 HTML 的完整流程 |
| `npm run test:package` | 在新目录安装预编译包，验证公开 API、类型声明和首次分析 |
| `npm run package` | 在 `dist/` 生成预编译 TGZ、三个 ZIP 和 `SHA256SUMS` |

CI 覆盖 macOS / Linux、Node.js 22 / 24。协议、计算和打包已有自动化验证；WorkBuddy 客户端导入、登录后的发布表单和图表视觉预览仍需人工验证。

<details>
<summary>仓库结构与本地调试</summary>

```text
connector/       # 连接器元信息、MCP 配置、图标
expert/          # 专家配置、Agent 指令、头像
skills/ava/      # Skill 及参考文档，唯一维护源
src/             # TypeScript 库、会话运行时、MCP 和 CLI
lib/             # 编译结果与类型声明（生成，不提交）
examples/        # 模拟销售数据和可复现 SQL
scripts/         # 配置校验、打包与安装验证
test/            # 单元测试、集成测试和 XLSX 样例
docs/            # 库 API、维护与发布指南
```

打包时将同一份 Skill 复制到连接器和专家包，并将 `connector/mcp.json` 复制为专家包根目录的 `.mcp.json`。专家包保留 `.codebuddy-plugin` 等必需隐藏文件。

```sh
node lib/cli.js check
node lib/cli.js smoke
node lib/cli.js demo /absolute/path/to/a-new-demo-directory
node lib/cli.js serve
```

本地调试 MCP 时，将 `command` 改为受支持 Node.js 的绝对路径，`args` 改为本仓库 `lib/cli.js` 的绝对路径和 `serve`。共享配置使用版本下载地址，避免提交开发机路径。

</details>

## 在代码中使用

除 WorkBuddy 接入外，也可以作为 ESM 库使用。安装 [预编译包](https://github.com/yvonneyx/ava-workbuddy/releases/download/v0.2.1/ava-workbuddy-0.2.1.tgz) 后：

```ts
import { Runtime } from 'ava-workbuddy';

const runtime = new Runtime();
try {
  const { datasetId } = await runtime.source('/absolute/path/to/sales.csv');
  const schema = await runtime.schema(datasetId);
  // 根据 schema 中的真实表名和字段编写 SQL。
  console.log(schema);
  const result = await runtime.query(datasetId, 'SELECT COUNT(*) AS rows FROM data');
  console.log(result.data, result.truncated);
} finally {
  const cleanup = await runtime.close();
  if (cleanup.retained.length) console.error('尚未释放的会话：', cleanup);
}
```

公开 API 与错误处理见 [库使用指南](docs/api.md)，开发约定见 [贡献指南](CONTRIBUTING.md)，版本变化见 [CHANGELOG](CHANGELOG.md)。MCP 嵌入接口单独从 `ava-workbuddy/mcp` 导入；导入库不会启动 stdio 服务或注册信号处理器。

## 常见问题

| 遇到的情况 | 处理方式 |
| --- | --- |
| 找不到自定义 MCP 或技能上传入口 | 检查 WorkBuddy 版本和企业策略，必要时请管理员开放对应能力 |
| 首次连接较慢 | 等待 GitHub / npm 下载完成；明确失败后检查网络和错误信息 |
| 出现 `listen EPERM` | 确认宿主允许后台进程、Unix socket 和临时目录访问 |
| Excel 加载失败 | 检查 DuckDB 官方 `excel` 扩展的下载是否成功，或将文件导出为 CSV |
| HTML 已生成，图表却是空白 | 检查预览环境能否访问 unpkg.com；HTML 生成成功与视觉渲染成功分别验证 |
| 数据集不可用 | 会话闲置 30 分钟或 MCP 重启后，重新加载文件并恢复已确认口径 |
| 查询超时 | 运算可能仍在进行，先检查任务；不要自动重试或用释放会话来取消 |
| 输出文件或目录已存在 | 选择一个新路径，保留已有结果 |

当前版本聚焦本地 CSV / XLSX。Windows、远程数据库、定时任务和文档联动暂未纳入支持范围。图表沿用 AVA 4.0.0 的 GPT-Vis CDN 地址，渲染器 URL 尚未锁定版本。

## 规范与许可证

包结构遵循 WorkBuddy 的[连接器规范](https://open.workbuddy.cn/docs/connector)、[专家规范](https://open.workbuddy.cn/docs/expert)和 [Skill 规范](https://open.workbuddy.cn/docs/skill)。

本项目是独立的社区集成，采用 [MIT License](LICENSE)。上游 AVA 及其 Skill 的来源与许可证见 [NOTICE](NOTICE)。
