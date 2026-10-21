
-- Record meaningful inventory and selection-item changes.
-- Bulk operations are stored as one activity with a JSON item snapshot.

CREATE TABLE activity_log (
    id                    INTEGER PRIMARY KEY,
    activity_type         TEXT NOT NULL
        CHECK (activity_type IN (
            'selection_items_added',
            'selection_items_removed',
            'inventory_items_added',
            'inventory_items_removed'
        )),
    exhibition_id         INTEGER
        REFERENCES exhibition(id) ON DELETE SET NULL,
    customer_id           INTEGER
        REFERENCES customer(id) ON DELETE SET NULL,
    customer_name_snapshot TEXT,
    summary               TEXT NOT NULL,
    details_json          TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(details_json)),
    created_at            TEXT NOT NULL
        DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX idx_activity_log_exhibition_created
    ON activity_log(exhibition_id, created_at DESC, id DESC);

CREATE INDEX idx_activity_log_created
    ON activity_log(created_at DESC, id DESC);
