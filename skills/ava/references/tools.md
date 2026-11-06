# MCP tools and troubleshooting

| Tool | Arguments | Returns |
| --- | --- | --- |
| ava_check | none | versions/platform; lightweight check |
| ava_demo | optional new absolute `outputDirectory` | independently verified demo findings and artifact paths; disposes its own session |
| ava_source | absolute local `path` | `datasetId` |
| ava_schema | `datasetId` | tables, fields, language and query instructions |
| ava_query | `datasetId`, `sql`, optional `maxRows` (1–10000) | executed query result, schema, truncation information |
| ava_semantic | `datasetId`, optional complete `definition` object | current or replaced semantic definition |
| ava_viz | `spec` (`chartType` + `config`), new absolute HTML `output` | absolute output path |
| ava_dispose | `datasetId` | disposal status |

The MCP uses structured arguments and executes AVA without a shell. It never accepts arbitrary shell commands, database credentials or model API keys. It runs with WorkBuddy's local process permissions; it is not an additional filesystem sandbox. Analysis still uses WorkBuddy's model and follows that model's data handling and pricing.

- Installation: initial `npx` launch downloads this public repository and npm dependencies; allow it to finish before retrying. Requires WorkBuddy 5.0.0+ for managed Node runtime, Node 22.13+, macOS/Linux, GitHub/npm access.
- `EPERM`/socket failure: check WorkBuddy's local process permissions, background process support and temporary directory access. Do not weaken global security settings or silently switch to uploading data.
- Excel extension failure: first XLSX use runs DuckDB `INSTALL excel`. Allow the official extension download or use CSV; do not silently substitute a different engine.
- Dataset unavailable: an idle session may have expired or the MCP may have restarted. Reload the known source and reapply definitions; never reuse a made-up ID.
- Output exists: choose a new file/directory. Existing outputs are deliberately not overwritten.
- Chart blank: the HTML fetches GPT-Vis from unpkg.com. Check preview/network separately from computation; provide the result table when preview fails.
- Timeout: the operation may still be running. This integration marks that session uncertain and blocks automatic retry/disposal. Inspect the task before starting another analysis.
- Tool failure: inspect `isError` and its message. Preserve verified intermediate results and explain which stage failed.
