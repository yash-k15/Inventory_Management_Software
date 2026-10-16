-- Settings defaults and persisted GST configuration.
-- Existing user-entered rates are preserved; only the original zero wastage default is initialized.
UPDATE global_rate
SET value = 800, updated_at = datetime('now','localtime')
WHERE rate_key = 'wastage_percent_bp' AND value = 0;

INSERT OR IGNORE INTO app_setting (key, value) VALUES
    ('wastage_mode', 'percent'),
    ('gst_rate_bp', '300'),
    ('business_state', 'Maharashtra');
