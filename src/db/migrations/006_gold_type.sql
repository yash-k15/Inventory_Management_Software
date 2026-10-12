CREATE TABLE gold_type (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0
        CHECK (is_archived IN (0, 1))
);

INSERT INTO gold_type (id, name, sort_order)
VALUES
    (1, 'Rose Gold', 1),
    (2, 'Yellow', 2),
    (3, 'White', 3);

ALTER TABLE item
ADD COLUMN gold_type_id INTEGER
REFERENCES gold_type(id) ON DELETE RESTRICT;

-- Assign existing jewelry items the initial default gold type.
UPDATE item
SET gold_type_id = 1
WHERE gold_type_id IS NULL;

CREATE INDEX idx_item_gold_type ON item(gold_type_id);

-- Enforce a gold type for all new items, including inserts outside the UI.
CREATE TRIGGER item_gold_type_required_insert
BEFORE INSERT ON item
WHEN NEW.gold_type_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'Gold type is required');
END;

CREATE TRIGGER item_gold_type_required_update
BEFORE UPDATE OF gold_type_id ON item
WHEN NEW.gold_type_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'Gold type is required');
END;