# Analysis and session rules

Adapted from the MIT-licensed AVA Skill; see the bundled NOTICE for the pinned upstream source and license.

- Schema exposes `models`, column types, `tableReference`, `language` and SQL instructions. CSV exposes a `data` view; Excel may expose multiple sheet-named views. Always use the returned names and quote SQL identifiers when needed.
- Queries accept a single read-only SELECT, including read-only CTEs. Use the engine for sums, grouping, sorting, ratios and comparisons. The integration never calls AVA's model-backed analyze/translate/recommend/visualize commands.
- Results contain `data` and result `schema`. `rowCount` describes the current result, not the source table. A truncated response has `truncated: true`; `truncatedBy` describes the limit. Default limits are 200 rows or 1 MiB. `maxRows` can be raised to 10000; aggregation is usually preferable.
- Confirm comparison periods and units. A monthly total and a daily average answer different questions. A zero denominator makes growth undefined; report a new category explicitly. Reconcile dimension contributions with the overall change.
- Distinguish observed changes, arithmetic contributors and causal explanations. Revenue decline does not measure traffic decline; contribution before advertising is not profit after advertising. Recommendations about increasing spend need relevant cost and response evidence. Compute what available data supports, state what is missing, and propose bounded verification when needed.
- `ava_semantic` retains definitions only for the current dataset. Use WorkBuddy's file tools to save agreed reusable Semantic JSON in the user's project, with source and scope. Reapply it after reloading. Preserve unrelated rules when replacing a definition.
- Dataset sessions live in local background AVA processes and expire after 30 minutes of inactivity. The MCP owns only sessions it created; another connection must reload its file. Closing the MCP releases its idle sessions. An uncertain timed-out session is left to AVA's idle expiry rather than cancelled.
- Save artifacts in a task-specific directory: source reference, SQL, result JSON, chart config and HTML. A saved dataset ID is only a session reference, not a durable dataset. Never report an unrun query, an unsupported cause or an ungenerated chart as completed.
