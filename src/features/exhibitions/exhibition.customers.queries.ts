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
  const rows = await db.select<(Omit<ExhibitionCustomerRow, 'itemNumbers'> & { itemNumbersRaw: string | null })[]>(
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
      )) AS itemNumbersRaw
     FROM customer c
     LEFT JOIN selection s ON s.customer_id=c.id AND s.exhibition_id=?
     WHERE c.is_archived=0
       AND (?='%%' OR c.business_name LIKE ?
         OR COALESCE((SELECT cc.name FROM customer_contact cc WHERE cc.customer_id=c.id AND cc.is_primary=1 ORDER BY cc.id LIMIT 1),'') LIKE ?
         OR COALESCE(${phoneFallback}, '') LIKE ?)
     ORDER BY c.business_name COLLATE NOCASE`,
    [exhibitionId, pattern, pattern, pattern, pattern],
  );
  return rows.map((row) => ({ ...row, itemNumbers: row.itemNumbersRaw ? row.itemNumbersRaw.split('|') : [] }));
}

export async function createExhibitionCustomer(input: { businessName: string; contactName: string; phone: string; city: string }): Promise<void> {
  const db = await getDatabase();
  const columns = await db.select<{ name: string }[]>('PRAGMA table_info(customer)');
  const hasCity = columns.some((column) => column.name === 'city');
  const hasPhone = columns.some((column) => column.name === 'phone');
  const result = await db.execute(
    `INSERT INTO customer (business_name${hasCity ? ', city' : ''}${hasPhone ? ', phone' : ''}) VALUES (?${hasCity ? ', ?' : ''}${hasPhone ? ', ?' : ''})`,
    [input.businessName.trim(), ...(hasCity ? [input.city.trim() || null] : []), ...(hasPhone ? [input.phone.trim() || null] : [])],
  );
  if (input.contactName.trim() || input.phone.trim()) {
    const contactColumns = await db.select<{ name: string }[]>('PRAGMA table_info(customer_contact)');
    const phoneColumn = contactColumns.some((column) => column.name === 'phone_1') ? 'phone_1' :
      contactColumns.some((column) => column.name === 'phone') ? 'phone' : null;
    await db.execute(
      `INSERT INTO customer_contact (customer_id, name${phoneColumn ? `, ${phoneColumn}` : ''}, is_primary) VALUES (?, ?${phoneColumn ? ', ?' : ''}, 1)`,
      [result.lastInsertId, input.contactName.trim() || input.businessName.trim(), ...(phoneColumn ? [input.phone.trim() || null] : [])],
    );
  }
}
