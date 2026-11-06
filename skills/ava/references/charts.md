# Chart configuration

`ava_viz` accepts `{ "spec": { "chartType": "bar", "config": { ... } }, "output": "/absolute/new/chart.html" }`.
`config.type` is filled/overridden by AVA. Numbers must be numbers; put units in titles, not values. The old `syntax` format is invalid.

| Intent | chartType | config data |
| --- | --- | --- |
| Compare categories | bar / column | `[{category, value, group?}]` |
| Ordered time trend | line / area | `[{time, value, group?}]` |
| Non-negative composition | pie | `[{category, value}]`, with positive total |
| Relationship | scatter | `[{x, y, group?}]` |
| Distribution of raw observations | histogram | numeric array |
| Distribution by group | boxplot / violin | `[{category, value}]`, multiple observations per group |
| Signed changes contributing to total | waterfall | `[{category, value}, {category: "Total", isTotal: true}]` |
| Exact values | table | original result rows |

For example, after a verified regional query returns East=25 and West=20:

```json
{
  "chartType": "bar",
  "config": {
    "type": "bar",
    "data": [{"category": "East", "value": 25}, {"category": "West", "value": 20}],
    "title": "Revenue by region (USD)",
    "axisXTitle": "Region",
    "axisYTitle": "Revenue (USD)"
  }
}
```

Sort time, label Top N and filtered scopes, and keep the chart tied to its saved query/result. Use a bar chart for signed category changes; use a waterfall when explaining additive contributions. Do not infer causation from either chart. Preview with available browser tools and check labels, values and units. When preview is unavailable, report HTML generation separately from visual verification.
