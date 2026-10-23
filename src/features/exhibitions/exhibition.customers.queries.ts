import { getDatabase } from '../../db';

export interface ExhibitionCustomerRow {
  id: number;
  businessName: string;
  city: string | null;
  contactName: string | null;
  phone: string | null;
  selectionId: number | null;
  activeItemCount: number;
  itemNumbers: string[];
  orderNumbers: string[];
  orderCreatedItemCount: number;
}

export async function getExhibitionCustomers(exhibitionId: number, search: string): Promise<ExhibitionCustomerRow[]> {
  const db = await getDatabase();
  const columns = await db.select<{ name: string }[]>('PRAGMA table_info(customer)');
  const hasCity = columns.some((column) => column.name === 'city');
  const hasCustomerPhone = columns.some((column) => column.name === 'phone');
  const contactColumns = await db.select<{ name: string }[]>('PRAGMA table_info(customer_contact)');
  const contactPhoneColumns = ['phone_1', 'phone_2', 'phone'].filter((name) => contactColumns.some((column) => column.name === name));
  const primaryPhone = contactPhoneColumns.length ? contactPhoneColumns.map((name) => `(SELECT cc.${name} FROM customer_contact cc WHERE cc.customer_id=c.id AND cc.is_primary=1 ORDER BY cc.id LIMIT 1)`).join(', ') : 'NULL';
  const phoneFallback = `${primaryPhone}${hasCustomerPhone ? ', c.phone' : ''}`;
  const pattern = `%${search.trim()}%`;
  const rows = await db.select<(Omit<ExhibitionCustomerRow, 'itemNumbers' | 'orderNumbers'> & { itemNumbersRaw: string | null; orderNumbersRaw: string | null })[]>(
    `SELECT c.id, c.business_name AS businessName,
      ${hasCity ? 'c.city' : 'NULL'} AS city,
      (SELECT cc.name FROM customer_contact cc WHERE cc.customer_id=c.id AND cc.is_primary=1 ORDER BY cc.id LIMIT 1) AS contactName,
      COALESCE(${phoneFallback}) AS phone,
      s.id AS selectionId,
      (SELECT COUNT(*) FROM selection_item si WHERE si.selection_id=s.id AND si.status='active') AS activeItemCount,
      (SELECT GROUP_CONCAT(item_number, '|') FROM (
        SELECT json_extract(si.snapshot_data, '$.item_number') AS item_number
        FROM selection_item si WHERE si.selection_id=s.id AND si.status='active'
        ORDER BY si.added_at DESC, si.id DESC LIMIT 3
      )) AS itemNumbersRaw,
      (SELECT GROUP_CONCAT(orderNumber, '|') FROM (
        SELECT 'ORD-' || printf('%04d', co.id) AS orderNumber
        FROM customer_order co
        WHERE co.customer_id=c.id
          AND co.status <> 'Cancelled'
          AND (
            co.exhibition_id=?
            OR EXISTS (
              SELECT 1
              FROM customer_order_item linked_coi
              JOIN selection_item linked_si ON linked_si.id=linked_coi.selection_item_id
              JOIN selection linked_s ON linked_s.id=linked_si.selection_id
              WHERE linked_coi.order_id=co.id
                AND linked_s.customer_id=co.customer_id
                AND linked_s.exhibition_id=?
            )
          )
        ORDER BY co.created_at DESC, co.id DESC
      )) AS orderNumbersRaw,
      (SELECT COUNT(DISTINCT linked_si.id)
       FROM customer_order_item linked_coi
       JOIN customer_order linked_co ON linked_co.id=linked_coi.order_id
       JOIN selection_item linked_si ON linked_si.id=linked_coi.selection_item_id
       JOIN selection linked_s ON linked_s.id=linked_si.selection_id
       WHERE linked_co.customer_id=c.id
         AND linked_co.status <> 'Cancelled'
         AND linked_s.customer_id=c.id
         AND linked_s.exhibition_id=?
      ) AS orderCreatedItemCount
     FROM customer c
     JOIN selection s ON s.customer_id=c.id AND s.exhibition_id=?
     WHERE c.is_archived=0
       AND (?='%%' OR c.business_name LIKE ?
         OR COALESCE((SELECT cc.name FROM customer_contact cc WHERE cc.customer_id=c.id AND cc.is_primary=1 ORDER BY cc.id LIMIT 1),'') LIKE ?
         OR COALESCE(${phoneFallback}, '') LIKE ?)
     ORDER BY c.business_name COLLATE NOCASE`,
    [exhibitionId, exhibitionId, exhibitionId, exhibitionId, pattern, pattern, pattern, pattern],
  );
  return rows.map((row) => ({
    ...row,
    itemNumbers: row.itemNumbersRaw ? row.itemNumbersRaw.split('|') : [],
    orderNumbers: row.orderNumbersRaw ? row.orderNumbersRaw.split('|') : [],
  }));
}

export async function createExhibitionCustomer(input: { businessName: string; contactName: string; phone: string; city: string }): Promise<number> {
  const db = await getDatabase();
  const columns = await db.select<{ name: string }[]>('PRAGMA table_info(customer)');
  const hasCity = columns.some((column) => column.name === 'city');
  const hasPhone = columns.some((column) => column.name === 'phone');
  const result = await db.execute(
    `INSERT INTO customer (business_name${hasCity ? ', city' : ''}${hasPhone ? ', phone' : ''}) VALUES (?${hasCity ? ', ?' : ''}${hasPhone ? ', ?' : ''})`,
    [input.businessName.trim(), ...(hasCity ? [input.city.trim() || null] : []), ...(hasPhone ? [input.phone.trim() || null] : [])],
  );
  const lastInsertId = result.lastInsertId;
  if (typeof lastInsertId !== 'number' || !Number.isInteger(lastInsertId) || lastInsertId <= 0) {
    throw new Error('Unable to retrieve the new customer ID.');
  }
  const customerId: number = lastInsertId;
  if (input.contactName.trim() || input.phone.trim()) {
    const contactColumns = await db.select<{ name: string }[]>('PRAGMA table_info(customer_contact)');
    const phoneColumn = contactColumns.some((column) => column.name === 'phone_1') ? 'phone_1' :
      contactColumns.some((column) => column.name === 'phone') ? 'phone' : null;
    await db.execute(
      `INSERT INTO customer_contact (customer_id, name${phoneColumn ? `, ${phoneColumn}` : ''}, is_primary) VALUES (?, ?${phoneColumn ? ', ?' : ''}, 1)`,
      [customerId, input.contactName.trim() || input.businessName.trim(), ...(phoneColumn ? [input.phone.trim() || null] : [])],
    );
  }
  return customerId;
}

export interface DuplicateCustomerMatch {
  id: number;
  businessName: string;
  phones: string[];
}

export async function findDuplicateExhibitionCustomer(input: {
  businessName: string;
  phone: string;
}): Promise<DuplicateCustomerMatch | null> {
  const db = await getDatabase();
  const customerColumns = await db.select<{ name: string }[]>('PRAGMA table_info(customer)');
  const hasCustomerPhone = customerColumns.some((column) => column.name === 'phone');
  const customerPhoneSelect = hasCustomerPhone ? 'c.phone AS customerPhone' : 'NULL AS customerPhone';
  const customers = await db.select<{ id: number; businessName: string; customerPhone: string | null }[]>(
    `SELECT c.id, c.business_name AS businessName, ${customerPhoneSelect}
     FROM customer c
     ORDER BY c.id`,
  );
  const contactColumns = await db.select<{ name: string }[]>('PRAGMA table_info(customer_contact)');
  const phoneColumns = ['phone_1', 'phone_2', 'phone'].filter((name) =>
    contactColumns.some((column) => column.name === name),
  );
  const contacts = phoneColumns.length
    ? await db.select<{ customerId: number; phone: string | null }[]>(
        `SELECT cc.customer_id AS customerId, ${phoneColumns.map((column) => `cc.${column}`).join(', ')}
         FROM customer_contact cc`,
      ).then((rows) => rows.map((row) => ({
        customerId: row.customerId,
        phones: phoneColumns.map((column) => (row as unknown as Record<string, string | null>)[column]).filter((value): value is string => Boolean(value?.trim())),
      })))
    : [];
  const normalizePhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  };
  const targetName = input.businessName.trim().toLocaleLowerCase();
  const targetPhone = normalizePhone(input.phone);
  for (const customer of customers) {
    const customerPhones = [
      ...(customer.customerPhone ? [customer.customerPhone] : []),
      ...contacts.filter((contact) => contact.customerId === customer.id).flatMap((contact) => contact.phones),
    ];
    const nameMatches = customer.businessName.trim().toLocaleLowerCase() === targetName;
    const phoneMatches = targetPhone.length > 0 && customerPhones.some((value) => normalizePhone(value) === targetPhone);
    if (nameMatches || phoneMatches) {
      return { id: customer.id, businessName: customer.businessName, phones: customerPhones };
    }
  }
  return null;
}
