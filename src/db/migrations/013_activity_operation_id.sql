ALTER TABLE activity_log
ADD COLUMN operation_id TEXT;

CREATE INDEX idx_activity_log_operation_id
ON activity_log(operation_id);