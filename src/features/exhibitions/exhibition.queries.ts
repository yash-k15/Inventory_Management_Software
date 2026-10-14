import { getDatabase } from '../../db';
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
}

export async function getExhibitions(filters: ExhibitionFilters): Promise<Exhibition[]> {
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

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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
        COUNT(ei.item_id) AS itemCount
      FROM v_exhibition e
      CROSS JOIN category c
      LEFT JOIN item i ON i.category_id = c.id
      LEFT JOIN exhibition_item ei
        ON ei.item_id = i.id
        AND ei.exhibition_id = e.id
      WHERE c.is_archived = 0
      GROUP BY e.id, c.id, c.name, c.sort_order
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
    });
    categoriesByExhibition.set(row.exhibitionId, categories);
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
    [input.name.trim(), input.location.trim() || null, input.startDate, input.endDate, input.notes.trim() || null],
  );
}

export async function updateExhibition(exhibitionId: number, input: ExhibitionInput): Promise<void> {
  const database = await getDatabase();
  await database.execute(
    `UPDATE exhibition SET name = ?, location = ?, start_date = ?, end_date = ?, notes = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [input.name.trim(), input.location.trim() || null, input.startDate, input.endDate, input.notes.trim() || null, exhibitionId],
  );
}

export async function deleteExhibition(exhibitionId: number): Promise<void> {
  const database = await getDatabase();
  await database.execute('DELETE FROM exhibition WHERE id = ?', [exhibitionId]);
}
