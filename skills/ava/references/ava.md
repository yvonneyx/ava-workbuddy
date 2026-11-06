# Analysis rules

Adapted from the MIT-licensed AVA Skill; see the bundled NOTICE for the pinned upstream source and
license.

- Use the returned schema and SQL instructions. Quote identifiers when needed; compute aggregates,
  ratios and comparisons in SQL.
- Results contain `data` and result `schema`. `rowCount` describes the current result, not the
  source table. Check `truncated` and `truncatedBy`; prefer aggregation to raising row limits. A
  deliberately limited query can omit data even when its response is untruncated.
- Confirm population, periods, refunds, units and granularity. Monthly totals and daily averages
  answer different questions. Growth with a zero denominator is undefined; label new categories
  explicitly.
- Distinguish observed changes, arithmetic contributors and causal explanations. Revenue decline
  does not measure traffic decline; contribution before advertising is not profit after advertising.
  Recommendations about increasing spend need relevant cost and response evidence. Compute what
  available data supports, state what is missing, and propose bounded verification when needed.
- Read existing `ava_semantic` definitions before changing them. Merge confirmed changes and
  preserve unrelated rules. Save reusable definitions only when requested or appropriate to the
  task, with their source and scope. Apply them explicitly in SQL.
- Keep the source reference with saved SQL and results so analysis can be reproduced.
