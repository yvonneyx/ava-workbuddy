# MCP tools and troubleshooting

| Tool | Arguments | Returns |
| --- | --- | --- |
| ava_check | none | versions/platform; lightweight check |
| ava_demo | optional new absolute `outputDirectory` | independently verified demo findings and artifact paths; disposes its own session |
| ava_source | absolute local `path` | `datasetId` |
| ava_schema | `datasetId` | tables, fields, language and query instructions |
| ava_query | `datasetId`, `sql`, optional `maxRows` (1–10000) | executed query result, schema, truncation information, `queryId` |
| ava_semantic | `datasetId`, optional complete `definition` object | current or replaced semantic definition |
| ava_viz | `spec` (`chartType` + `config`), new absolute HTML `output` | absolute output path |
| ava_artifact | `output`, `title`, `summary`, `sections`; optional `metrics`, `definitions`, `limitations` | analysis HTML (`output`) and matching JSON (`dataOutput`); section/query counts, `chartErrors`, preview status |
| ava_dispose | `datasetId` | disposal status |

## Analysis artifact

Available in the current source build; the published v0.2.1 release does not yet include this tool.

```json
{
  "output": "/absolute/new/report.html",
  "title": "Monthly revenue review",
  "summary": "Describe only findings supported by executed results.",
  "sections": [{
    "question": "How did revenue change?",
    "conclusion": "State the computed change and its scope.",
    "queryId": "<actual queryId returned by ava_query>",
    "chart": { "type": "column", "categoryField": "month", "valueField": "revenue", "valueLabel": "Revenue (USD)" }
  }],
  "metrics": [{ "label": "January revenue", "queryId": "<actual queryId>", "field": "revenue", "rowIndex": 0, "unit": "USD" }],
  "definitions": ["Calendar-month totals in USD."],
  "limitations": ["Revenue alone does not explain its causes or profitability."]
}
```

The parent directory must exist. Sections: 1–16; metrics: 0–6. Chart types: `bar`, `column`, `line`; optional `categoryLabel` and `valueLabel`. Result fields and numeric metric values are validated. The last 32 query snapshots remain available in the same connection, even after disposal; connection restart clears them. Unknown/expired IDs fail explicitly. A truncated result remains visibly flagged and is not plotted. A chart failure preserves the report's table and SQL and is returned in `chartErrors`.

The fixed template is `templates/artifact.html` in the integration package. Only its JSON data slot changes between reports; all report fields bind through `textContent` and DOM nodes, without model-written HTML. The report uses a compact black, white and grayscale layout; charts use the GPT-Vis default theme without palette overrides. Tables, exact SQL and evidence JSON are embedded. Source filenames are included, not full source paths. Charts are sandboxed and loaded from embedded HTML; GPT-Vis still loads from the network. The same payload is automatically saved beside the HTML with a `.json` extension (`dataOutput`); both paths must be new. Saved files are private (`0600`) and never overwritten. Exporting/sharing the HTML shares its embedded query results.

The MCP uses structured arguments and executes AVA without a shell. It never accepts arbitrary shell commands, database credentials or model API keys. It runs with WorkBuddy's local process permissions; it is not an additional filesystem sandbox. Analysis still uses WorkBuddy's model and follows that model's data handling and pricing.

- Installation: initial `npx` launch downloads this public repository and npm dependencies; allow it to finish before retrying. Requires WorkBuddy 5.0.0+ for managed Node runtime, Node 22.13+, macOS/Linux, GitHub/npm access.
- `EPERM`/socket failure: check WorkBuddy's local process permissions, background process support and temporary directory access. Do not weaken global security settings or silently switch to uploading data.
- Excel extension failure: first XLSX use runs DuckDB `INSTALL excel`. Allow the official extension download or use CSV; do not silently substitute a different engine.
- Dataset unavailable: an idle session may have expired or the MCP may have restarted. Reload the known source and reapply definitions; never reuse a made-up ID.
- Output exists: choose a new file/directory. Existing outputs are deliberately not overwritten.
- Chart blank: the HTML fetches GPT-Vis from unpkg.com. Check preview/network separately from computation; provide the result table when preview fails.
- Timeout: the operation may still be running. This integration marks that session uncertain and blocks automatic retry/disposal. Inspect the task before starting another analysis.
- Tool failure: inspect `isError` and its message. Preserve verified intermediate results and explain which stage failed.
