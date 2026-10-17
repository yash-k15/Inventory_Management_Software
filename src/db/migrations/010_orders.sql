
-- Orders: support multiple jewelry items per order and optional exhibitions.
-- Preserve existing order IDs, item snapshots, prices, statuses, and history.

-- Remove the dependent view and old order triggers/indexes before rebuilding.
DROP VIEW IF EXISTS v_customer_balance;

DROP TRIGGER IF EXISTS trg_order_immutable;
DROP TRIGGER IF EXISTS trg_order_history_insert;
DROP TRIGGER IF EXISTS trg_order_history_update;

DROP INDEX IF EXISTS idx_order_customer;
DROP INDEX IF EXISTS idx_order_exhibition;
DROP INDEX IF EXISTS uq_order_live_per_selection_item;
DROP INDEX IF EXISTS idx_order_history_order;

-- Preserve the old tables temporarily so their data can be migrated.
-- Renaming the history table first keeps its foreign key pointed at the
-- legacy order table until the historical records have been copied.
ALTER TABLE order_status_history RENAME TO order_status_history_legacy;
ALTER TABLE customer_order RENAME TO customer_order_legacy;

-- New order header. An order can now exist without an exhibition.
CREATE TABLE customer_order (
    id                     INTEGER PRIMARY KEY,
    customer_id            INTEGER REFERENCES customer(id) ON DELETE SET NULL,
    customer_name_snapshot TEXT NOT NULL,
    exhibition_id           INTEGER REFERENCES exhibition(id) ON DELETE RESTRICT,
    status                  TEXT NOT NULL DEFAULT 'Confirmed'
        CHECK (status IN (
            'Confirmed',
            'On Hold',
            'Manufacturing',
            'Ready',
            'Sent',
            'Completed',
            'Cancelled'
        )),
    created_at              TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_order_customer
    ON customer_order(customer_id);

CREATE INDEX idx_order_exhibition
    ON customer_order(exhibition_id, status);

-- Each order can contain multiple jewelry items.
CREATE TABLE customer_order_item (
    id                 INTEGER PRIMARY KEY,
    order_id           INTEGER NOT NULL
        REFERENCES customer_order(id) ON DELETE CASCADE,
    selection_item_id  INTEGER REFERENCES selection_item(id) ON DELETE SET NULL,
    item_snapshot      TEXT NOT NULL CHECK (json_valid(item_snapshot)),
    pricing_breakdown  TEXT NOT NULL CHECK (json_valid(pricing_breakdown)),
    agreed_price_paise INTEGER NOT NULL CHECK (agreed_price_paise >= 0),
    created_at         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_order_item_order
    ON customer_order_item(order_id);

CREATE INDEX idx_order_item_selection
    ON customer_order_item(selection_item_id);

-- Preserve the order-status history table name and IDs.
CREATE TABLE order_status_history (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL
        REFERENCES customer_order(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    notes      TEXT
);

CREATE INDEX idx_order_history_order
    ON order_status_history(order_id);

-- Migrate existing order headers without changing their IDs or statuses.
INSERT INTO customer_order (
    id,
    customer_id,
    customer_name_snapshot,
    exhibition_id,
    status,
    created_at,
    updated_at
)
SELECT
    id,
    customer_id,
    customer_name_snapshot,
    exhibition_id,
    status,
    created_at,
    updated_at
FROM customer_order_legacy;

-- Each existing order becomes an order with one item.
-- Preserve the original item snapshot, pricing breakdown, and price.
INSERT INTO customer_order_item (
    id,
    order_id,
    selection_item_id,
    item_snapshot,
    pricing_breakdown,
    agreed_price_paise,
    created_at
)
SELECT
    id,
    id,
    selection_item_id,
    item_snapshot,
    pricing_breakdown,
    agreed_price_paise,
    created_at
FROM customer_order_legacy;

-- Preserve all existing status-history records and their IDs.
INSERT INTO order_status_history (
    id,
    order_id,
    status,
    changed_at,
    notes
)
SELECT
    id,
    order_id,
    status,
    changed_at,
    notes
FROM order_status_history_legacy;

-- Historical data is now copied, so remove the legacy tables.
DROP TABLE order_status_history_legacy;
DROP TABLE customer_order_legacy;

-- Record the initial status of newly created orders.
CREATE TRIGGER trg_order_history_insert
AFTER INSERT ON customer_order
BEGIN
    INSERT INTO order_status_history (order_id, status)
    VALUES (NEW.id, NEW.status);
END;

-- Record every subsequent status change.
CREATE TRIGGER trg_order_history_update
AFTER UPDATE OF status ON customer_order
WHEN NEW.status <> OLD.status
BEGIN
    INSERT INTO order_status_history (order_id, status)
    VALUES (NEW.id, NEW.status);
END;

-- Order item prices and snapshots are immutable once saved.
CREATE TRIGGER trg_order_item_immutable
BEFORE UPDATE OF item_snapshot, pricing_breakdown, agreed_price_paise
ON customer_order_item
WHEN NEW.item_snapshot <> OLD.item_snapshot
  OR NEW.pricing_breakdown <> OLD.pricing_breakdown
  OR NEW.agreed_price_paise <> OLD.agreed_price_paise
BEGIN
    SELECT RAISE(
        ABORT,
        'Order item snapshots and prices are frozen. Cancel and recreate if a correction is needed'
    );
END;

-- A selection item cannot belong to more than one non-cancelled order.
-- Cancelled orders release their selection items for reuse.
CREATE TRIGGER trg_order_item_selection_unique_insert
BEFORE INSERT ON customer_order_item
WHEN NEW.selection_item_id IS NOT NULL
 AND EXISTS (
    SELECT 1
    FROM customer_order_item existing_item
    JOIN customer_order existing_order
      ON existing_order.id = existing_item.order_id
    WHERE existing_item.selection_item_id = NEW.selection_item_id
      AND existing_order.status <> 'Cancelled'
 )
BEGIN
    SELECT RAISE(ABORT, 'This selection item already belongs to an active order');
END;

CREATE TRIGGER trg_order_item_selection_unique_update
BEFORE UPDATE OF selection_item_id, order_id ON customer_order_item
WHEN NEW.selection_item_id IS NOT NULL
 AND EXISTS (
    SELECT 1
    FROM customer_order_item existing_item
    JOIN customer_order existing_order
      ON existing_order.id = existing_item.order_id
    WHERE existing_item.selection_item_id = NEW.selection_item_id
      AND existing_order.status <> 'Cancelled'
      AND existing_item.id <> NEW.id
 )
BEGIN
    SELECT RAISE(ABORT, 'This selection item already belongs to an active order');
END;

-- Calculate balances at customer + exhibition level.
-- Sum item prices per order first, and count each payment exactly once.
-- Direct orders without an exhibition are excluded from these balances.
CREATE VIEW v_customer_balance AS
WITH order_totals AS (
    SELECT
        co.id,
        co.exhibition_id,
        co.customer_id,
        co.customer_name_snapshot,
        co.status,
        COALESCE(SUM(coi.agreed_price_paise), 0) AS order_total
    FROM customer_order co
    JOIN customer_order_item coi ON coi.order_id = co.id
    WHERE co.exhibition_id IS NOT NULL
    GROUP BY
        co.id,
        co.exhibition_id,
        co.customer_id,
        co.customer_name_snapshot,
        co.status
),
balance_entries AS (
    SELECT
        exhibition_id,
        customer_id,
        customer_name_snapshot,
        CASE
            WHEN status <> 'Cancelled' THEN order_total
            ELSE 0
        END AS order_total,
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
