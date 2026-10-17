import { getDatabase } from '../../db';
import type {
  OrderRow,
  OrderStatusFilter,
  OrdersSummary,
} from './orders.types';

export interface OrdersFilters {
  search: string;
  customerId: string;
  exhibitionId: string;
  dateRange: 'all' | '30' | '90' | '365';
  status: OrderStatusFilter;
  sort: 'newest' | 'oldest' | 'value-high' | 'value-low';
}

export interface OrderFilterOptions {
  customers: { id: number; name: string }[];
  exhibitions: { id: number; name: string }[];
}

export async function getOrders(filters: OrdersFilters): Promise<OrderRow[]> {
  const db = await getDatabase();
  const search = `%${filters.search.trim()}%`;

  const dateCondition =
    filters.dateRange === 'all'
      ? ''
      : `AND co.created_at >= datetime('now', '-${Number(filters.dateRange)} days', 'localtime')`;

  const statusCondition = filters.status === 'All' ? '' : 'AND co.status = ?';

  const customerCondition =
    filters.customerId === 'all' ? '' : 'AND co.customer_id = ?';

  const exhibitionCondition =
    filters.exhibitionId === 'all'
      ? ''
      : filters.exhibitionId === 'direct'
        ? 'AND co.exhibition_id IS NULL'
        : 'AND co.exhibition_id = ?';

  const orderBy = {
    newest: 'co.created_at DESC, co.id DESC',
    oldest: 'co.created_at ASC, co.id ASC',
    'value-high': 'totalValuePaise DESC, co.id DESC',
    'value-low': 'totalValuePaise ASC, co.id ASC',
  }[filters.sort];

  const parameters: (string | number)[] = [search, search, search, search];

  if (filters.status !== 'All') parameters.push(filters.status);
  if (filters.customerId !== 'all') {
    parameters.push(Number(filters.customerId));
  }
  if (filters.exhibitionId !== 'all' && filters.exhibitionId !== 'direct') {
    parameters.push(Number(filters.exhibitionId));
  }

  return db.select<OrderRow[]>(
    `SELECT
       co.id,
       co.customer_name_snapshot AS customerName,
       (
         SELECT cc.name
         FROM customer_contact cc
         WHERE cc.customer_id = co.customer_id
           AND cc.is_primary = 1
         ORDER BY cc.id
         LIMIT 1
       ) AS contactName,
       c.city AS city,
       e.name AS exhibitionName,
       e.start_date AS exhibitionStartDate,
       (
         SELECT COUNT(*)
         FROM customer_order_item coi
         WHERE coi.order_id = co.id
       ) AS itemCount,
       co.created_at AS orderDate,
       COALESCE((
         SELECT SUM(coi.agreed_price_paise)
         FROM customer_order_item coi
         WHERE coi.order_id = co.id
       ), 0) AS totalValuePaise,
       co.status
     FROM customer_order co
     LEFT JOIN customer c ON c.id = co.customer_id
     LEFT JOIN exhibition e ON e.id = co.exhibition_id
     WHERE (
       co.customer_name_snapshot LIKE ?
       OR CAST(co.id AS TEXT) LIKE ?
       OR ('ORD-' || printf('%04d', co.id)) LIKE ?
       OR COALESCE(e.name, 'Direct order') LIKE ?
     )
     ${statusCondition}
     ${customerCondition}
     ${exhibitionCondition}
     ${dateCondition}
     ORDER BY ${orderBy}`,
    parameters,
  );
}

export async function getOrdersSummary(): Promise<OrdersSummary> {
  const db = await getDatabase();

  const rows = await db.select<
    {
      confirmedCount: number;
      confirmedValuePaise: number;
      exhibitionOrderCount: number;
      directOrderCount: number;
      provisionalItemCount: number;
      provisionalCustomerCount: number;
    }[]
  >(
    `SELECT
       (
         SELECT COUNT(*)
         FROM customer_order
         WHERE status = 'Confirmed'
       ) AS confirmedCount,
       (
         SELECT COALESCE(SUM(item_total), 0)
         FROM (
           SELECT
             co.id,
             SUM(coi.agreed_price_paise) AS item_total
           FROM customer_order co
           JOIN customer_order_item coi ON coi.order_id = co.id
           WHERE co.status = 'Confirmed'
           GROUP BY co.id
         )
       ) AS confirmedValuePaise,
       (
         SELECT COUNT(*)
         FROM customer_order
         WHERE status <> 'Cancelled'
           AND exhibition_id IS NOT NULL
       ) AS exhibitionOrderCount,
       (
         SELECT COUNT(*)
         FROM customer_order
         WHERE status <> 'Cancelled'
           AND exhibition_id IS NULL
       ) AS directOrderCount,
       (
         SELECT COUNT(*)
         FROM selection_item si
         WHERE si.status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM customer_order_item coi
             JOIN customer_order co ON co.id = coi.order_id
             WHERE coi.selection_item_id = si.id
               AND co.status <> 'Cancelled'
           )
       ) AS provisionalItemCount,
       (
         SELECT COUNT(DISTINCT s.customer_id)
         FROM selection_item si
         JOIN selection s ON s.id = si.selection_id
         WHERE si.status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM customer_order_item coi
             JOIN customer_order co ON co.id = coi.order_id
             WHERE coi.selection_item_id = si.id
               AND co.status <> 'Cancelled'
           )
       ) AS provisionalCustomerCount`,
  );

  return (
    rows[0] ?? {
      confirmedCount: 0,
      confirmedValuePaise: 0,
      exhibitionOrderCount: 0,
      directOrderCount: 0,
      provisionalItemCount: 0,
      provisionalCustomerCount: 0,
    }
  );
}

export async function getOrderFilterOptions(): Promise<OrderFilterOptions> {
  const db = await getDatabase();

  const [customers, exhibitions] = await Promise.all([
    db.select<{ id: number; name: string }[]>(
      `SELECT id, business_name AS name
       FROM customer
       WHERE is_archived = 0
       ORDER BY business_name COLLATE NOCASE`,
    ),
    db.select<{ id: number; name: string }[]>(
      `SELECT id, name
       FROM exhibition
       ORDER BY start_date DESC, name COLLATE NOCASE`,
    ),
  ]);

  return { customers, exhibitions };
}
