
-- Standard jewelry purities.
INSERT INTO purity (name, percent_bp)
VALUES
    ('18K', 7500),
    ('22K', 9160),
    ('24K', 9990);

-- Keep the existing short labels, but use readable full names.
UPDATE diamond_shape
SET name = 'Paan Markis'
WHERE code = 'P/M';

UPDATE diamond_shape
SET name = 'Taper Bucket'
WHERE code = 'T/B';

UPDATE diamond_shape
SET name = 'Round'
WHERE code = 'RD';

-- Default diamond quality for each configured cut.
INSERT INTO diamond_combination (shape_id, quality, rate_per_ct_paise)
SELECT id, 'EF-VVS', 0
FROM diamond_shape
WHERE code IN ('RD', 'P/M', 'T/B')
ON CONFLICT (shape_id, quality) DO NOTHING;
