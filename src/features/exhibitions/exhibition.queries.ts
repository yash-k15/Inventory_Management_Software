import { getDatabase } from '../../db';
import { getSelectionCustomers, getSelectionItems } from './selection.queries';

import type {
  Exhibition,
  ExhibitionCategoryCount,
  ExhibitionFilters,
  ExhibitionInput,
} from './exhibition.types';

interface ExhibitionRow {
  id: number;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: Exhibition['status'];
  totalDays: number;
  registeredItems: number;
  customersAttended: number;
  customersWithSelections: number;
  totalSelections: number;
  distinctSelectedItems: number;
}

interface CategoryCountRow {
  exhibitionId: number;
  categoryId: number;
  categoryName: string;
  itemCount: number;
  uniqueSelectedItems: number;
  totalSelections: number;
}

export async function getExhibitions(
  filters: ExhibitionFilters,
): Promise<Exhibition[]> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  const search = filters.search.trim();

  if (search) {
    conditions.push("(e.name LIKE ? OR COALESCE(e.location, '') LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  if (filters.status === 'upcoming') conditions.push("e.status = 'Planned'");
  else if (filters.status === 'active') conditions.push("e.status = 'Active'");
  else if (filters.status === 'past') conditions.push("e.status = 'Closed'");

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const rows = await database.select<ExhibitionRow[]>(
    `
      SELECT
        e.id,
        e.name,
        e.location,
        e.start_date AS startDate,
        e.end_date AS endDate,
        e.notes,
        e.status,
        e.total_days AS totalDays,
        (SELECT COUNT(*) FROM exhibition_item ei WHERE ei.exhibition_id = e.id) AS registeredItems,
        COALESCE(s.customers_attended, 0) AS customersAttended,
        COALESCE(s.customers_with_selections, 0) AS customersWithSelections,
        COALESCE(s.total_selections, 0) AS totalSelections,
        COALESCE(s.distinct_items, 0) AS distinctSelectedItems
      FROM v_exhibition e
      LEFT JOIN v_exhibition_summary s ON s.exhibition_id = e.id
      ${whereClause}
      ORDER BY e.start_date DESC, e.id DESC
    `,
    params,
  );

  const categoryRows = await database.select<CategoryCountRow[]>(
    `
      SELECT
        e.id AS exhibitionId,
        c.id AS categoryId,
        c.name AS categoryName,
        (
          SELECT COUNT(*)
          FROM exhibition_item ei
          JOIN item registered_item ON registered_item.id = ei.item_id
          WHERE ei.exhibition_id = e.id
            AND registered_item.category_id = c.id
        ) AS itemCount,
        (
          SELECT COUNT(DISTINCT si.inventory_item_id)
          FROM selection s
          JOIN selection_item si ON si.selection_id = s.id
          JOIN item selected_item ON selected_item.id = si.inventory_item_id
          WHERE s.exhibition_id = e.id
            AND selected_item.category_id = c.id
            AND si.status = 'active'
            AND si.inventory_item_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM exhibition_item ei
              WHERE ei.exhibition_id = e.id AND ei.item_id = si.inventory_item_id
            )
        ) AS uniqueSelectedItems,
        (
          SELECT COUNT(*)
          FROM selection s
          JOIN selection_item si ON si.selection_id = s.id
          JOIN item selected_item ON selected_item.id = si.inventory_item_id
          WHERE s.exhibition_id = e.id
            AND selected_item.category_id = c.id
            AND si.status = 'active'
            AND si.inventory_item_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM exhibition_item ei
              WHERE ei.exhibition_id = e.id AND ei.item_id = si.inventory_item_id
            )
        ) AS totalSelections
      FROM v_exhibition e
      CROSS JOIN category c
      WHERE c.is_archived = 0
      ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC
    `,
  );

  const categoriesByExhibition = new Map<number, ExhibitionCategoryCount[]>();

  for (const row of categoryRows) {
    const categories = categoriesByExhibition.get(row.exhibitionId) ?? [];
    categories.push({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      itemCount: row.itemCount,
      uniqueSelectedItems: 0,
      totalSelections: 0,
    });
    categoriesByExhibition.set(row.exhibitionId, categories);
  }

  // Use the same selection records as the Selections tab.
  for (const row of rows) {
    const categories = categoriesByExhibition.get(row.id) ?? [];
    const categoriesByName = new Map(
      categories.map((category) => [
        category.categoryName.trim().toLowerCase(),
        category,
      ]),
    );
    const uniqueItemsByCategory = new Map<string, Set<number>>();

    const customers = await getSelectionCustomers(row.id, '');

    for (const customer of customers) {
      if (customer.selectionId === null) continue;

      const items = await getSelectionItems(customer.selectionId);

      for (const item of items) {
        if (item.status !== 'active') continue;

        const categoryKey = item.categoryName.trim().toLowerCase();
        const category = categoriesByName.get(categoryKey);

        if (!category) continue;

        category.totalSelections += 1;

        if (item.inventoryItemId === null) continue;

        const uniqueItems =
          uniqueItemsByCategory.get(categoryKey) ?? new Set<number>();
        uniqueItems.add(item.inventoryItemId);
        uniqueItemsByCategory.set(categoryKey, uniqueItems);
      }
    }

    for (const [categoryKey, uniqueItems] of uniqueItemsByCategory) {
      const category = categoriesByName.get(categoryKey);
      if (category) {
        category.uniqueSelectedItems = uniqueItems.size;
      }
    }
  }

  return rows.map((row) => ({
    ...row,
    categories: categoriesByExhibition.get(row.id) ?? [],
  }));
}

export async function createExhibition(input: ExhibitionInput): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO exhibition (name, location, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.location.trim() || null,
      input.startDate,
      input.endDate,
      input.notes.trim() || null,
    ],
  );
}

export async function updateExhibition(
  exhibitionId: number,
  input: ExhibitionInput,
): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE exhibition SET name = ?, location = ?, start_date = ?, end_date = ?, notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [
      input.name.trim(),
      input.location.trim() || null,
      input.startDate,
      input.endDate,
      input.notes.trim() || null,
      exhibitionId,
    ],
  );
}

export async function deleteExhibition(exhibitionId: number): Promise<void> {
  const database = await getDatabase();
  await database.execute('DELETE FROM exhibition WHERE id = ?', [exhibitionId]);
}

export interface ExhibitionInventoryRow {
  id: number;
  itemNumber: string;
  categoryId: number;
  categoryName: string;
  name: string | null;
  imagePath: string | null;
  grossWeightMilli: number | null;
  netWeightMilli: number | null;
  diamondDetails: string | null;
  stoneDetails: string | null;
  igiCertificateNumber: string | null;
  huid: string | null;
  isArchived: number;
  isRegistered: number;
  selectionCount: number;
}

export interface ExhibitionInventoryFilters {
  search: string;
  categoryId: number | null;
  registeredOnly: boolean;
}

export async function getExhibitionInventory(
  exhibitionId: number,
  filters: ExhibitionInventoryFilters,
): Promise<ExhibitionInventoryRow[]> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [exhibitionId];

  if (filters.registeredOnly) {
    conditions.push('ei.item_id IS NOT NULL');
  }
  if (filters.categoryId !== null) {
    conditions.push('i.category_id = ?');
    params.push(filters.categoryId);
  }
  const search = filters.search.trim();
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(`(
      i.item_number LIKE ?
      OR COALESCE(i.name, '') LIKE ?
      OR COALESCE(i.igi_certificate_number, '') LIKE ?
      OR COALESCE(i.huid, '') LIKE ?
      OR EXISTS (
        SELECT 1 FROM item_diamond d
        JOIN diamond_shape ds ON ds.id = d.shape_id
        WHERE d.item_id = i.id AND ds.name LIKE ?
      )
      OR EXISTS (
        SELECT 1 FROM item_stone s
        JOIN stone_type st ON st.id = s.stone_type_id
        WHERE s.item_id = i.id AND st.name LIKE ?
      )
    )`);
    params.push(pattern, pattern, pattern, pattern, pattern, pattern);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';
  return database.select<ExhibitionInventoryRow[]>(
    `
      SELECT
        i.id,
        i.item_number AS itemNumber,
        i.category_id AS categoryId,
        c.name AS categoryName,
        i.name,
        i.image_path AS imagePath,
        i.gross_weight_milli AS grossWeightMilli,
        i.net_weight_milli AS netWeightMilli,
        i.igi_certificate_number AS igiCertificateNumber,
        i.huid,
        i.is_archived AS isArchived,
        CASE WHEN ei.item_id IS NULL THEN 0 ELSE 1 END AS isRegistered,
        (
          SELECT GROUP_CONCAT(
            ds.name || ' · ' || printf('%.3f', d.weight_milli / 1000.0) || ' ct' ||
            char(10) || COALESCE(d.pieces, 0) || ' pcs',
            char(10)
          )
          FROM item_diamond d
          JOIN diamond_shape ds ON ds.id = d.shape_id
          WHERE d.item_id = i.id
        ) AS diamondDetails,
        (
          SELECT GROUP_CONCAT(
            st.name || ' · ' || printf('%.3f', s.weight_milli / 1000.0) || ' ' || st.weight_unit,
            char(10)
          )
          FROM item_stone s
          JOIN stone_type st ON st.id = s.stone_type_id
          WHERE s.item_id = i.id
        ) AS stoneDetails,
        (
          SELECT COUNT(*)
          FROM selection_item si
          JOIN selection s ON s.id = si.selection_id
          WHERE s.exhibition_id = ? AND si.inventory_item_id = i.id AND si.status = 'active'
        ) AS selectionCount
      FROM item i
      JOIN category c ON c.id = i.category_id
      LEFT JOIN exhibition_item ei ON ei.item_id = i.id AND ei.exhibition_id = ?
      ${whereClause}
      ORDER BY i.item_number COLLATE NOCASE ASC
    `,
    [exhibitionId, exhibitionId, ...params.slice(1)],
  );
}

export async function registerExhibitionItems(
  exhibitionId: number,
  itemIds: number[],
): Promise<number> {
  if (itemIds.length === 0) return 0;
  const database = await getDatabase();
  const rows = await database.select<{ endDate: string }[]>(
    'SELECT end_date AS endDate FROM exhibition WHERE id = ?',
    [exhibitionId],
  );
  if (!rows.length) throw new Error('This exhibition could not be found.');
  const todayRows = await database.select<{ today: string }[]>(
    "SELECT date('now','localtime') AS today",
  );
  if (rows[0].endDate < todayRows[0].today) {
    throw new Error(
      'Inventory registration is closed because this exhibition has ended.',
    );
  }

  let added = 0;
  for (const itemId of [...new Set(itemIds)]) {
    const result = await database.execute(
      'INSERT OR IGNORE INTO exhibition_item (exhibition_id, item_id) VALUES (?, ?)',
      [exhibitionId, itemId],
    );
    if (result.rowsAffected > 0) added += 1;
  }
  return added;
}

export async function registerExhibitionItemByBarcode(
  exhibitionId: number,
  barcode: string,
): Promise<'registered' | 'already-registered' | 'not-found'> {
  const normalized = barcode.trim();
  if (!normalized) return 'not-found';
  const database = await getDatabase();
  const items = await database.select<{ id: number }[]>(
    'SELECT id FROM item WHERE item_number = ? COLLATE NOCASE LIMIT 1',
    [normalized],
  );
  if (!items.length) return 'not-found';
  const already = await database.select<{ found: number }[]>(
    'SELECT 1 AS found FROM exhibition_item WHERE exhibition_id = ? AND item_id = ? LIMIT 1',
    [exhibitionId, items[0].id],
  );
  if (already.length) return 'already-registered';
  const added = await registerExhibitionItems(exhibitionId, [items[0].id]);
  return added ? 'registered' : 'already-registered';
}

export async function unregisterExhibitionItem(
  exhibitionId: number,
  itemId: number,
): Promise<void> {
  const database = await getDatabase();

  const exhibitions = await database.select<{ endDate: string }[]>(
    'SELECT end_date AS endDate FROM exhibition WHERE id = ?',
    [exhibitionId],
  );
  if (!exhibitions.length)
    throw new Error('This exhibition could not be found.');

  const todayRows = await database.select<{ today: string }[]>(
    "SELECT date('now','localtime') AS today",
  );
  if (exhibitions[0].endDate < todayRows[0].today) {
    throw new Error(
      'Inventory cannot be removed because this exhibition has ended.',
    );
  }

  const activeSelections = await database.select<{ count: number }[]>(
    `SELECT COUNT(*) AS count
     FROM selection_item si
     JOIN selection s ON s.id = si.selection_id
     WHERE s.exhibition_id = ?
       AND si.inventory_item_id = ?
       AND si.status = 'active'`,
    [exhibitionId, itemId],
  );
  if ((activeSelections[0]?.count ?? 0) > 0) {
    throw new Error(
      'This item has active customer selections. Remove those selections before unregistering the item.',
    );
  }

  await database.execute(
    'DELETE FROM exhibition_item WHERE exhibition_id = ? AND item_id = ?',
    [exhibitionId, itemId],
  );
}
