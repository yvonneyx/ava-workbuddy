# MCP tools and troubleshooting

| Tool         | Arguments                                                                                  | Returns                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| ava_check    | none                                                                                       | versions/platform; lightweight check                                                                           |
| ava_source   | absolute local `path`                                                                      | `datasetId`                                                                                                    |
| ava_schema   | `datasetId`                                                                                | tables, fields, language and query instructions                                                                |
| ava_query    | `datasetId`, `sql`, optional `maxRows` (1–10000)                                           | executed query result, schema, truncation information, `queryId`                                               |
| ava_semantic | `datasetId`, optional complete `definition` object                                         | current or replaced semantic definition                                                                        |
| ava_viz      | `spec` (`chartType` + `config`), new absolute HTML `output`                                | absolute output path                                                                                           |
| ava_artifact | `output`, `title`, `summary`, `sections`; optional `metrics`, `definitions`, `limitations` | analysis HTML (`output`) and matching JSON (`dataOutput`); section/query counts, `chartErrors`, preview status |
| ava_dispose  | `datasetId`                                                                                | disposal status                                                                                                |

## Query and session contract

- `ava_schema` returns `models`, column types, `tableReference`, `language` and SQL instructions.
  CSV exposes a `data` view; Excel may expose multiple sheet-named views.
- `ava_query` accepts one read-only SELECT, including read-only CTEs. SQL is limited to 512 KiB;
  results default to 200 rows or 1 MiB, with `maxRows` up to 10000.
- `ava_semantic` reads or completely replaces the current dataset's definitions. It neither persists
  them nor rewrites SQL.
- Dataset IDs belong to one connection and expire after 30 idle minutes. They are not saved
  datasets. Closing the connection releases idle sessions; uncertain operations await idle expiry.

## Analysis artifact

Available in the current source build; the published v0.2.1 release does not yet include this tool.

```json
{
  "output": "/absolute/new/report.html",
  "title": "Monthly revenue review",
  "summary": "Describe only findings supported by executed results.",
  "sections": [
    {
      "question": "How did revenue change?",
      "conclusion": "State the computed change and its scope.",
      "queryId": "<actual queryId returned by ava_query>",
      "chart": {
        "chartType": "column",
        "config": { "axisXTitle": "Month", "axisYTitle": "Revenue (USD)" }
      }
    }
  ],
  "metrics": [
    {
      "label": "January revenue",
      "queryId": "<actual queryId>",
      "field": "value",
      "rowIndex": 0,
      "unit": "USD"
    }
  ],
  "definitions": ["Calendar-month totals in USD."],
  "limitations": ["Revenue alone does not explain its causes or profitability."]
}
```

The parent directory must exist. Sections: 1–16; metrics: 0–6. Charts use the same
`{ chartType, config }` structure as `ava_viz`; AVA validates chart types and renders them. Titles,
axes, legends, grouping, stacking, themes and styles pass through as native AVA/GPT-Vis options.

For normal row-based charts, artifact binds the section's saved query rows directly to
`config.data`. Use SQL aliases and casts to produce the native fields and numeric types, for
example:

```sql
SELECT month AS category, CAST(SUM(revenue) AS DOUBLE) AS value
FROM data GROUP BY month ORDER BY month
```

Do not supply inline `config.data`, `categories`, `series` or `percent`; these values must come from
query evidence. Artifact does not rename columns, convert chart values, build series or choose a
palette.

For native shapes beyond row objects (histogram arrays, dual-axis categories/series, liquid
percent), add `chartConfigField` to the section. It names a column containing a native config object
in exactly one query row. For example:

```sql
SELECT {'data': list(CAST(revenue AS DOUBLE))} AS chart_config FROM data
```

```json
{
  "question": "How is revenue distributed?",
  "conclusion": "Describe the observed distribution.",
  "queryId": "<actual queryId>",
  "chart": { "chartType": "histogram", "config": { "binNumber": 10 } },
  "chartConfigField": "chart_config"
}
```

The object from `chartConfigField` is merged into the native config without changing its shape and
takes precedence over supplied presentation options. It must be an object, not a JSON string or
multiple query rows. Result fields and numeric metric values are validated. The last 32 query
snapshots remain available in the same connection, even after disposal; connection restart clears
them. Unknown/expired IDs fail explicitly. A truncated result remains visibly flagged and is not
plotted. A chart failure preserves the report's table and SQL and is returned in `chartErrors`.

The report embeds tables, SQL, query evidence and source filenames. The same payload is saved as
`dataOutput` beside the HTML. Both paths must be new; files are private (`0600`) and never
overwritten. Sharing HTML shares its query results. Charts require network access to GPT-Vis.

## Execution and troubleshooting

The MCP runs AVA with WorkBuddy's local permissions, without an additional filesystem sandbox. It
accepts structured tool arguments, not shell commands, credentials or model keys. Query results
return to WorkBuddy and follow its model's data handling rules.

- Installation: requires WorkBuddy 5.0.0+, Node.js 22.13+ and macOS/Linux. First `npx` launch
  downloads the pinned TGZ and dependencies from GitHub/npm; let it finish before retrying.
- `EPERM`/socket failure: check WorkBuddy's local process permissions, background process support
  and temporary directory access. Do not weaken global security settings or silently switch to
  uploading data.
- Excel extension failure: first XLSX use runs DuckDB `INSTALL excel`. Allow the official extension
  download or use CSV; do not silently substitute a different engine.
- Dataset unavailable: an idle session may have expired or the MCP may have restarted. Reload the
  known source and reapply definitions; never reuse a made-up ID.
- Output exists: choose a new file/directory. Existing outputs are deliberately not overwritten.
- Chart blank: the HTML fetches GPT-Vis from unpkg.com. Check preview/network separately from
  computation; provide the result table when preview fails.
- Timeout: the operation may still be running. This integration marks that session uncertain and
  blocks automatic retry/disposal. Inspect the task before starting another analysis.
- Tool failure: inspect `isError` and its message. Preserve verified intermediate results and
  explain which stage failed.
