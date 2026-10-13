
import { getDatabase } from '../../db';

export type ItemDetails = {
  id: number;
  itemNumber: string;
  categoryName: string;
  name: string | null;
  imagePath: string | null;
  grossWeightMilli: number | null;
  netWeightMilli: number | null;
  purityName: string | null;
  purityPercentBp: number | null;
  goldTypeName: string | null;
  igiCertificateNumber: string | null;
  huid: string | null;
  notes: string | null;
  customValues: string;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
};

export type ItemDiamondDetail = {
  id: number;
  shapeName: string;
  shapeCode: string;
  combinationQuality: string | null;
  pieces: number | null;
  weightMilli: number;
};

export type ItemStoneDetail = {
  id: number;
  stoneName: string;
  tagLabel: string;
  weightUnit: string;
  pieces: number | null;
  weightMilli: number;
};

export async function getItemDetails(
  itemId: number,
): Promise<ItemDetails | null> {
  const db = await getDatabase();

  const items = await db.select<ItemDetails[]>(
    `SELECT
      i.id,
      i.item_number AS itemNumber,
      c.name AS categoryName,
      i.name,
      i.image_path AS imagePath,
      i.gross_weight_milli AS grossWeightMilli,
      i.net_weight_milli AS netWeightMilli,
      p.name AS purityName,
      p.percent_bp AS purityPercentBp,
      gt.name AS goldTypeName,
      i.igi_certificate_number AS igiCertificateNumber,
      i.huid,
      i.notes,
      i.custom_values AS customValues,
      i.is_archived AS isArchived,
      i.created_at AS createdAt,
      i.updated_at AS updatedAt
    FROM item i
    JOIN category c ON c.id = i.category_id
    LEFT JOIN purity p ON p.id = i.purity_id
    LEFT JOIN gold_type gt ON gt.id = i.gold_type_id
    WHERE i.id = ?`,
    [itemId],
  );

  return items[0] ?? null;
}

export async function getItemDiamondDetails(
  itemId: number,
): Promise<ItemDiamondDetail[]> {
  const db = await getDatabase();

  return db.select<ItemDiamondDetail[]>(
    `SELECT
      d.id,
      ds.name AS shapeName,
      ds.code AS shapeCode,
      dc.quality AS combinationQuality,
      d.pieces,
      d.weight_milli AS weightMilli
    FROM item_diamond d
    JOIN diamond_shape ds ON ds.id = d.shape_id
    LEFT JOIN diamond_combination dc
      ON dc.id = d.combination_id
      AND dc.shape_id = d.shape_id
    WHERE d.item_id = ?
    ORDER BY ds.sort_order, ds.name`,
    [itemId],
  );
}

export async function getItemStoneDetails(
  itemId: number,
): Promise<ItemStoneDetail[]> {
  const db = await getDatabase();

  return db.select<ItemStoneDetail[]>(
    `SELECT
      s.id,
      st.name AS stoneName,
      st.tag_label AS tagLabel,
      st.weight_unit AS weightUnit,
      s.pieces,
      s.weight_milli AS weightMilli
    FROM item_stone s
    JOIN stone_type st ON st.id = s.stone_type_id
    WHERE s.item_id = ?
    ORDER BY st.sort_order, st.name`,
    [itemId],
  );
}
