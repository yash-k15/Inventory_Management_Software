-- Preserve item-level agreed prices while allowing a final order total override.
ALTER TABLE customer_order
ADD COLUMN final_total_paise INTEGER
CHECK (final_total_paise IS NULL OR final_total_paise >= 0);

-- Exhibition/customer balances must use the final order total when one was entered.
DROP VIEW IF EXISTS v_customer_balance;

CREATE VIEW v_customer_balance AS
WITH order_totals AS (
    SELECT
        co.id,
        co.exhibition_id,
        co.customer_id,
        co.customer_name_snapshot,
        co.status,
        COALESCE(co.final_total_paise, SUM(coi.agreed_price_paise), 0) AS order_total
    FROM customer_order co
    LEFT JOIN customer_order_item coi ON coi.order_id = co.id
    WHERE co.exhibition_id IS NOT NULL
    GROUP BY
        co.id,
        co.exhibition_id,
        co.customer_id,
        co.customer_name_snapshot,
        co.status,
        co.final_total_paise
),
balance_entries AS (
    SELECT
        exhibition_id,
        customer_id,
        customer_name_snapshot,
        CASE WHEN status <> 'Cancelled' THEN order_total ELSE 0 END AS order_total,
        0 AS paid
    FROM order_totals

    UNION ALL

    SELECT
        exhibition_id,
        customer_id,
        customer_name_snapshot,
        0 AS order_total,
        amount_paise AS paid
    FROM payment
)
SELECT
    exhibition_id,
    customer_id,
    MAX(customer_name_snapshot) AS customer_name,
    SUM(order_total) AS total_orders_paise,
    SUM(paid) AS total_paid_paise,
    SUM(order_total) - SUM(paid) AS outstanding_paise
FROM balance_entries
GROUP BY
    exhibition_id,
    COALESCE(CAST(customer_id AS TEXT), customer_name_snapshot);
