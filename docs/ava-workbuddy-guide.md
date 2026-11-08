# AVA 4.0 实战：在 WorkBuddy 里，召唤数据分析师

AVA 4.0 是 AntV 开源的数据分析与可视化框架，为 AI 助手提供读取数据、执行计算和生成图表的能力。你可以把它理解为 AI 助手处理数据时使用的一套工具。

这次，我把它接入了 WorkBuddy，做成可以一键复制的「AVA 数据分析师」。**上传一份表，用日常语言说清你想知道什么，它就能帮你分析变化，生成带图表和计算依据的报告。**

👉 **[一键复制「AVA 数据分析师」][expert-share]**

## 从“收入涨了”继续往下问

以公开的 [UCI 零售数据][uci]为例，上传后问：

> 分析这家零售商的收入增长质量：增长来自订单量还是客单价？新老客户分别贡献多少？先检查数据质量和计算口径，再生成包含结论、图表、结果表和查询依据的报告。

AVA 会围绕问题执行查询，生成图表，并把结果表和 SQL 一起放进 HTML 报告。你可以看到答案，也能回查计算依据。

## 三步开始

**复制专家 → 按提示连接 AVA → 上传 CSV / Excel，开始提问。**

结果出来后，还可以继续问：“把增长拆到产品维度”“只看老客户，结论还成立吗？”

拿一份熟悉的表试试，欢迎告诉我哪一步最有帮助。

*当前支持 macOS / Linux。首次运行需 Node.js 22.13+，并能访问 GitHub 和 npm；数据库、飞书需另行授权。[安装与数据说明](../README.md)。*

[expert-share]: https://www.workbuddy.ai/work/launch/?sharecode=nm3SFE1xYGtxz8Cm7tWsV-c9oGpYLYAs6QQshRmf6sMqxhFWsHRFy6RIX8lMWx10&expertname=AVA+%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90%E5%B8%88&buddy_type=workbuddy-ai
[uci]: https://archive.ics.uci.edu/dataset/352/online+retail
