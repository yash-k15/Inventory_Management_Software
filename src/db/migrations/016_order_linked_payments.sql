
-- Migration 016: link new payments to individual orders.
-- Preserve historical exhibition-level payments without guessing their order.

DROP VIEW IF EXISTS v_customer_balance;

CREATE TABLE payment_new (
    id                     INTEGER PRIMARY KEY,
    order_id               INTEGER REFERENCES customer_order(id) ON DELETE RESTRICT,
    customer_id            INTEGER REFERENCES customer(id) ON DELETE SET NULL,
    customer_name_snapshot TEXT NOT NULL,
    exhibition_id          INTEGER REFERENCES exhibition(id) ON DELETE RESTRICT,
    amount_paise           INTEGER NOT NULL CHECK (amount_paise > 0),
    payment_date           TEXT NOT NULL,
    payment_method         TEXT,
    notes                  TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),

    -- Legacy rows may have no order_id. New rows are validated by a trigger.
    CHECK (
        order_id IS NOT NULL
        OR exhibition_id IS NOT NULL
    )
);

INSERT INTO payment_new (
    id,
    order_id,
    customer_id,
    customer_name_snapshot,
    exhibition_id,
    amount_paise,
    payment_date,
    payment_method,
    notes,
    created_at,
    updated_at
)
SELECT
    id,
    NULL,
    customer_id,
    customer_name_snapshot,
    exhibition_id,
    amount_paise,
    payment_date,
    payment_method,
    notes,
    created_at,
    updated_at
FROM payment;

DROP TABLE payment;
ALTER TABLE payment_new RENAME TO payment;

CREATE INDEX idx_payment_order ON payment(order_id);
CREATE INDEX idx_payment_customer_exh ON payment(customer_id, exhibition_id);

-- Every new payment must belong to a real order.
-- Legacy rows are retained with order_id = NULL.
CREATE TRIGGER trg_payment_requires_order_insert
BEFORE INSERT ON payment
WHEN NEW.order_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'A payment must be linked to an order');
END;

CREATE TRIGGER trg_payment_valid_order_insert
BEFORE INSERT ON payment
WHEN NEW.order_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1
    FROM customer_order co
    WHERE co.id = NEW.order_id
      AND co.status <> 'Cancelled'
 )
BEGIN
    SELECT RAISE(ABORT, 'Payment must reference an existing, non-cancelled order');
END;

CREATE TRIGGER trg_payment_valid_order_update
BEFORE UPDATE OF order_id ON payment
WHEN NEW.order_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1
    FROM customer_order co
    WHERE co.id = NEW.order_id
      AND co.status <> 'Cancelled'
 )
BEGIN
    SELECT RAISE(ABORT, 'Payment must reference an existing, non-cancelled order');
END;

-- Calculate the total and balance separately for each order.
-- Legacy, unallocated payments are deliberately excluded.
CREATE VIEW v_order_balance AS
WITH order_totals AS (
    SELECT
        co.id AS order_id,
        co.status,
        COALESCE(
            co.final_total_paise,
            SUM(coi.agreed_price_paise),
            0
        ) AS order_total_paise
    FROM customer_order co
    LEFT JOIN customer_order_item coi ON coi.order_id = co.id
    GROUP BY co.id, co.status, co.final_total_paise
),
payment_totals AS (
    SELECT
        order_id,
        SUM(amount_paise) AS paid_paise
    FROM payment
    WHERE order_id IS NOT NULL
    GROUP BY order_id
)
SELECT
    ot.order_id,
    ot.status,
    CASE
        WHEN ot.status = 'Cancelled' THEN 0
        ELSE ot.order_total_paise
    END AS order_total_paise,
    COALESCE(pt.paid_paise, 0) AS paid_paise,
    CASE
        WHEN ot.status = 'Cancelled' THEN 0
        ELSE ot.order_total_paise - COALESCE(pt.paid_paise, 0)
    END AS outstanding_paise
FROM order_totals ot
LEFT JOIN payment_totals pt ON pt.order_id = ot.order_id;

-- Retain the old view name for existing callers, but make its balances
-- derive only from order-linked payments.
CREATE VIEW v_customer_balance AS
SELECT
    co.exhibition_id,
    co.customer_id,
    co.customer_name_snapshot AS customer_name,
    SUM(vob.order_total_paise) AS total_orders_paise,
    SUM(vob.paid_paise) AS total_paid_paise,
    SUM(vob.outstanding_paise) AS outstanding_paise
FROM v_order_balance vob
JOIN customer_order co ON co.id = vob.order_id
WHERE co.exhibition_id IS NOT NULL
GROUP BY
    co.exhibition_id,
    COALESCE(CAST(co.customer_id AS TEXT), co.customer_name_snapshot);
