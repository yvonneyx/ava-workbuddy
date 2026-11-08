# 给 WorkBuddy 加一位数据分析师

AVA 4.0 是 AntV 开源的数据分析与可视化框架。你可以类比 [PandasAI](https://github.com/sinaptik-ai/pandas-ai) 的自然语言问数体验：由 AI 助手理解问题，再调用 AVA 读取数据、计算指标和生成图表。

**我们把 AVA 4.0 接入 WorkBuddy，做成「AVA 数据分析师」，帮助你围绕业务问题逐层拆解，并把结论、图表和计算依据一起交付。**

支持接入企业业务数据：本地 **CSV、Excel、JSON、Parquet、SQLite** 文件，**MySQL、PostgreSQL、MongoDB、ClickHouse、Supabase** 数据库，以及 **飞书 / Lark 多维表格**。

以 [UCI 零售数据][uci]为例，收入涨了，生意真的变好了吗？增长来自订单更多，还是客单价更高？靠新客户，还是老客户复购？取消订单会不会影响判断？上传表格后，可以直接问：

> 分析这家零售商的收入增长质量。先检查数据质量和取消订单口径，用完整月份比较收入、订单量与客单价，拆解新老客户贡献，生成带图表和查询依据的报告。

生成报告后，还可以继续追问：“只看老客户，结论还成立吗？”并对照结果表和 SQL，核对关键数字的计算依据。

## 拿你手边的一份表试试

👉 **[一键复制「AVA 数据分析师」][expert-share]**

**复制专家 → 上传 CSV / Excel → 描述你想了解的问题。**

*首次使用请按客户端提示完成准备。当前支持 macOS / Linux，需 Node.js 22.13+，并能访问 GitHub 和 npm；数据库、飞书需另行授权。[安装与数据说明](../README.md)。*

[expert-share]: https://www.workbuddy.ai/work/launch/?sharecode=nm3SFE1xYGtxz8Cm7tWsV-c9oGpYLYAs6QQshRmf6sMqxhFWsHRFy6RIX8lMWx10&expertname=AVA+%E6%95%B0%E6%8D%AE%E5%88%86%E6%9E%90%E5%B8%88&buddy_type=workbuddy-ai
[uci]: https://archive.ics.uci.edu/dataset/352/online+retail
