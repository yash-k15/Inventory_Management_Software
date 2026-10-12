import { getDatabase } from '../../db';
import type {
  InventoryCategoryOption,
  InventoryFilters,
  InventoryItem,
} from './inventory.types';

export async function getInventoryItems(
  filters: InventoryFilters,
): Promise<InventoryItem[]> {
  const database = await getDatabase();

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const search = filters.search.trim();

  if (search) {
    conditions.push(
      '(i.item_number LIKE ? OR COALESCE(i.name, \'\') LIKE ?)',
    );
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern);
  }

  if (filters.categoryId !== null) {
    conditions.push('i.category_id = ?');
    params.push(filters.categoryId);
  }

  if (filters.certification === 'certified') {
  conditions.push(
    "i.igi_certificate_number IS NOT NULL AND TRIM(i.igi_certificate_number) <> ''",
  );
  } else if (filters.certification === 'uncertified') {
    conditions.push(
      "(i.igi_certificate_number IS NULL OR TRIM(i.igi_certificate_number) = '')",
    );
  }

  if (filters.archiveStatus === 'active') {
    conditions.push('i.is_archived = 0');
  } else if (filters.archiveStatus === 'archived') {
    conditions.push('i.is_archived = 1');
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const sql = `
    SELECT
      i.id,
      i.item_number AS itemNumber,
      i.category_id AS categoryId,
      c.name AS categoryName,
      i.name,
      i.image_path AS imagePath,
      i.gross_weight_milli AS grossWeightMilli,
      p.name AS purityName,
      p.percent_bp AS purityPercentBp,
      i.igi_certificate_number AS igiCertificateNumber,
      i.huid,
      i.notes,
      i.custom_values AS customValues,
      i.is_archived AS isArchived,

      (
        SELECT GROUP_CONCAT(
          ds.name || ': ' ||
          printf('%.3f', d.weight_milli / 1000.0) || ' ct' ||
          ' (' || d.pieces || ' pcs)' ||
          CASE
            WHEN dc.quality IS NOT NULL
            THEN ' - ' || dc.quality
            ELSE ''
          END,
          '; '
        )
        FROM item_diamond d
        JOIN diamond_shape ds ON ds.id = d.shape_id
        LEFT JOIN diamond_combination dc
          ON dc.id = d.combination_id
         AND dc.shape_id = d.shape_id
        WHERE d.item_id = i.id
      ) AS diamondDetails,

      (
        SELECT GROUP_CONCAT(
          st.name || ': ' ||
          printf('%.3f', s.weight_milli / 1000.0) || ' ' ||
          st.weight_unit ||
          ' (' || s.pieces || ' pcs)',
          '; '
        )
        FROM item_stone s
        JOIN stone_type st ON st.id = s.stone_type_id
        WHERE s.item_id = i.id
      ) AS stoneDetails

    FROM item i
    JOIN category c ON c.id = i.category_id
    LEFT JOIN purity p ON p.id = i.purity_id
    ${whereClause}
    ORDER BY i.item_number COLLATE NOCASE ASC
  `;

  return database.select<InventoryItem[]>(sql, params);
}

export async function getInventoryCategories(): Promise<
  InventoryCategoryOption[]
> {
  const database = await getDatabase();

  return database.select<InventoryCategoryOption[]>(`
    SELECT
      id,
      name
    FROM category
    WHERE is_archived = 0
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `);
}