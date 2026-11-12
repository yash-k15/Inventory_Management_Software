-- Migration 017: standardize all other-stone weights to carats.
-- Existing stone weights are interpreted as carats; no conversion is performed.

-- Normalize all existing stone types.
UPDATE stone_type
SET weight_unit = 'ct'
WHERE weight_unit <> 'ct';

-- Rename the rate column to make its unit explicit.
ALTER TABLE stone_type
RENAME COLUMN rate_paise_per_unit TO rate_paise_per_ct;

-- Prevent future stone types from being configured with gram weights.
CREATE TRIGGER trg_stone_type_carats_only_insert
BEFORE INSERT ON stone_type
WHEN NEW.weight_unit <> 'ct'
BEGIN
    SELECT RAISE(ABORT, 'Stone weights must be measured in carats (ct)');
END;

CREATE TRIGGER trg_stone_type_carats_only_update
BEFORE UPDATE OF weight_unit ON stone_type
WHEN NEW.weight_unit <> 'ct'
BEGIN
    SELECT RAISE(ABORT, 'Stone weights must be measured in carats (ct)');
END;