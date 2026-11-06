-- 按产品汇总两个自然月的收入。
WITH monthly AS (
  SELECT
    product,
    SUM(CASE WHEN month = '2025-01' THEN revenue ELSE 0 END) AS january,
    SUM(CASE WHEN month = '2025-02' THEN revenue ELSE 0 END) AS february
  FROM data
  WHERE month IN ('2025-01', '2025-02')
  GROUP BY product
)
-- 输出 AVA 图表需要的原生字段，保留两期金额用于核对。
SELECT
  product AS category,
  january,
  february,
  CAST(february - january AS DOUBLE) AS value
FROM monthly
ORDER BY value DESC;
