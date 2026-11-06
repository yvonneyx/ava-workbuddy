# Native chart data

AVA uses GPT-Vis config. The chart data must have the native field names and numeric values; produce
them with SQL aliases and casts rather than rewriting query results in the assistant. Put units in
labels and axis titles, not in numeric values.

| Chart            | Native data                                                      |
| ---------------- | ---------------------------------------------------------------- |
| bar / column     | `[{category, value, group?}]`                                    |
| pie              | `[{category, value}]`, non-negative values with a positive total |
| line / area      | `[{time, value, group?}]`, ordered by time                       |
| scatter          | `[{x, y, group?}]`                                               |
| histogram        | numeric array                                                    |
| boxplot / violin | `[{category, value}]`, multiple observations per category        |
| dual-axes        | `categories` and `series` containing native series objects       |
| liquid           | `percent` between 0 and 1                                        |

For an artifact column chart, query the native rows and reference its `queryId`; omit inline chart
data. For example:

```sql
SELECT month AS category, CAST(SUM(revenue) AS DOUBLE) AS value
FROM data GROUP BY month ORDER BY month
```

```json
{ "chartType": "column", "config": { "axisYTitle": "Revenue (USD)" } }
```

For non-row shapes, return a native config object in one query cell and set the section's
`chartConfigField` to that column. The object's keys override supplied presentation options. For
example, a histogram query returns a numeric array under `data`:

```sql
SELECT {'data': list(CAST(revenue AS DOUBLE))} AS chart_config FROM data
```

Use `chartConfigField: "chart_config"` and
`chart: {chartType: "histogram", config: {binNumber: 10}}`. The cell must be an object, not a JSON
string. A standalone `ava_viz` has no evidence binding, so its `config` must include the verified
chart data explicitly.
