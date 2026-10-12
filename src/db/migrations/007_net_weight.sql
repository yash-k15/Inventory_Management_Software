ALTER TABLE item
ADD COLUMN net_weight_milli INTEGER
CHECK (
    net_weight_milli IS NULL
    OR net_weight_milli >= 0
);