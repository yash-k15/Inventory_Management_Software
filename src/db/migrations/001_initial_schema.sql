-- =====================================================================
-- Inventory, Exhibition, Selection, Order & Payment - initial application schema
-- B2B diamond jewelry business. One business, one laptop, offline, no users.
--
-- CONVENTIONS
--   * INTEGER primary keys.  Item.id uses AUTOINCREMENT so ids are never reused.
--   * Money: INTEGER paise (Rs 1 = 100).
--   * Weights: INTEGER = value x 1000 ("milli"). 5.280 g -> 5280, 0.96 ct -> 960.
--     Gross weight is grams. Diamond weights are carats; stone units are per stone type.
--   * Percentages: INTEGER basis points (91.6% -> 9160).
--   * Timestamps: ISO text, LOCAL time (the owner's laptop clock).
--   * Exhibition status is DERIVED from dates (see v_exhibition), never stored.
--   * Run PRAGMA foreign_keys = ON on EVERY connection.
--
-- COSTING (done in app code, inputs live here):
--   non_gold_g   = (sum diamond ct + sum stone ct) * 0.2
--   net_gold_g   = gross_g - non_gold_g
--   actual_gold  = net_gold_g * purity
--   gold_value   = actual_gold * gold_rate
--   wastage      = net_gold_g * wastage% * gold_rate
--                OR net_gold_g * wastage_per_g
--   diamonds     = sum(ct * combination rate)
--   stones       = sum(weight in the stone type's unit * stone rate)
--   certification= diamond ct * certification rate
--   Selections FOLLOW global rates unless selection_item.overrides has a value.
--   Orders FREEZE everything at creation.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Business, licence, settings
-- ---------------------------------------------------------------------
CREATE TABLE business (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    name          TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'INR',
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE license (
    id               INTEGER PRIMARY KEY CHECK (id = 1),
    license_id       TEXT NOT NULL,
    machine_id       TEXT NOT NULL,
    edition          TEXT,
    activated_at     TEXT NOT NULL,
    expires_at       TEXT,
    signed_license   TEXT NOT NULL,
    last_verified_at TEXT
);

CREATE TABLE app_setting (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------------------------------------------------------------------
-- Global (standard) rates. Selections follow these until overridden.
-- Keys: gold_per_g_paise, certification_per_ct_paise,
--       wastage_percent_bp, wastage_per_g_paise
-- (wastage mode, percent vs per-gram, goes in app_setting)
-- ---------------------------------------------------------------------
CREATE TABLE global_rate (
    rate_key   TEXT PRIMARY KEY,
    value      INTEGER NOT NULL CHECK (value >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO global_rate (rate_key, value) VALUES
    ('gold_per_g_paise', 0),
    ('certification_per_ct_paise', 0),
    ('wastage_percent_bp', 0),
    ('wastage_per_g_paise', 0);

CREATE TABLE purity (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,          -- '18K'
    percent_bp INTEGER NOT NULL CHECK (percent_bp BETWEEN 1 AND 10000),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1))
);

-- Diamond shapes seen on the tags: RD, P/M, T/B (full names to be confirmed).
CREATE TABLE diamond_shape (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE COLLATE NOCASE,        -- label printed on tag
    name        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1))
);
INSERT INTO diamond_shape (code, name, sort_order) VALUES
    ('RD',  'Round', 1),
    ('P/M', 'P/M',   2),
    ('T/B', 'T/B',   3);

-- Business-defined combinations ("Round VS/G", "Round VS", ...) with a rate per carat.
CREATE TABLE diamond_combination (
    id                 INTEGER PRIMARY KEY,
    shape_id           INTEGER NOT NULL REFERENCES diamond_shape(id) ON DELETE RESTRICT,
    quality            TEXT NOT NULL COLLATE NOCASE,         -- 'VS/G', 'VS'
    rate_per_ct_paise  INTEGER NOT NULL DEFAULT 0 CHECK (rate_per_ct_paise >= 0),
    is_archived        INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    updated_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (shape_id, quality),
    UNIQUE (id, shape_id)                                    -- target for composite FK below
);

-- Stone types are owner-configurable. Existing types start in carats;
-- future types may use grams. Rates are per selected measurement unit.
CREATE TABLE stone_type (
    id                  INTEGER PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE COLLATE NOCASE,
    tag_label           TEXT NOT NULL,
    weight_unit         TEXT NOT NULL DEFAULT 'ct' CHECK (weight_unit IN ('ct','g')),
    rate_paise_per_unit INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise_per_unit >= 0),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_archived         INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT INTO stone_type (name, tag_label, weight_unit, sort_order) VALUES
    ('Red Stone',   'R ST',  'ct', 1),
    ('Green Stone', 'G ST',  'ct', 2),
    ('Pearl',       'PEARL', 'ct', 3);

-- ---------------------------------------------------------------------
-- Item-number series (never reused, counter only moves forward)
-- e.g. prefix 'E' for earrings, 'LR' for rings, or a numeric range for bangles
-- ---------------------------------------------------------------------
CREATE TABLE item_series (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    prefix      TEXT NOT NULL DEFAULT '',
    next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
    number_width INTEGER NOT NULL DEFAULT 0 CHECK (number_width >= 0),   -- zero padding
    range_end   INTEGER                                                  -- NULL = open-ended
);

CREATE TABLE category (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    series_id   INTEGER REFERENCES item_series(id) ON DELETE SET NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1))
);

-- Dynamic fields supplement fixed jewelry columns. Field values are stored
-- in item.custom_values as JSON keyed by field-definition ID.
CREATE TABLE field_definition (
    id              INTEGER PRIMARY KEY,
    category_id     INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
    name            TEXT NOT NULL COLLATE NOCASE,
    data_type       TEXT NOT NULL CHECK (data_type IN ('text','number','boolean','date','select')),
    unit            TEXT,
    is_required     INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0,1)),
    is_searchable   INTEGER NOT NULL DEFAULT 0 CHECK (is_searchable IN (0,1)),
    is_filterable   INTEGER NOT NULL DEFAULT 0 CHECK (is_filterable IN (0,1)),
    show_on_tag     INTEGER NOT NULL DEFAULT 0 CHECK (show_on_tag IN (0,1)),
    show_on_scan    INTEGER NOT NULL DEFAULT 0 CHECK (show_on_scan IN (0,1)),
    show_in_reports INTEGER NOT NULL DEFAULT 0 CHECK (show_in_reports IN (0,1)),
    default_value   TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_archived     INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    UNIQUE (category_id, name)
);
CREATE INDEX idx_field_definition_category
    ON field_definition(category_id, is_archived, sort_order);

CREATE TABLE field_option (
    id                  INTEGER PRIMARY KEY,
    field_definition_id INTEGER NOT NULL REFERENCES field_definition(id) ON DELETE RESTRICT,
    label               TEXT NOT NULL COLLATE NOCASE,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_archived         INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    UNIQUE (field_definition_id, label)
);
CREATE INDEX idx_field_option_field
    ON field_option(field_definition_id, is_archived, sort_order);

-- ---------------------------------------------------------------------
-- Inventory (a catalog of designs, not physical stock)
-- ---------------------------------------------------------------------
CREATE TABLE item (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    item_number      TEXT NOT NULL UNIQUE,                   -- = "D NO." on tags; barcode value
    category_id      INTEGER NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
    name             TEXT,                                   -- optional (Excel has none)
    image_path       TEXT,                                   -- ONE photo, relative path
    gross_weight_milli INTEGER CHECK (gross_weight_milli IS NULL OR gross_weight_milli >= 0),  -- grams x1000
    purity_id        INTEGER REFERENCES purity(id) ON DELETE RESTRICT,
    is_certified     INTEGER NOT NULL DEFAULT 0 CHECK (is_certified IN (0,1)),   -- 'igi' column
    huid             TEXT,
    notes            TEXT,
    custom_values    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(custom_values)),
    is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    archived_at      TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_item_category ON item(category_id);
CREATE INDEX idx_item_archived ON item(is_archived);

-- Diamond lines. combination_id (quality) can be NULL until decided,
-- and must belong to the same shape (composite FK).
CREATE TABLE item_diamond (
    id             INTEGER PRIMARY KEY,
    item_id        INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
    shape_id       INTEGER NOT NULL REFERENCES diamond_shape(id) ON DELETE RESTRICT,
    combination_id INTEGER,
    pieces         INTEGER CHECK (pieces IS NULL OR pieces >= 0),
    weight_milli   INTEGER NOT NULL CHECK (weight_milli >= 0),      -- carats x1000
    UNIQUE (item_id, shape_id),
    FOREIGN KEY (combination_id, shape_id)
        REFERENCES diamond_combination(id, shape_id) ON DELETE RESTRICT
);

CREATE TABLE item_stone (
    id            INTEGER PRIMARY KEY,
    item_id       INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
    stone_type_id INTEGER NOT NULL REFERENCES stone_type(id) ON DELETE RESTRICT,
    pieces        INTEGER CHECK (pieces IS NULL OR pieces >= 0),
    weight_milli  INTEGER NOT NULL CHECK (weight_milli >= 0),       -- in stone_type.weight_unit x1000
    UNIQUE (item_id, stone_type_id)
);

-- Item number is permanent.
CREATE TRIGGER trg_item_number_immutable
BEFORE UPDATE OF item_number ON item
WHEN NEW.item_number <> OLD.item_number
BEGIN
    SELECT RAISE(ABORT, 'Item number is permanent and cannot be changed');
END;

-- Cannot archive an item that is in an exhibition that has not ended.
CREATE TRIGGER trg_item_archive_guard
BEFORE UPDATE OF is_archived ON item
WHEN NEW.is_archived = 1 AND OLD.is_archived = 0
 AND EXISTS (SELECT 1 FROM exhibition_item ei
             JOIN exhibition e ON e.id = ei.exhibition_id
             WHERE ei.item_id = OLD.id AND e.end_date >= date('now','localtime'))
BEGIN
    SELECT RAISE(ABORT, 'Item is in a current or upcoming exhibition and cannot be archived');
END;

-- Permanent deletion only from the archive.
CREATE TRIGGER trg_item_delete_guard
BEFORE DELETE ON item
WHEN OLD.is_archived = 0
BEGIN
    SELECT RAISE(ABORT, 'Only archived items can be permanently deleted');
END;

-- ---------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------
CREATE TABLE label_template (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    width_mm          REAL NOT NULL CHECK (width_mm > 0),
    height_mm         REAL NOT NULL CHECK (height_mm > 0),
    barcode_symbology TEXT NOT NULL DEFAULT 'code128'
                      CHECK (barcode_symbology IN ('code128','qr','datamatrix')),
    layout_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(layout_json)),
    is_default        INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1))
);

-- ---------------------------------------------------------------------
-- Customers (a business, with several contacts)
-- ---------------------------------------------------------------------
CREATE TABLE customer (
    id            INTEGER PRIMARY KEY,
    business_name TEXT NOT NULL,
    notes         TEXT,
    is_archived   INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0,1)),
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_customer_name ON customer(business_name COLLATE NOCASE);

CREATE TABLE customer_contact (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    phone_1     TEXT,
    phone_2     TEXT,
    is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    notes       TEXT
);
CREATE INDEX idx_contact_customer ON customer_contact(customer_id);
CREATE INDEX idx_contact_name     ON customer_contact(name COLLATE NOCASE);
CREATE INDEX idx_contact_phone1   ON customer_contact(phone_1);
CREATE INDEX idx_contact_phone2   ON customer_contact(phone_2);

-- ---------------------------------------------------------------------
-- Exhibitions (status derived from dates)
-- ---------------------------------------------------------------------
CREATE TABLE exhibition (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    location   TEXT,
    start_date TEXT NOT NULL,                                -- 'YYYY-MM-DD'; start = Day 1
    end_date   TEXT NOT NULL,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    CHECK (end_date >= start_date)
);

-- Only future exhibitions may be deleted.
CREATE TRIGGER trg_exhibition_delete_guard
BEFORE DELETE ON exhibition
WHEN OLD.start_date <= date('now','localtime')
BEGIN
    SELECT RAISE(ABORT, 'Only future exhibitions can be deleted');
END;

-- Inventory registered for an exhibition. NOT a customer selection.
-- (Freezing after end_date is enforced by the app.)
CREATE TABLE exhibition_item (
    exhibition_id INTEGER NOT NULL REFERENCES exhibition(id) ON DELETE CASCADE,
    item_id       INTEGER NOT NULL REFERENCES item(id)       ON DELETE CASCADE,
    added_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (exhibition_id, item_id)
);
CREATE INDEX idx_exhibition_item_item ON exhibition_item(item_id);

-- ---------------------------------------------------------------------
-- Selections: exactly one per customer per exhibition
-- Deleting a customer cascades to selections (the app warns first);
-- orders and payments survive via their own snapshots.
-- ---------------------------------------------------------------------
CREATE TABLE selection (
    id            INTEGER PRIMARY KEY,
    customer_id   INTEGER NOT NULL REFERENCES customer(id)   ON DELETE CASCADE,
    exhibition_id INTEGER NOT NULL REFERENCES exhibition(id) ON DELETE RESTRICT,
    notes         TEXT,                                       -- free text, never parsed
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (customer_id, exhibition_id)
);
CREATE INDEX idx_selection_exhibition ON selection(exhibition_id);

-- snapshot_data (JSON): item_number, category, name, gross_weight_milli, purity,
--   diamonds [{shape, combination_id, pieces, weight_milli}],
--   stones [{stone, pieces, weight_milli}], is_certified, huid, image_path.
--   Weights/identity are frozen; RATES are NOT in the snapshot (they follow global).
-- overrides (JSON): negotiated values for THIS selection only. A missing key
--   means "follow the global rate". Keys: gold_rate_paise, wastage_mode,
--   wastage_percent_bp, wastage_per_g_paise, certification_per_ct_paise,
--   diamond_combination_id{shape: id}, diamond_rate_paise{shape: n}, stone_rate_paise{stone: n}
CREATE TABLE selection_item (
    id                INTEGER PRIMARY KEY,
    selection_id      INTEGER NOT NULL REFERENCES selection(id) ON DELETE CASCADE,
    inventory_item_id INTEGER REFERENCES item(id) ON DELETE SET NULL,   -- survives item deletion as NULL
    snapshot_data     TEXT NOT NULL CHECK (json_valid(snapshot_data)),
    overrides         TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(overrides)),
    status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
    added_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    removed_at        TEXT,
    updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_selection_item_sel  ON selection_item(selection_id, status);
CREATE INDEX idx_selection_item_item ON selection_item(inventory_item_id, status);
-- A duplicate scan can never create a second ACTIVE row; a removed item can be re-selected as a new row.
CREATE UNIQUE INDEX uq_selection_item_active
    ON selection_item(selection_id, inventory_item_id)
    WHERE status = 'active' AND inventory_item_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Orders: one per jewelry piece. Behaves like an invoice once created.
-- ---------------------------------------------------------------------
CREATE TABLE customer_order (
    id                     INTEGER PRIMARY KEY,
    selection_item_id      INTEGER REFERENCES selection_item(id) ON DELETE SET NULL,
    customer_id            INTEGER REFERENCES customer(id)       ON DELETE SET NULL,
    customer_name_snapshot TEXT NOT NULL,
    exhibition_id          INTEGER NOT NULL REFERENCES exhibition(id) ON DELETE RESTRICT,
    item_snapshot          TEXT NOT NULL CHECK (json_valid(item_snapshot)),
    pricing_breakdown      TEXT NOT NULL CHECK (json_valid(pricing_breakdown)),   -- gold, wastage, diamonds, stones, certification
    agreed_price_paise     INTEGER NOT NULL CHECK (agreed_price_paise >= 0),
    status                 TEXT NOT NULL DEFAULT 'Confirmed' CHECK (status IN
        ('Confirmed','On Hold','Manufacturing','Ready','Sent','Completed','Cancelled')),
    created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_order_customer   ON customer_order(customer_id);
CREATE INDEX idx_order_exhibition ON customer_order(exhibition_id, status);
-- One live (non-cancelled) order per selected piece.
CREATE UNIQUE INDEX uq_order_live_per_selection_item
    ON customer_order(selection_item_id)
    WHERE selection_item_id IS NOT NULL AND status <> 'Cancelled';

-- Invoice-like: price, snapshots and customer name never change. Status may.
CREATE TRIGGER trg_order_immutable
BEFORE UPDATE ON customer_order
WHEN NEW.agreed_price_paise     <> OLD.agreed_price_paise
  OR NEW.item_snapshot          <> OLD.item_snapshot
  OR NEW.pricing_breakdown      <> OLD.pricing_breakdown
  OR NEW.customer_name_snapshot <> OLD.customer_name_snapshot
  OR NEW.exhibition_id          <> OLD.exhibition_id
BEGIN
    SELECT RAISE(ABORT, 'Order price and snapshots are frozen. Cancel and re-create if a correction is needed');
END;

CREATE TABLE order_status_history (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES customer_order(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    notes      TEXT
);
CREATE INDEX idx_order_history_order ON order_status_history(order_id);

CREATE TRIGGER trg_order_history_insert
AFTER INSERT ON customer_order
BEGIN
    INSERT INTO order_status_history (order_id, status) VALUES (NEW.id, NEW.status);
END;

CREATE TRIGGER trg_order_history_update
AFTER UPDATE OF status ON customer_order
WHEN NEW.status <> OLD.status
BEGIN
    INSERT INTO order_status_history (order_id, status) VALUES (NEW.id, NEW.status);
END;

-- ---------------------------------------------------------------------
-- Payments: per customer + exhibition (not per order); partial payments allowed
-- ---------------------------------------------------------------------
CREATE TABLE payment (
    id                     INTEGER PRIMARY KEY,
    customer_id            INTEGER REFERENCES customer(id) ON DELETE SET NULL,
    customer_name_snapshot TEXT NOT NULL,
    exhibition_id          INTEGER NOT NULL REFERENCES exhibition(id) ON DELETE RESTRICT,
    amount_paise           INTEGER NOT NULL CHECK (amount_paise > 0),
    payment_date           TEXT NOT NULL,
    payment_method         TEXT,
    notes                  TEXT,
    created_at             TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at             TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_payment_customer_exh ON payment(customer_id, exhibition_id);

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
CREATE VIEW v_exhibition AS
SELECT e.*,
       CASE WHEN date('now','localtime') <  e.start_date THEN 'Planned'
            WHEN date('now','localtime') <= e.end_date   THEN 'Active'
            ELSE 'Closed' END AS status,
       CAST(julianday(e.end_date) - julianday(e.start_date) AS INTEGER) + 1 AS total_days
FROM exhibition e;

-- Exhibition Day of each selection item (Day 1 = start date; beyond total_days = after the exhibition)
CREATE VIEW v_selection_item_day AS
SELECT si.id AS selection_item_id,
       s.exhibition_id,
       CAST(julianday(date(si.added_at)) - julianday(e.start_date) AS INTEGER) + 1 AS exhibition_day,
       CASE WHEN date(si.added_at) > e.end_date THEN 1 ELSE 0 END AS after_exhibition
FROM selection_item si
JOIN selection s   ON s.id = si.selection_id
JOIN exhibition e  ON e.id = s.exhibition_id;

CREATE VIEW v_exhibition_summary AS
SELECT e.id AS exhibition_id,
       e.name,
       COUNT(DISTINCT s.customer_id) AS customers_attended,
       COUNT(DISTINCT CASE WHEN si.id IS NOT NULL THEN s.customer_id END) AS customers_with_selections,
       COUNT(si.id)                  AS total_selections,
       COUNT(DISTINCT si.inventory_item_id) AS distinct_items
FROM exhibition e
LEFT JOIN selection s       ON s.exhibition_id = e.id
LEFT JOIN selection_item si ON si.selection_id = s.id AND si.status = 'active'
GROUP BY e.id;

-- Dashboard: items chosen by more than one customer in the same exhibition.
CREATE VIEW v_items_selected_by_multiple_customers AS
SELECT s.exhibition_id,
       i.id AS item_id,
       i.item_number,
       COUNT(DISTINCT s.customer_id) AS customers
FROM selection_item si
JOIN selection s ON s.id = si.selection_id
JOIN item i      ON i.id = si.inventory_item_id
WHERE si.status = 'active'
GROUP BY s.exhibition_id, i.id
HAVING COUNT(DISTINCT s.customer_id) > 1;

-- Balance per customer + exhibition = non-cancelled orders - payments.
-- Deleted customers still appear, grouped by their name snapshot.
CREATE VIEW v_customer_balance AS
SELECT exhibition_id,
       customer_id,
       MAX(customer_name_snapshot) AS customer_name,
       SUM(order_total)            AS total_orders_paise,
       SUM(paid)                   AS total_paid_paise,
       SUM(order_total) - SUM(paid) AS outstanding_paise
FROM (
    SELECT exhibition_id, customer_id, customer_name_snapshot,
           CASE WHEN status <> 'Cancelled' THEN agreed_price_paise ELSE 0 END AS order_total,
           0 AS paid
    FROM customer_order
    UNION ALL
    SELECT exhibition_id, customer_id, customer_name_snapshot, 0, amount_paise
    FROM payment
)
GROUP BY exhibition_id, COALESCE(CAST(customer_id AS TEXT), customer_name_snapshot);
