import { getDatabase } from '../../db';
import type {
  Exhibition,
  ExhibitionCategoryCount,
  ExhibitionFilters,
} from './exhibition.types';

export async function getExhibitions(
  filters: ExhibitionFilters,
): Promise<Exhibition[]> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  const search = filters.search.trim();

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      "(e.name LIKE ? OR COALESCE(e.location, '') LIKE ? OR COALESCE(e.notes, '') LIKE ?)",
    );
    params.push(pattern, pattern, pattern);
  }

  if (filters.status === 'upcoming') {
    conditions.push("e.status = 'Planned'");
  } else if (filters.status === 'active') {
    conditions.push("e.status = 'Active'");
  } else if (filters.status === 'past') {
    conditions.push("e.status = 'Closed'");
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return database.select<Exhibition[]>(
    `
      SELECT
        e.id,
        e.name,
        e.location,
        e.start_date AS startDate,
        e.end_date AS endDate,
        e.notes,
        e.created_at AS createdAt,
        e.updated_at AS updatedAt,
        e.status,
        e.total_days AS totalDays,
        COALESCE(s.customers_attended, 0) AS customersAttended,
        COALESCE(s.customers_with_selections, 0) AS customersWithSelections,
        COALESCE(s.total_selections, 0) AS totalSelections,
        COALESCE(s.distinct_items, 0) AS distinctItems
      FROM v_exhibition e
      LEFT JOIN v_exhibition_summary s ON s.exhibition_id = e.id
      ${whereClause}
      ORDER BY
        CASE e.status
          WHEN 'Active' THEN 0
          WHEN 'Planned' THEN 1
          ELSE 2
        END,
        CASE WHEN e.status = 'Closed' THEN e.start_date END DESC,
        CASE WHEN e.status <> 'Closed' THEN e.start_date END ASC,
        e.name COLLATE NOCASE ASC
    `,
    params,
  );
}

export async function getExhibitionCategoryCounts(
  exhibitionIds: number[],
): Promise<ExhibitionCategoryCount[]> {
  if (exhibitionIds.length === 0) return [];

  const database = await getDatabase();
  const placeholders = exhibitionIds.map(() => '?').join(', ');

  return database.select<ExhibitionCategoryCount[]>(
    `
      SELECT
        ei.exhibition_id AS exhibitionId,
        c.id AS categoryId,
        c.name AS categoryName,
        COUNT(*) AS itemCount
      FROM exhibition_item ei
      JOIN item i ON i.id = ei.item_id
      JOIN category c ON c.id = i.category_id
      WHERE ei.exhibition_id IN (${placeholders})
      GROUP BY ei.exhibition_id, c.id, c.name
      ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC
    `,
    exhibitionIds,
  );
}

export async function getExhibitionById(
  exhibitionId: number,
): Promise<Exhibition | null> {
  const database = await getDatabase();
  const rows = await database.select<Exhibition[]>(
    `
      SELECT
        e.id,
        e.name,
        e.location,
        e.start_date AS startDate,
        e.end_date AS endDate,
        e.notes,
        e.created_at AS createdAt,
        e.updated_at AS updatedAt,
        e.status,
        e.total_days AS totalDays,
        COALESCE(s.customers_attended, 0) AS customersAttended,
        COALESCE(s.customers_with_selections, 0) AS customersWithSelections,
        COALESCE(s.total_selections, 0) AS totalSelections,
        COALESCE(s.distinct_items, 0) AS distinctItems
      FROM v_exhibition e
      LEFT JOIN v_exhibition_summary s ON s.exhibition_id = e.id
      WHERE e.id = ?
    `,
    [exhibitionId],
  );
  return rows[0] ?? null;
}
