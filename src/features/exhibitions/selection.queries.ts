import { getDatabase } from '../../db';
import { logActivity } from '../../db/activityLog';

export interface SelectionCustomer {
  id: number;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  selectionId: number | null;
  activeItemCount: number;
}

export interface SelectionDetail {
  label: string;
  pieces: number | null;
  weight_milli: number | null;
}

export interface SelectionRow {
  id: number;
  inventoryItemId: number | null;
  itemNumber: string;
  categoryName: string;
  name: string | null;
  imagePath: string | null;
  grossWeightMilli: number | null;
  netWeightMilli: number | null;
  purityName: string | null;
  diamonds: SelectionDetail[];
  stones: SelectionDetail[];
  status: 'active' | 'removed';
  addedAt: string;
  locked: number;
}

export interface SelectionCandidate {
  id: number;
  itemNumber: string;
  categoryName: string;
  name: string | null;
  imagePath: string | null;
  grossWeightMilli: number | null;
  purityName: string | null;
}

export async function getSelectionCustomers(
  exhibitionId: number,
  search: string,
) {
  const db = await getDatabase();
  const pattern = `%${search.trim()}%`;

  return db.select<SelectionCustomer[]>(
    `SELECT
       c.id,
       c.business_name AS businessName,
       (
         SELECT cc.name
         FROM customer_contact cc
         WHERE cc.customer_id = c.id AND cc.is_primary = 1
         ORDER BY cc.id
         LIMIT 1
       ) AS contactName,
       (
         SELECT cc.phone_1
         FROM customer_contact cc
         WHERE cc.customer_id = c.id AND cc.is_primary = 1
         ORDER BY cc.id
         LIMIT 1
       ) AS phone,
       s.id AS selectionId,
       (
         SELECT COUNT(*)
         FROM selection_item si
         WHERE si.selection_id = s.id AND si.status = 'active'
       ) AS activeItemCount
     FROM customer c
     JOIN selection s
       ON s.customer_id = c.id AND s.exhibition_id = ?
     WHERE c.is_archived = 0
       AND (
         ? = '%%'
         OR c.business_name LIKE ?
         OR COALESCE((
           SELECT cc.name
           FROM customer_contact cc
           WHERE cc.customer_id = c.id AND cc.is_primary = 1
           LIMIT 1
         ), '') LIKE ?
         OR COALESCE((
           SELECT cc.phone_1
           FROM customer_contact cc
           WHERE cc.customer_id = c.id AND cc.is_primary = 1
           LIMIT 1
         ), '') LIKE ?
       )
     ORDER BY c.business_name COLLATE NOCASE`,
    [exhibitionId, pattern, pattern, pattern, pattern],
  );
}


export interface AvailableSelectionCustomer {
  id: number;
  businessName: string;
  contactName: string | null;
  phone: string | null;
}

export async function searchAvailableSelectionCustomers(
  exhibitionId: number,
  search: string,
) {
  const db = await getDatabase();
  const term = search.trim();
  const pattern = `%${term}%`;
  return db.select<AvailableSelectionCustomer[]>(
    `SELECT c.id,
       c.business_name AS businessName,
       (SELECT cc.name FROM customer_contact cc
        WHERE cc.customer_id = c.id AND cc.is_primary = 1
        ORDER BY cc.id LIMIT 1) AS contactName,
       (SELECT cc.phone_1 FROM customer_contact cc
        WHERE cc.customer_id = c.id AND cc.is_primary = 1
        ORDER BY cc.id LIMIT 1) AS phone
     FROM customer c
     WHERE c.is_archived = 0
       AND NOT EXISTS (
         SELECT 1 FROM selection s
         WHERE s.customer_id = c.id AND s.exhibition_id = ?
       )
       AND (? = '' OR c.business_name LIKE ?
         OR COALESCE((SELECT cc.name FROM customer_contact cc
           WHERE cc.customer_id = c.id AND cc.is_primary = 1 LIMIT 1), '') LIKE ?
         OR COALESCE((SELECT cc.phone_1 FROM customer_contact cc
           WHERE cc.customer_id = c.id AND cc.is_primary = 1 LIMIT 1), '') LIKE ?)
     ORDER BY c.business_name COLLATE NOCASE
     LIMIT 100`,
    [exhibitionId, term, pattern, pattern, pattern],
  );
}

export async function addCustomerToSelectionExhibition(
  exhibitionId: number,
  customerId: number,
) {
  const db = await getDatabase();
  const exists = await db.select<{ id: number }[]>(
    `SELECT id FROM customer WHERE id = ? AND is_archived = 0`,
    [customerId],
  );
  if (!exists.length) throw new Error('Customer not found or archived.');
  await db.execute(
    `INSERT OR IGNORE INTO selection(customer_id, exhibition_id) VALUES(?, ?)`,
    [customerId, exhibitionId],
  );
}

export async function getSelectionItems(selectionId: number) {
  const db = await getDatabase();

  const rows = await db.select<(Omit<SelectionRow, 'diamonds' | 'stones'> & {
    diamondsJson: string | null;
    stonesJson: string | null;
    netWeightMilli: number | null;
  })[]>(
    `SELECT
       si.id,
       si.inventory_item_id AS inventoryItemId,
       COALESCE(json_extract(si.snapshot_data, '$.item_number'), 'Deleted item') AS itemNumber,
       COALESCE(json_extract(si.snapshot_data, '$.category'), '—') AS categoryName,
       json_extract(si.snapshot_data, '$.name') AS name,
       json_extract(si.snapshot_data, '$.image_path') AS imagePath,
       json_extract(si.snapshot_data, '$.gross_weight_milli') AS grossWeightMilli,
       COALESCE(
         json_extract(si.snapshot_data, '$.net_weight_milli'),
         (SELECT i.net_weight_milli FROM item i WHERE i.id = si.inventory_item_id)
       ) AS netWeightMilli,
       json_extract(si.snapshot_data, '$.purity') AS purityName,
       COALESCE(
         json_extract(si.snapshot_data, '$.diamonds'),
         (SELECT json_group_array(json_object(
           'label', COALESCE(ds.code, ds.name),
           'pieces', d.pieces,
           'weight_milli', d.weight_milli
         ))
         FROM item_diamond d
         JOIN diamond_shape ds ON ds.id = d.shape_id
         WHERE d.item_id = si.inventory_item_id)
       ) AS diamondsJson,
       COALESCE(
         json_extract(si.snapshot_data, '$.stones'),
         (SELECT json_group_array(json_object(
           'label', COALESCE(st.tag_label, st.name),
           'pieces', s.pieces,
           'weight_milli', s.weight_milli
         ))
         FROM item_stone s
         JOIN stone_type st ON st.id = s.stone_type_id
         WHERE s.item_id = si.inventory_item_id)
       ) AS stonesJson,
       si.status,
       si.added_at AS addedAt,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM customer_order_item coi
           JOIN customer_order co ON co.id = coi.order_id
           WHERE co.status <> 'Cancelled'
             AND co.customer_id = (SELECT customer_id FROM selection WHERE id = si.selection_id)
             AND co.exhibition_id = (SELECT exhibition_id FROM selection WHERE id = si.selection_id)
             AND (
               coi.selection_item_id = si.id
               OR (coi.selection_item_id IS NULL AND CAST(json_extract(coi.item_snapshot, '$.inventory_item_id') AS INTEGER) = si.inventory_item_id)
             )
         ) THEN 1
         ELSE 0
       END AS locked
     FROM selection_item si
     WHERE si.selection_id = ?
     ORDER BY
       CASE si.status WHEN 'active' THEN 0 ELSE 1 END,
       si.added_at DESC,
       si.id DESC`,
    [selectionId],
  );

  return rows.map((row) => {
    const parseDetails = (value: string | null): SelectionDetail[] => {
      if (!value) return [];
      try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((detail: any) => ({
          label: String(detail.label ?? detail.shape ?? detail.stone ?? '—'),
          pieces: detail.pieces == null ? null : Number(detail.pieces),
          weight_milli:
            detail.weight_milli == null ? null : Number(detail.weight_milli),
        }));
      } catch {
        return [];
      }
    };

    const { diamondsJson, stonesJson, ...rest } = row;
    return {
      ...rest,
      diamonds: parseDetails(diamondsJson),
      stones: parseDetails(stonesJson),
    };
  });
}

export async function searchSelectionInventory(
  exhibitionId: number,
  search: string,
) {
  const db = await getDatabase();
  const term = search.trim();
  const pattern = `%${term}%`;

  return db.select<SelectionCandidate[]>(
    `SELECT
       i.id,
       i.item_number AS itemNumber,
       c.name AS categoryName,
       i.name,
       i.image_path AS imagePath,
       i.gross_weight_milli AS grossWeightMilli,
       p.name AS purityName
     FROM exhibition_item ei
     JOIN item i ON i.id = ei.item_id
     JOIN category c ON c.id = i.category_id
     LEFT JOIN purity p ON p.id = i.purity_id
     WHERE ei.exhibition_id = ?
       AND (
         ? = ''
         OR i.item_number LIKE ?
         OR COALESCE(i.name, '') LIKE ?
         OR c.name LIKE ?
         OR COALESCE(i.notes, '') LIKE ?
       )
     ORDER BY i.item_number COLLATE NOCASE
     LIMIT 100`,
    [exhibitionId, term, pattern, pattern, pattern, pattern],
  );
}

export async function addSelectionItem(
  exhibitionId: number,
  customerId: number,
  itemId: number,
  operationId?: string,
): Promise<boolean> {
  const db = await getDatabase();

  const rows = await db.select<any[]>(
    `SELECT
       i.id,
       i.item_number AS itemNumber,
       c.name AS categoryName,
       i.name,
       i.image_path AS imagePath,
       i.gross_weight_milli AS grossWeightMilli,
       i.net_weight_milli AS netWeightMilli,
       p.name AS purityName,
       i.igi_certificate_number AS igiCertificateNumber,
       i.huid,
       i.custom_values AS customValues
     FROM exhibition_item ei
     JOIN item i ON i.id = ei.item_id
     JOIN category c ON c.id = i.category_id
     LEFT JOIN purity p ON p.id = i.purity_id
     WHERE ei.exhibition_id = ? AND i.id = ?`,
    [exhibitionId, itemId],
  );

  const item = rows[0];

  if (!item) {
    throw new Error(
      'This item is not registered to this exhibition. Register it in the Inventory tab first.',
    );
  }

  await db.execute(
    `INSERT OR IGNORE INTO selection(customer_id, exhibition_id)
     VALUES(?, ?)`,
    [customerId, exhibitionId],
  );

  const selections = await db.select<{ id: number }[]>(
    `SELECT id
     FROM selection
     WHERE customer_id = ? AND exhibition_id = ?`,
    [customerId, exhibitionId],
  );

  const selectionId = selections[0]?.id;

  if (!selectionId) {
    throw new Error('Unable to open this customer selection.');
  }

  const duplicate = await db.select<{ id: number }[]>(
    `SELECT id
     FROM selection_item
     WHERE selection_id = ?
       AND inventory_item_id = ?
       AND status = 'active'`,
    [selectionId, itemId],
  );

  if (duplicate.length) {
    return false;
  }

  const diamonds = await db.select<any[]>(
    `SELECT
       COALESCE(ds.code, ds.name) AS label,
       d.pieces,
       d.weight_milli AS weight_milli
     FROM item_diamond d
     JOIN diamond_shape ds ON ds.id = d.shape_id
     WHERE d.item_id = ?
     ORDER BY ds.sort_order, ds.name`,
    [itemId],
  );

  const stones = await db.select<any[]>(
    `SELECT
       COALESCE(st.tag_label, st.name) AS label,
       s.pieces,
       s.weight_milli AS weight_milli
     FROM item_stone s
     JOIN stone_type st ON st.id = s.stone_type_id
     WHERE s.item_id = ?
     ORDER BY st.sort_order, st.name`,
    [itemId],
  );

  let customValues = {};
  try {
    customValues = JSON.parse(item.customValues || '{}');
  } catch {
    // Keep an empty object if stored custom values are invalid JSON.
  }

  const snapshot = {
    item_number: item.itemNumber,
    category: item.categoryName,
    name: item.name,
    gross_weight_milli: item.grossWeightMilli,
    net_weight_milli: item.netWeightMilli,
    purity: item.purityName,
    diamonds,
    stones,
    is_certified: Boolean(
      item.igiCertificateNumber && String(item.igiCertificateNumber).trim(),
    ),
    igi_certificate_number: item.igiCertificateNumber,
    huid: item.huid,
    image_path: item.imagePath,
    custom_values: customValues,
  };

  await db.execute(
    `INSERT INTO selection_item(
       selection_id,
       inventory_item_id,
       snapshot_data,
       overrides
     )
     VALUES(?, ?, ?, '{}')`,
    [selectionId, itemId, JSON.stringify(snapshot)],
  );

  const customers = await db.select<{ businessName: string }[]>(
    `SELECT business_name AS businessName
     FROM customer
     WHERE id = ?`,
    [customerId],
  );

  await logActivity({
    activityType: 'selection_items_added',
    exhibitionId,
    customerId,
    customerName: customers[0]?.businessName ?? null,
    summary: `Added ${item.itemNumber} to ${customers[0]?.businessName ?? 'customer'}'s selection`,
    itemNumbers: [item.itemNumber],
    operationId,
  });

  return true;
}

export async function removeSelectionItem(selectionItemId: number) {
  const db = await getDatabase();

  const rows = await db.select<
    {
      status: string;
      locked: number;
      exhibitionId: number;
      customerId: number;
      customerName: string;
      itemNumber: string;
    }[]
  >(
    `SELECT
       si.status,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM customer_order_item coi
           JOIN customer_order co ON co.id = coi.order_id
           WHERE co.status <> 'Cancelled'
             AND co.customer_id = (SELECT customer_id FROM selection WHERE id = si.selection_id)
             AND co.exhibition_id = (SELECT exhibition_id FROM selection WHERE id = si.selection_id)
             AND (
               coi.selection_item_id = si.id
               OR (coi.selection_item_id IS NULL AND CAST(json_extract(coi.item_snapshot, '$.inventory_item_id') AS INTEGER) = si.inventory_item_id)
             )
         ) THEN 1
         ELSE 0
       END AS locked,
       s.exhibition_id AS exhibitionId,
       s.customer_id AS customerId,
       c.business_name AS customerName,
       COALESCE(
         json_extract(si.snapshot_data, '$.item_number'),
         'Deleted item'
       ) AS itemNumber
     FROM selection_item si
     JOIN selection s ON s.id = si.selection_id
     JOIN customer c ON c.id = s.customer_id
     WHERE si.id = ?`,
    [selectionItemId],
  );

  const row = rows[0];

  if (!row) {
    throw new Error('This selection item no longer exists.');
  }

  if (row.status !== 'active') {
    throw new Error('Only active selection items can be removed.');
  }

  if (row.locked) {
    throw new Error('This item already has an order and is locked.');
  }

  const result = await db.execute(
    `UPDATE selection_item
     SET status = 'removed',
         removed_at = datetime('now', 'localtime'),
         updated_at = datetime('now', 'localtime')
     WHERE id = ? AND status = 'active'`,
    [selectionItemId],
  );

  if (result.rowsAffected > 0) {
    await logActivity({
      activityType: 'selection_items_removed',
      exhibitionId: row.exhibitionId,
      customerId: row.customerId,
      customerName: row.customerName,
      summary: `Removed ${row.itemNumber} from ${row.customerName}'s selection`,
      itemNumbers: [row.itemNumber],
    });
  }
}


export interface SelectionOrderSummary {
  id: number;
  orderNumber: string;
  status: string;
  createdAt: string;
  itemCount: number;
  totalPaise: number;
}

export async function getSelectionOrders(
  exhibitionId: number,
  customerId: number,
): Promise<SelectionOrderSummary[]> {
  const db = await getDatabase();
  return db.select<SelectionOrderSummary[]>(`
    SELECT
      co.id,
      'ORD-' || printf('%04d', co.id) AS orderNumber,
      co.status,
      co.created_at AS createdAt,
      COUNT(coi.id) AS itemCount,
      COALESCE(SUM(coi.agreed_price_paise), 0) AS totalPaise
    FROM customer_order co
    LEFT JOIN customer_order_item coi ON coi.order_id = co.id
    WHERE co.customer_id = ?
      AND (
        co.exhibition_id = ?
        OR EXISTS (
          SELECT 1
          FROM customer_order_item linked_coi
          JOIN selection_item linked_si ON linked_si.id = linked_coi.selection_item_id
          JOIN selection linked_s ON linked_s.id = linked_si.selection_id
          WHERE linked_coi.order_id = co.id
            AND linked_s.customer_id = co.customer_id
            AND linked_s.exhibition_id = ?
        )
      )
    GROUP BY co.id
    ORDER BY co.created_at DESC, co.id DESC
  `, [customerId, exhibitionId, exhibitionId]);
}
