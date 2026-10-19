import { getDatabase } from '../../db';
import type {
  InventoryCategoryOption,
  InventoryDiamondCombinationOption,
  InventoryDiamondShapeOption,
  InventoryFilterOptions,
  InventoryFilters,
  InventoryGoldTypeOption,
  InventoryItem,
  InventoryPurityOption,
  InventorySort,
  InventoryStoneTypeOption,
} from './inventory.types';

type SqlValue = string | number;

const SORT_EXPRESSIONS: Record<InventorySort['field'], string> = {
  itemNumber: 'i.item_number COLLATE NOCASE',
  purity: 'COALESCE(p.percent_bp, -1)',
  recentlyAdded: 'i.created_at',
  category: 'c.name COLLATE NOCASE',
  grossWeight: 'i.gross_weight_milli',
  netWeight: 'i.net_weight_milli',
  itemName: "COALESCE(i.name, '') COLLATE NOCASE",
  diamondPieces: `(
    SELECT COALESCE(SUM(COALESCE(d.pieces, 0)), 0)
    FROM item_diamond d
    WHERE d.item_id = i.id
  )`,
  diamondWeight: `(
    SELECT COALESCE(SUM(d.weight_milli), 0)
    FROM item_diamond d
    WHERE d.item_id = i.id
  )`,
  stonePieces: `(
    SELECT COALESCE(SUM(COALESCE(s.pieces, 0)), 0)
    FROM item_stone s
    WHERE s.item_id = i.id
  )`,
  // Normalize to carat-equivalent milli-units for comparable physical mass.
  stoneWeight: `(
    SELECT COALESCE(SUM(
      CASE WHEN st.weight_unit = 'g'
        THEN s.weight_milli * 5
        ELSE s.weight_milli
      END
    ), 0)
    FROM item_stone s
    JOIN stone_type st ON st.id = s.stone_type_id
    WHERE s.item_id = i.id
  )`,
};

function addIdListCondition(
  conditions: string[],
  params: SqlValue[],
  expression: string,
  ids: number[] | undefined,
) {
  if (!ids?.length) return;

  conditions.push(`${expression} IN (${ids.map(() => '?').join(', ')})`);
  params.push(...ids);
}

function addRangeCondition(
  conditions: string[],
  params: SqlValue[],
  expression: string,
  min: number | null | undefined,
  max: number | null | undefined,
  multiplier = 1,
) {
  if (min != null && Number.isFinite(min)) {
    conditions.push(`${expression} >= ?`);
    params.push(min * multiplier);
  }

  if (max != null && Number.isFinite(max)) {
    conditions.push(`${expression} <= ?`);
    params.push(max * multiplier);
  }
}

export async function getInventoryItems(
  filters: InventoryFilters,
  sort: InventorySort = { field: 'itemNumber', direction: 'asc' },
): Promise<InventoryItem[]> {
  const database = await getDatabase();
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  const search = filters.search.trim();

  if (search) {
    conditions.push("(i.item_number LIKE ? OR COALESCE(i.name, '') LIKE ?)");
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }

  // Prefer the multi-select category filter when supplied.
  if (filters.categoryIds !== undefined) {
    addIdListCondition(
      conditions,
      params,
      'i.category_id',
      filters.categoryIds,
    );
  } else if (filters.categoryId !== null) {
    conditions.push('i.category_id = ?');
    params.push(filters.categoryId);
  }

  // Zero or two selected status options means no status restriction.
  if (filters.itemStatuses !== undefined) {
    if (filters.itemStatuses.length === 1) {
      conditions.push(
        filters.itemStatuses[0] === 'active'
          ? 'i.is_archived = 0'
          : 'i.is_archived = 1',
      );
    }
  } else if (filters.archiveStatus === 'active') {
    conditions.push('i.is_archived = 0');
  } else if (filters.archiveStatus === 'archived') {
    conditions.push('i.is_archived = 1');
  }

  // Zero or two selected certification options means no restriction.
  if (filters.certificationStatuses !== undefined) {
    if (filters.certificationStatuses.length === 1) {
      conditions.push(
        filters.certificationStatuses[0] === 'certified'
          ? "i.igi_certificate_number IS NOT NULL AND TRIM(i.igi_certificate_number) <> ''"
          : "(i.igi_certificate_number IS NULL OR TRIM(i.igi_certificate_number) = '')",
      );
    }
  } else if (filters.certification === 'certified') {
    conditions.push(
      "i.igi_certificate_number IS NOT NULL AND TRIM(i.igi_certificate_number) <> ''",
    );
  } else if (filters.certification === 'uncertified') {
    conditions.push(
      "(i.igi_certificate_number IS NULL OR TRIM(i.igi_certificate_number) = '')",
    );
  }

  // Zero or two selected HUID options means no restriction.
  if (filters.huidStatuses?.length === 1) {
    conditions.push(
      filters.huidStatuses[0] === 'present'
        ? "i.huid IS NOT NULL AND TRIM(i.huid) <> ''"
        : "(i.huid IS NULL OR TRIM(i.huid) = '')",
    );
  }

  addIdListCondition(conditions, params, 'i.purity_id', filters.purityIds);
  addIdListCondition(conditions, params, 'i.gold_type_id', filters.goldTypeIds);

  if (filters.diamondShapeIds?.length) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM item_diamond d
      WHERE d.item_id = i.id
        AND d.shape_id IN (${filters.diamondShapeIds.map(() => '?').join(', ')})
    )`);
    params.push(...filters.diamondShapeIds);
  }

  if (filters.diamondCombinationIds?.length) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM item_diamond d
      WHERE d.item_id = i.id
        AND d.combination_id IN (${filters.diamondCombinationIds.map(() => '?').join(', ')})
    )`);
    params.push(...filters.diamondCombinationIds);
  }

  const diamondPiecesTotal = `(
    SELECT COALESCE(SUM(COALESCE(d.pieces, 0)), 0)
    FROM item_diamond d
    WHERE d.item_id = i.id
  )`;

  const diamondWeightTotal = `(
    SELECT COALESCE(SUM(d.weight_milli), 0)
    FROM item_diamond d
    WHERE d.item_id = i.id
  )`;

  addRangeCondition(
    conditions,
    params,
    diamondPiecesTotal,
    filters.diamondPiecesMin,
    filters.diamondPiecesMax,
  );

  addRangeCondition(
    conditions,
    params,
    diamondWeightTotal,
    filters.diamondWeightMinCt,
    filters.diamondWeightMaxCt,
    1000,
  );

  if (filters.stonePresence === 'has-stones') {
    conditions.push(
      'EXISTS (SELECT 1 FROM item_stone s WHERE s.item_id = i.id)',
    );
  } else if (filters.stonePresence === 'no-stones') {
    conditions.push(
      'NOT EXISTS (SELECT 1 FROM item_stone s WHERE s.item_id = i.id)',
    );
  }

  if (filters.stoneTypeIds?.length) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM item_stone s
      WHERE s.item_id = i.id
        AND s.stone_type_id IN (${filters.stoneTypeIds.map(() => '?').join(', ')})
    )`);
    params.push(...filters.stoneTypeIds);
  }

  const stonePiecesTotal = `(
    SELECT COALESCE(SUM(COALESCE(s.pieces, 0)), 0)
    FROM item_stone s
    WHERE s.item_id = i.id
      ${
        filters.stoneTypeIds?.length
          ? `AND s.stone_type_id IN (${filters.stoneTypeIds.map(() => '?').join(', ')})`
          : ''
      }
  )`;

  if (filters.stonePiecesMin != null) {
    conditions.push(`${stonePiecesTotal} >= ?`);
    params.push(...(filters.stoneTypeIds ?? []), filters.stonePiecesMin);
  }

  if (filters.stonePiecesMax != null) {
    conditions.push(`${stonePiecesTotal} <= ?`);
    params.push(...(filters.stoneTypeIds ?? []), filters.stonePiecesMax);
  }

  // Stone weight ranges must specify ct or g; mixed units aren't added together.
  if (
    filters.stoneWeightUnit &&
    (filters.stoneWeightMin != null || filters.stoneWeightMax != null)
  ) {
    const stoneWeightTotal = `(
      SELECT COALESCE(SUM(s.weight_milli), 0)
      FROM item_stone s
      JOIN stone_type st ON st.id = s.stone_type_id
      WHERE s.item_id = i.id
        AND st.weight_unit = ?
        ${
          filters.stoneTypeIds?.length
            ? `AND s.stone_type_id IN (${filters.stoneTypeIds.map(() => '?').join(', ')})`
            : ''
        }
    )`;

    if (filters.stoneWeightMin != null) {
      conditions.push(`${stoneWeightTotal} >= ?`);
      params.push(
        filters.stoneWeightUnit,
        ...(filters.stoneTypeIds ?? []),
        filters.stoneWeightMin * 1000,
      );
    }

    if (filters.stoneWeightMax != null) {
      conditions.push(`${stoneWeightTotal} <= ?`);
      params.push(
        filters.stoneWeightUnit,
        ...(filters.stoneTypeIds ?? []),
        filters.stoneWeightMax * 1000,
      );
    }
  }

  addRangeCondition(
    conditions,
    params,
    'i.gross_weight_milli',
    filters.grossWeightMin,
    filters.grossWeightMax,
    1000,
  );

  addRangeCondition(
    conditions,
    params,
    'i.net_weight_milli',
    filters.netWeightMin,
    filters.netWeightMax,
    1000,
  );

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // The SQL expression comes only from the fixed allowlist above.
  const sortExpression = SORT_EXPRESSIONS[sort.field];
  const sortDirection = sort.direction === 'desc' ? 'DESC' : 'ASC';

  const sql = `
    SELECT
      i.id,
      i.item_number AS itemNumber,
      i.category_id AS categoryId,
      c.name AS categoryName,
      i.name,
      i.image_path AS imagePath,
      i.gross_weight_milli AS grossWeightMilli,
      i.net_weight_milli AS netWeightMilli,
      p.name AS purityName,
      p.percent_bp AS purityPercentBp,
      i.gold_type_id AS goldTypeId,
      gt.name AS goldTypeName,
      i.igi_certificate_number AS igiCertificateNumber,
      i.huid,
      i.notes,
      i.custom_values AS customValues,
      i.is_archived AS isArchived,
      i.created_at AS createdAt,

      (
        SELECT GROUP_CONCAT(
          ds.code || ': ' ||
          printf('%.3f', d.weight_milli / 1000.0) || ' ct' ||
          ' (' || COALESCE(d.pieces, 0) || ' pcs)',
          char(10)
        )
        FROM item_diamond d
        JOIN diamond_shape ds ON ds.id = d.shape_id
        WHERE d.item_id = i.id
      ) AS diamondDetails,

      (
        SELECT GROUP_CONCAT(
          st.name || ': ' ||
          printf('%.3f', s.weight_milli / 1000.0) || ' ' ||
          st.weight_unit ||
          ' (' || COALESCE(s.pieces, 0) || ' pcs)',
          char(10)
        )
        FROM item_stone s
        JOIN stone_type st ON st.id = s.stone_type_id
        WHERE s.item_id = i.id
      ) AS stoneDetails

    FROM item i
    JOIN category c ON c.id = i.category_id
    LEFT JOIN purity p ON p.id = i.purity_id
    LEFT JOIN gold_type gt ON gt.id = i.gold_type_id
    ${whereClause}
    ORDER BY ${sortExpression} ${sortDirection},
      i.created_at DESC,
      i.item_number COLLATE NOCASE ASC
  `;

  return database.select<InventoryItem[]>(sql, params);
}

export async function getInventoryCategories(): Promise<
  InventoryCategoryOption[]
> {
  const database = await getDatabase();

  return database.select<InventoryCategoryOption[]>(`
    SELECT id, name
    FROM category
    WHERE is_archived = 0
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `);
}

export async function getInventoryFilterOptions(): Promise<InventoryFilterOptions> {
  const database = await getDatabase();

  const [
    categories,
    purities,
    goldTypes,
    diamondShapes,
    diamondCombinations,
    stoneTypes,
  ] = await Promise.all([
    database.select<InventoryCategoryOption[]>(`
      SELECT id, name
      FROM category
      WHERE is_archived = 0
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `),
    database.select<InventoryPurityOption[]>(`
      SELECT id, name, percent_bp AS percentBp
      FROM purity
      WHERE is_archived = 0
      ORDER BY percent_bp DESC, name COLLATE NOCASE ASC
    `),
    database.select<InventoryGoldTypeOption[]>(`
      SELECT id, name
      FROM gold_type
      WHERE is_archived = 0
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `),
    database.select<InventoryDiamondShapeOption[]>(`
      SELECT id, code, name
      FROM diamond_shape
      WHERE is_archived = 0
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `),
    database.select<InventoryDiamondCombinationOption[]>(`
      SELECT
        dc.id,
        dc.shape_id AS shapeId,
        ds.code AS shapeCode,
        ds.name AS shapeName,
        dc.quality
      FROM diamond_combination dc
      JOIN diamond_shape ds ON ds.id = dc.shape_id
      WHERE dc.is_archived = 0
        AND ds.is_archived = 0
      ORDER BY ds.sort_order ASC, dc.quality COLLATE NOCASE ASC
    `),
    database.select<InventoryStoneTypeOption[]>(`
      SELECT
        id,
        name,
        tag_label AS tagLabel,
        weight_unit AS weightUnit
      FROM stone_type
      WHERE is_archived = 0
      ORDER BY sort_order ASC, name COLLATE NOCASE ASC
    `),
  ]);

  return {
    categories,
    purities,
    goldTypes,
    diamondShapes,
    diamondCombinations,
    stoneTypes,
  };
}
