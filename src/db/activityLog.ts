import { getDatabase } from './index';

export type ActivityType =
  | 'selection_items_added'
  | 'selection_items_removed'
  | 'inventory_items_added'
  | 'inventory_items_removed';

interface LogActivityInput {
  activityType: ActivityType;
  summary: string;
  itemNumbers: string[];
  exhibitionId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  operationId?: string;
}

export interface RecentSelectionActivity {
  id: number;
  operationId: string | null;
  activityType: 'selection_items_added' | 'selection_items_removed';
  exhibitionId: number;
  customerId: number | null;
  customerName: string;
  itemCount: number;
  createdAt: string;
}

export async function logActivity({
  activityType,
  summary,
  itemNumbers,
  exhibitionId = null,
  customerId = null,
  customerName = null,
  operationId = crypto.randomUUID(),
}: LogActivityInput): Promise<void> {
  if (itemNumbers.length === 0) {
    return;
  }

  const db = await getDatabase();

  console.log('[Activity log] Writing:', {
    operationId,
    activityType,
    exhibitionId,
    customerId,
    itemNumbers,
  });

  await db.execute(
    `INSERT INTO activity_log (
       activity_type,
       exhibition_id,
       customer_id,
       customer_name_snapshot,
       summary,
       details_json,
       operation_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      activityType,
      exhibitionId,
      customerId,
      customerName,
      summary,
      JSON.stringify({
        itemNumbers,
        itemCount: itemNumbers.length,
      }),
      operationId,
    ],
  );
}

interface ActivityRow {
  id: number;
  operation_id: string | null;
  activity_type: 'selection_items_added' | 'selection_items_removed';
  exhibition_id: number;
  customer_id: number | null;
  customer_name_snapshot: string | null;
  details_json: string;
  created_at: string;
}

export async function getRecentSelectionActivity(
  exhibitionId: number,
  limit = 10,
): Promise<RecentSelectionActivity[]> {
  const db = await getDatabase();

  const rows = await db.select<ActivityRow[]>(
    `SELECT
       id,
       operation_id,
       activity_type,
       exhibition_id,
       customer_id,
       customer_name_snapshot,
       details_json,
       created_at
     FROM activity_log
     WHERE exhibition_id = ?
       AND activity_type IN (
         'selection_items_added',
         'selection_items_removed'
       )
     ORDER BY created_at DESC, id DESC`,
    [exhibitionId],
  );

  console.table(
    rows.map((row) => ({
      id: row.id,
      operation_id: row.operation_id,
      activity_type: row.activity_type,
      details_json: row.details_json,
    })),
  );

  // Rows sharing an operation ID belong to the same batch.
  // Older rows without an operation ID remain separate activities.
  const grouped = new Map<string, RecentSelectionActivity>();

  for (const row of rows) {
    let itemCount = 0;

    try {
      const details = JSON.parse(row.details_json) as {
        itemCount?: number;
        itemNumbers?: string[];
      };

      itemCount =
        typeof details.itemCount === 'number'
          ? details.itemCount
          : Array.isArray(details.itemNumbers)
            ? details.itemNumbers.length
            : 0;
    } catch {
      itemCount = 0;
    }

    const key = row.operation_id
      ? `operation:${row.operation_id}`
      : `legacy:${row.id}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.itemCount += itemCount;

      // Keep the most recent row's activity metadata and timestamp.
      continue;
    }

    grouped.set(key, {
      id: row.id,
      operationId: row.operation_id,
      activityType: row.activity_type,
      exhibitionId: row.exhibition_id,
      customerId: row.customer_id,
      customerName: row.customer_name_snapshot ?? 'Unknown customer',
      itemCount,
      createdAt: row.created_at,
    });
  }

  return Array.from(grouped.values()).slice(0, limit);
}
