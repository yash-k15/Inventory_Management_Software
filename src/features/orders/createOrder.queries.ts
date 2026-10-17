import { invoke } from '@tauri-apps/api/core';
import { getDatabase } from '../../db';

export interface CreateOrderCustomer {
  id: number;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  city: string | null;
}

export interface CreateOrderExhibition {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

export interface CreateOrderInventoryItem {
  id: number;
  itemNumber: string;
  categoryName: string;
  name: string | null;
  grossWeightMilli: number | null;
  diamondDetails: string;
  isArchived: number;
  existingOrderNumber: string | null;
}

export interface NewOrderItem {
  inventoryItemId: number;
  agreedPricePaise: number;
}

export async function getCreateOrderCustomers(): Promise<
  CreateOrderCustomer[]
> {
  const db = await getDatabase();

  return db.select<CreateOrderCustomer[]>(`
    SELECT
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
      c.city
    FROM customer c
    WHERE c.is_archived = 0
    ORDER BY c.business_name COLLATE NOCASE
  `);
}

export async function getCreateOrderExhibitions(): Promise<
  CreateOrderExhibition[]
> {
  const db = await getDatabase();

  return db.select<CreateOrderExhibition[]>(`
    SELECT
      id,
      name,
      start_date AS startDate,
      end_date AS endDate
    FROM exhibition
    ORDER BY start_date DESC, name COLLATE NOCASE
  `);
}

export async function searchCreateOrderInventory(
  search: string,
): Promise<CreateOrderInventoryItem[]> {
  const db = await getDatabase();
  const term = `%${search.trim()}%`;

  return db.select<CreateOrderInventoryItem[]>(
    `
      SELECT
        i.id,
        i.item_number AS itemNumber,
        c.name AS categoryName,
        i.name,
        i.gross_weight_milli AS grossWeightMilli,
        COALESCE((
          SELECT group_concat(
            ds.name || ' · ' || printf('%.3f', d.weight_milli / 1000.0) || ' ct',
            ', '
          )
          FROM item_diamond d
          JOIN diamond_shape ds ON ds.id = d.shape_id
          WHERE d.item_id = i.id
        ), '') AS diamondDetails,
        i.is_archived AS isArchived,
        (
          SELECT 'ORD-' || printf('%04d', co.id)
          FROM customer_order_item coi
          JOIN customer_order co ON co.id = coi.order_id
          WHERE co.status <> 'Cancelled'
            AND (
              coi.selection_item_id IN (
                SELECT si.id
                FROM selection_item si
                WHERE si.inventory_item_id = i.id
              )
              OR CAST(json_extract(coi.item_snapshot, '$.inventory_item_id') AS INTEGER) = i.id
            )
          ORDER BY co.id DESC
          LIMIT 1
        ) AS existingOrderNumber
      FROM item i
      JOIN category c ON c.id = i.category_id
      WHERE
        i.item_number LIKE ?
        OR COALESCE(i.name, '') LIKE ?
        OR c.name LIKE ?
      ORDER BY i.item_number COLLATE NOCASE
      LIMIT 100
    `,
    [term, term, term],
  );
}

export async function createConfirmedOrder(input: {
  customerId: number;
  exhibitionId: number | null;
  notes: string;
  items: NewOrderItem[];
}): Promise<number> {
  if (!input.customerId) {
    throw new Error('Select a customer.');
  }

  if (input.items.length === 0) {
    throw new Error('Add at least one jewelry item.');
  }

  if (
    input.items.some(
      (item) =>
        !Number.isSafeInteger(item.agreedPricePaise) ||
        item.agreedPricePaise < 0,
    )
  ) {
    throw new Error('Enter a valid price for every item.');
  }

  const db = await getDatabase();

  const customers = await db.select<{ id: number; businessName: string }[]>(
    `SELECT id, business_name AS businessName
     FROM customer
     WHERE id = ? AND is_archived = 0`,
    [input.customerId],
  );

  const customer = customers[0];

  if (!customer) {
    throw new Error('This customer is unavailable or archived.');
  }

  const uniqueItemIds = new Set(
    input.items.map((item) => item.inventoryItemId),
  );

  if (uniqueItemIds.size !== input.items.length) {
    throw new Error('An item can only be added once to an order.');
  }

  if (input.exhibitionId !== null) {
    const exhibitions = await db.select<{ id: number }[]>(
      `SELECT id FROM exhibition WHERE id = ?`,
      [input.exhibitionId],
    );

    if (!exhibitions.length) {
      throw new Error('The selected exhibition no longer exists.');
    }
  }

  const placeholders = input.items.map(() => '?').join(', ');

  const currentItems = await db.select<
    {
      id: number;
      itemNumber: string;
      categoryName: string;
      name: string | null;
      grossWeightMilli: number | null;
      purityName: string | null;
      igiCertificateNumber: string | null;
      huid: string | null;
      imagePath: string | null;
      customValues: string;
    }[]
  >(
    `
      SELECT
        i.id,
        i.item_number AS itemNumber,
        c.name AS categoryName,
        i.name,
        i.gross_weight_milli AS grossWeightMilli,
        p.name AS purityName,
        i.igi_certificate_number AS igiCertificateNumber,
        i.huid,
        i.image_path AS imagePath,
        i.custom_values AS customValues
      FROM item i
      JOIN category c ON c.id = i.category_id
      LEFT JOIN purity p ON p.id = i.purity_id
      WHERE i.id IN (${placeholders})
        AND i.is_archived = 0
      ORDER BY i.item_number COLLATE NOCASE
    `,
    input.items.map((item) => item.inventoryItemId),
  );

  if (currentItems.length !== input.items.length) {
    throw new Error('One or more items are no longer available.');
  }

  for (const item of currentItems) {
    const existing = await db.select<{ orderNumber: string }[]>(
      `
        SELECT 'ORD-' || printf('%04d', co.id) AS orderNumber
        FROM customer_order_item coi
        JOIN customer_order co ON co.id = coi.order_id
        WHERE co.status <> 'Cancelled'
          AND (
            coi.selection_item_id IN (
              SELECT si.id
              FROM selection_item si
              WHERE si.inventory_item_id = ?
            )
            OR CAST(json_extract(coi.item_snapshot, '$.inventory_item_id') AS INTEGER) = ?
          )
        LIMIT 1
      `,
      [item.id, item.id],
    );

    if (existing.length) {
      throw new Error(
        `${item.itemNumber} already belongs to ${existing[0].orderNumber}.`,
      );
    }
  }

  const diamondRows = await db.select<
    {
      itemId: number;
      shape: string;
      combinationId: number | null;
      quality: string | null;
      pieces: number | null;
      weightMilli: number;
    }[]
  >(
    `
      SELECT
        d.item_id AS itemId,
        ds.name AS shape,
        d.combination_id AS combinationId,
        dc.quality,
        d.pieces,
        d.weight_milli AS weightMilli
      FROM item_diamond d
      JOIN diamond_shape ds ON ds.id = d.shape_id
      LEFT JOIN diamond_combination dc ON dc.id = d.combination_id
      WHERE d.item_id IN (${placeholders})
      ORDER BY ds.sort_order, ds.name
    `,
    input.items.map((item) => item.inventoryItemId),
  );

  const stoneRows = await db.select<
    {
      itemId: number;
      stone: string;
      pieces: number | null;
      weightMilli: number;
    }[]
  >(
    `
      SELECT
        s.item_id AS itemId,
        st.name AS stone,
        s.pieces,
        s.weight_milli AS weightMilli
      FROM item_stone s
      JOIN stone_type st ON st.id = s.stone_type_id
      WHERE s.item_id IN (${placeholders})
      ORDER BY st.sort_order, st.name
    `,
    input.items.map((item) => item.inventoryItemId),
  );

  const pricesById = new Map(
    input.items.map((item) => [item.inventoryItemId, item.agreedPricePaise]),
  );

  const orderItems = currentItems.map((item) => {
    let customValues: Record<string, unknown> = {};

    try {
      customValues = JSON.parse(item.customValues || '{}');
    } catch {
      customValues = {};
    }

    const snapshot = {
      inventory_item_id: item.id,
      item_number: item.itemNumber,
      category: item.categoryName,
      name: item.name,
      gross_weight_milli: item.grossWeightMilli,
      purity: item.purityName,
      diamonds: diamondRows
        .filter((diamond) => diamond.itemId === item.id)
        .map(({ itemId: _itemId, ...diamond }) => diamond),
      stones: stoneRows
        .filter((stone) => stone.itemId === item.id)
        .map(({ itemId: _itemId, ...stone }) => stone),
      is_certified: Boolean(item.igiCertificateNumber?.trim()),
      igi_certificate_number: item.igiCertificateNumber,
      huid: item.huid,
      image_path: item.imagePath,
      custom_values: customValues,
    };

    return {
      inventoryItemId: item.id,
      snapshot,
      price: pricesById.get(item.id) ?? 0,
    };
  });

  const orderId = await invoke<number>('create_confirmed_order', {
    input: {
      customerId: input.customerId,
      exhibitionId: input.exhibitionId,
      notes: input.notes.trim(),
      items: orderItems.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        agreedPricePaise: item.price,
        itemSnapshot: JSON.stringify(item.snapshot),
        pricingBreakdown: JSON.stringify({
          source: 'direct_order',
          inventory_item_id: item.inventoryItemId,
          pricing_note:
            'Final negotiated selling price entered when creating the order.',
        }),
      })),
    },
  });

  return orderId;
}
