
-- Initial jewelry categories and their independent item-number series.
-- Existing TEST categories and items are intentionally left unchanged.

INSERT INTO item_series (name, prefix, next_number, number_width, range_end)
VALUES
    ('Necklace',  'N',  1, 3, NULL),
    ('Ring',      'R',  1, 3, NULL),
    ('Bracelet',  'BR', 1, 3, NULL),
    ('Bangle',    'B',  1, 3, NULL),
    ('Chain',     'C',  1, 3, NULL),
    ('Pendant',   'P',  1, 3, NULL),
    ('Jhumka',    'J',  1, 3, NULL),
    ('Earrings',  'E',  1, 3, NULL),
    ('Vadiyanam', 'V',  1, 3, NULL);

INSERT INTO category (name, series_id, sort_order)
SELECT 'Necklace', id, 1 FROM item_series WHERE name = 'Necklace';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Ring', id, 2 FROM item_series WHERE name = 'Ring';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Bracelet', id, 3 FROM item_series WHERE name = 'Bracelet';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Bangle', id, 4 FROM item_series WHERE name = 'Bangle';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Chain', id, 5 FROM item_series WHERE name = 'Chain';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Pendant', id, 6 FROM item_series WHERE name = 'Pendant';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Jhumka', id, 7 FROM item_series WHERE name = 'Jhumka';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Earrings', id, 8 FROM item_series WHERE name = 'Earrings';

INSERT INTO category (name, series_id, sort_order)
SELECT 'Vadiyanam', id, 9 FROM item_series WHERE name = 'Vadiyanam';
