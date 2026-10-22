import { getDatabase } from '../../db';
import type {
  OrderRow,
  OrderStatus,
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
       COALESCE(
         co.final_total_paise,
         (
           SELECT SUM(coi.agreed_price_paise)
           FROM customer_order_item coi
           WHERE coi.order_id = co.id
         ),
         0
       ) AS totalValuePaise,
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
         SELECT COALESCE(SUM(order_total), 0)
         FROM (
           SELECT
             co.id,
             COALESCE(co.final_total_paise, SUM(coi.agreed_price_paise), 0) AS order_total
           FROM customer_order co
           LEFT JOIN customer_order_item coi ON coi.order_id = co.id
           WHERE co.status = 'Confirmed'
           GROUP BY co.id, co.final_total_paise
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

export interface OrderDetailItem {
  id: number;
  itemNumber: string;
  category: string;
  grossWeightMilli: number | null;
  details: string;
  agreedPricePaise: number;
}

export interface OrderDetails {
  id: number;
  customerName: string;
  customerId: number | null;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  exhibitionId: number | null;
  exhibitionName: string | null;
  exhibitionStartDate: string | null;
  exhibitionEndDate: string | null;
  status: OrderStatus;
  createdAt: string;
  confirmedAt: string | null;
  notes: string | null;
  items: OrderDetailItem[];
  totalValuePaise: number;
}

export async function getOrderDetails(orderId: number): Promise<OrderDetails | null> {
  const db = await getDatabase();
  const headers = await db.select<{
    id: number; customerName: string; customerId: number | null;
    contactName: string | null; phone: string | null; city: string | null;
    exhibitionId: number | null; exhibitionName: string | null;
    exhibitionStartDate: string | null; exhibitionEndDate: string | null;
    status: OrderStatus; createdAt: string; confirmedAt: string | null;
    notes: string | null; finalTotalPaise: number | null;
  }[]>(`
    SELECT
      co.id,
      co.customer_name_snapshot AS customerName,
      co.customer_id AS customerId,
      (SELECT cc.name FROM customer_contact cc WHERE cc.customer_id = co.customer_id AND cc.is_primary = 1 ORDER BY cc.id LIMIT 1) AS contactName,
      (SELECT cc.phone_1 FROM customer_contact cc WHERE cc.customer_id = co.customer_id AND cc.is_primary = 1 ORDER BY cc.id LIMIT 1) AS phone,
      c.city AS city,
      co.exhibition_id AS exhibitionId,
      e.name AS exhibitionName,
      e.start_date AS exhibitionStartDate,
      e.end_date AS exhibitionEndDate,
      co.status,
      co.created_at AS createdAt,
      co.final_total_paise AS finalTotalPaise,
      (SELECT osh.changed_at FROM order_status_history osh WHERE osh.order_id = co.id AND osh.status = 'Confirmed' ORDER BY osh.changed_at LIMIT 1) AS confirmedAt,
      (SELECT osh.notes FROM order_status_history osh WHERE osh.order_id = co.id AND osh.notes IS NOT NULL AND trim(osh.notes) <> '' ORDER BY osh.changed_at DESC, osh.id DESC LIMIT 1) AS notes
    FROM customer_order co
    LEFT JOIN customer c ON c.id = co.customer_id
    LEFT JOIN exhibition e ON e.id = co.exhibition_id
    WHERE co.id = ?
  `, [orderId]);
  if (!headers.length) return null;
  const header = headers[0];
  const rows = await db.select<{ id: number; itemSnapshot: string; agreedPricePaise: number }[]>(`
    SELECT id, item_snapshot AS itemSnapshot, agreed_price_paise AS agreedPricePaise
    FROM customer_order_item WHERE order_id = ? ORDER BY id
  `, [orderId]);
  const items: OrderDetailItem[] = rows.map((row) => {
    let snapshot: Record<string, any> = {};
    try { snapshot = JSON.parse(row.itemSnapshot || '{}'); } catch { snapshot = {}; }
    const diamonds = Array.isArray(snapshot.diamonds) ? snapshot.diamonds : [];
    const stones = Array.isArray(snapshot.stones) ? snapshot.stones : [];
    const detailParts = [
      ...diamonds.map((d: any) => `${d.shape || 'Diamond'} · ${((Number(d.weightMilli) || 0) / 1000).toFixed(3)} ct`),
      ...stones.map((s: any) => `${s.stone || 'Stone'} · ${((Number(s.weightMilli) || 0) / 1000).toFixed(3)} ct`),
    ];
    return {
      id: row.id,
      itemNumber: String(snapshot.item_number || '—'),
      category: String(snapshot.category || '—'),
      grossWeightMilli: snapshot.gross_weight_milli == null ? null : Number(snapshot.gross_weight_milli),
      details: detailParts.join(', ') || '—',
      agreedPricePaise: row.agreedPricePaise,
    };
  });
  return {
    ...header,
    items,
    totalValuePaise:
      header.finalTotalPaise ??
      items.reduce((sum, item) => sum + item.agreedPricePaise, 0),
  };
}
