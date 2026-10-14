import { getDatabase } from '../../db';
import type {
  Customer,
  CustomerContact,
  CustomerFilters,
} from './customer.types';

export async function getCustomers(
  filters: CustomerFilters,
): Promise<Customer[]> {
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
          SELECT 1
          FROM customer_contact cc
          WHERE cc.customer_id = c.id
            AND (
              cc.name LIKE ?
              OR COALESCE(cc.phone_1, '') LIKE ?
              OR COALESCE(cc.phone_2, '') LIKE ?
            )
        )
      )
    `);

    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    );
  }

  if (filters.archiveStatus === 'active') {
    conditions.push('c.is_archived = 0');
  } else if (filters.archiveStatus === 'archived') {
    conditions.push('c.is_archived = 1');
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

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

      (
        SELECT cc.name
        FROM customer_contact cc
        WHERE cc.customer_id = c.id
          AND cc.is_primary = 1
        ORDER BY cc.id ASC
        LIMIT 1
      ) AS primaryContactName,

      (
        SELECT cc.phone_1
        FROM customer_contact cc
        WHERE cc.customer_id = c.id
          AND cc.is_primary = 1
        ORDER BY cc.id ASC
        LIMIT 1
      ) AS primaryContactPhone1,

      (
        SELECT cc.phone_2
        FROM customer_contact cc
        WHERE cc.customer_id = c.id
          AND cc.is_primary = 1
        ORDER BY cc.id ASC
        LIMIT 1
      ) AS primaryContactPhone2,

      (
        SELECT COUNT(*)
        FROM customer_contact cc
        WHERE cc.customer_id = c.id
      ) AS contactCount

    FROM customer c
    ${whereClause}
    ORDER BY c.business_name COLLATE NOCASE ASC
  `;

  return database.select<Customer[]>(sql, params);
}

export async function getCustomerContacts(
  customerId: number,
): Promise<CustomerContact[]> {
  const database = await getDatabase();

  return database.select<CustomerContact[]>(
    `
      SELECT
        id,
        customer_id AS customerId,
        name,
        phone_1 AS phone1,
        phone_2 AS phone2,
        is_primary AS isPrimary,
        notes
      FROM customer_contact
      WHERE customer_id = ?
      ORDER BY is_primary DESC, name COLLATE NOCASE ASC
    `,
    [customerId],
  );
}
