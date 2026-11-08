# 给 WorkBuddy 加一位数据分析师

AVA 4.0 是 AntV 开源的数据分析与可视化框架，让 AI 助手能读取数据、计算指标、生成图表。现在，我把它接入了 WorkBuddy，做成可以一键复制的「AVA 数据分析师」。

**你用业务语言提问，它执行数据查询与计算，再把结论、图表和计算依据整理成报告。**

## 收入涨了，生意真的变好了吗？

增长来自订单更多，还是客单价更高？靠新客户，还是老客户复购？取消订单会不会影响判断？

以 [UCI 零售数据][uci]为例，上传表格后，直接把问题交给它：

> 分析这家零售商的收入增长质量。先检查数据质量和取消订单口径，用完整月份比较收入、订单量与客单价，拆解新老客户贡献，生成带图表和查询依据的报告。

报告里有结论、交互图表、结果表和 SQL，方便回查关键数字是怎么算出来的。还想知道“只看老客户，结论是否成立”，就在同一个对话里继续问。

## 拿你手边的一份表试试

👉 **[一键复制「AVA 数据分析师」][expert-share]**

**复制专家 → 按提示连接 AVA → 上传 CSV / Excel，问出你关心的问题。**

*当前支持 macOS / Linux。首次运行需 Node.js 22.13+，并能访问 GitHub 和 npm；数据库、飞书需另行授权。[安装与数据说明](../README.md)。*

[expert-share]: https://www.workbuddy.ai/work/launch/?sharecode=nm3SFE1xYGtxz8Cm7tWsV-c9oGpYLYAs6QQshRmf6sMqxhFWsHRFy6RIX8lMWx10&expertname=AVA+%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90%E5%B8%88&buddy_type=workbuddy-ai
[uci]: https://archive.ics.uci.edu/dataset/352/online+retail
