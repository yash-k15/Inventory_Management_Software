import { getDatabase } from '../../db';
import type {
  Customer,
  CustomerContact,
  CustomerFilters,
  CustomerOrderHistoryRow,
  CustomerPaymentHistoryRow,
  CustomerDetailsSummary,
  CustomerRecentPurchase,
} from './customer.types';

export async function getCustomers(filters: CustomerFilters): Promise<Customer[]> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  const search = filters.search.trim();

  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(`
      (
        c.business_name LIKE ?
        OR COALESCE(c.email, '') LIKE ?
        OR COALESCE(c.city, '') LIKE ?
        OR COALESCE(c.address, '') LIKE ?
        OR EXISTS (
          SELECT 1 FROM customer_contact cc
          WHERE cc.customer_id = c.id
            AND (
              cc.name LIKE ?
              OR COALESCE(cc.phone_1, '') LIKE ?
              OR COALESCE(cc.phone_2, '') LIKE ?
            )
        )
      )
    `);
    params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  if (filters.archiveStatus === 'active') conditions.push('c.is_archived = 0');
  else if (filters.archiveStatus === 'archived') conditions.push('c.is_archived = 1');

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      c.id,
      c.business_name AS businessName,
      c.notes,
      c.email,
      c.city,
      c.address,
      c.is_archived AS isArchived,
      c.created_at AS createdAt,
      c.updated_at AS updatedAt,
      (SELECT cc.name FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.is_primary = 1 ORDER BY cc.id ASC LIMIT 1) AS primaryContactName,
      (SELECT cc.phone_1 FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.is_primary = 1 ORDER BY cc.id ASC LIMIT 1) AS primaryContactPhone1,
      (SELECT cc.phone_2 FROM customer_contact cc WHERE cc.customer_id = c.id AND cc.is_primary = 1 ORDER BY cc.id ASC LIMIT 1) AS primaryContactPhone2,
      (SELECT COUNT(*) FROM customer_contact cc WHERE cc.customer_id = c.id) AS contactCount,
      (SELECT COUNT(*) FROM customer_order co WHERE co.customer_id = c.id AND co.status <> 'Cancelled') AS orderCount,
      (
        SELECT COALESCE(SUM(COALESCE(co.final_total_paise, order_items.item_total, 0)), 0)
        FROM customer_order co
        LEFT JOIN (
          SELECT order_id, SUM(agreed_price_paise) AS item_total
          FROM customer_order_item GROUP BY order_id
        ) order_items ON order_items.order_id = co.id
        WHERE co.customer_id = c.id AND co.status <> 'Cancelled'
      ) AS lifetimeValuePaise,
      (SELECT MAX(co.created_at) FROM customer_order co WHERE co.customer_id = c.id AND co.status <> 'Cancelled') AS lastPurchaseDate
    FROM customer c
    ${whereClause}
    ORDER BY c.business_name COLLATE NOCASE ASC
  `;
  return database.select<Customer[]>(sql, params);
}

export async function getCustomerContacts(customerId: number): Promise<CustomerContact[]> {
  const database = await getDatabase();
  return database.select<CustomerContact[]>(
    `SELECT id, customer_id AS customerId, name, phone_1 AS phone1, phone_2 AS phone2, is_primary AS isPrimary, notes
     FROM customer_contact WHERE customer_id = ?
     ORDER BY is_primary DESC, name COLLATE NOCASE ASC`,
    [customerId],
  );
}

export async function getCustomerDetailsSummary(customerId: number): Promise<CustomerDetailsSummary> {
  const database = await getDatabase();
  const rows = await database.select<CustomerDetailsSummary[]>(
    `
      SELECT
        COUNT(*) AS purchaseCount,
        COALESCE(SUM(order_totals.totalValuePaise), 0) AS lifetimeValuePaise,
        CASE WHEN COUNT(*) = 0 THEN 0
          ELSE CAST(COALESCE(SUM(order_totals.totalValuePaise), 0) / COUNT(*) AS INTEGER)
        END AS averageOrderValuePaise,
        MAX(order_totals.orderDate) AS lastPurchaseDate
      FROM (
        SELECT
          co.id,
          co.created_at AS orderDate,
          COALESCE(co.final_total_paise, SUM(coi.agreed_price_paise), 0) AS totalValuePaise
        FROM customer_order co
        LEFT JOIN customer_order_item coi ON coi.order_id = co.id
        WHERE co.customer_id = ? AND co.status <> 'Cancelled'
        GROUP BY co.id, co.final_total_paise
      ) AS order_totals
    `,
    [customerId],
  );
  return rows[0] ?? { purchaseCount: 0, lifetimeValuePaise: 0, averageOrderValuePaise: 0, lastPurchaseDate: null };
}

export async function getCustomerOrderHistory(customerId: number): Promise<CustomerOrderHistoryRow[]> {
  const database = await getDatabase();
  return database.select<CustomerOrderHistoryRow[]>(
    `
      SELECT
        co.id,
        co.created_at AS orderDate,
        co.status,
        e.name AS exhibitionName,
        COUNT(coi.id) AS itemCount,
        COALESCE(co.final_total_paise, SUM(coi.agreed_price_paise), 0) AS totalValuePaise
      FROM customer_order co
      LEFT JOIN exhibition e ON e.id = co.exhibition_id
      LEFT JOIN customer_order_item coi ON coi.order_id = co.id
      WHERE co.customer_id = ?
      GROUP BY co.id, co.final_total_paise
      ORDER BY co.created_at DESC, co.id DESC
    `,
    [customerId],
  );
}

export async function getCustomerPaymentHistory(customerId: number): Promise<CustomerPaymentHistoryRow[]> {
  const database = await getDatabase();
  return database.select<CustomerPaymentHistoryRow[]>(
    `
      SELECT p.id, p.payment_date AS paymentDate, e.name AS exhibitionName,
             p.amount_paise AS amountPaise, p.payment_method AS paymentMethod, p.notes
      FROM payment p JOIN exhibition e ON e.id = p.exhibition_id
      WHERE p.customer_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
    `,
    [customerId],
  );
}

export async function getCustomerRecentPurchases(customerId: number): Promise<CustomerRecentPurchase[]> {
  const database = await getDatabase();
  return database.select<CustomerRecentPurchase[]>(
    `
      SELECT
        coi.id AS orderItemId,
        COALESCE(json_extract(coi.item_snapshot, '$.item_number'), i.item_number, 'Unknown item') AS itemNumber,
        COALESCE(json_extract(coi.item_snapshot, '$.category'), '') AS itemName,
        coi.agreed_price_paise AS amountPaise,
        co.created_at AS orderDate
      FROM customer_order co
      JOIN customer_order_item coi ON coi.order_id = co.id
      LEFT JOIN selection_item si ON si.id = coi.selection_item_id
      LEFT JOIN item i ON i.id = si.inventory_item_id
      WHERE co.customer_id = ? AND co.status <> 'Cancelled'
      ORDER BY co.created_at DESC, co.id DESC, coi.id DESC
      LIMIT 3
    `,
    [customerId],
  );
}
