export type InventoryArchiveFilter = 'active' | 'archived' | 'all';

export type InventoryCertificationFilter = 'all' | 'certified' | 'uncertified';

export type InventoryItemStatus = 'active' | 'archived';
export type InventoryHuidStatus = 'present' | 'missing';
export type InventoryStonePresence = 'any' | 'has-stones' | 'no-stones';
export type InventoryStoneWeightUnit = 'ct' | 'g';
export type InventorySortDirection = 'asc' | 'desc';

export type InventorySortField =
  | 'itemNumber'
  | 'purity'
  | 'recentlyAdded'
  | 'category'
  | 'grossWeight'
  | 'netWeight'
  | 'itemName'
  | 'diamondPieces'
  | 'diamondWeight'
  | 'stonePieces'
  | 'stoneWeight';

export interface InventorySort {
  field: InventorySortField;
  direction: InventorySortDirection;
}

export interface InventoryFilters {
  // Existing fields retained for compatibility with the current screen.
  search: string;
  categoryId: number | null;
  certification: InventoryCertificationFilter;
  archiveStatus: InventoryArchiveFilter;

  // Multi-select filters.
  categoryIds?: number[];
  itemStatuses?: InventoryItemStatus[];
  certificationStatuses?: Array<'certified' | 'uncertified'>;
  huidStatuses?: InventoryHuidStatus[];
  purityIds?: number[];
  goldTypeIds?: number[];
  diamondShapeIds?: number[];
  diamondCombinationIds?: number[];
  stoneTypeIds?: number[];

  // Diamond totals.
  diamondPiecesMin?: number | null;
  diamondPiecesMax?: number | null;
  diamondWeightMinCt?: number | null;
  diamondWeightMaxCt?: number | null;

  // Stone filters.
  stonePresence?: InventoryStonePresence;
  stonePiecesMin?: number | null;
  stonePiecesMax?: number | null;
  stoneWeightUnit?: InventoryStoneWeightUnit | null;
  stoneWeightMin?: number | null;
  stoneWeightMax?: number | null;

  // Gross/net weights are expressed in grams in the UI.
  grossWeightMin?: number | null;
  grossWeightMax?: number | null;
  netWeightMin?: number | null;
  netWeightMax?: number | null;
}

export interface InventoryCategoryOption {
  id: number;
  name: string;
}

export interface InventoryPurityOption {
  id: number;
  name: string;
  percentBp: number;
}

export interface InventoryGoldTypeOption {
  id: number;
  name: string;
}

export interface InventoryDiamondShapeOption {
  id: number;
  code: string;
  name: string;
}

export interface InventoryDiamondCombinationOption {
  id: number;
  shapeId: number;
  shapeCode: string;
  shapeName: string;
  quality: string;
}

export interface InventoryStoneTypeOption {
  id: number;
  name: string;
  tagLabel: string;
  weightUnit: InventoryStoneWeightUnit;
}

export interface InventoryFilterOptions {
  categories: InventoryCategoryOption[];
  purities: InventoryPurityOption[];
  goldTypes: InventoryGoldTypeOption[];
  diamondShapes: InventoryDiamondShapeOption[];
  diamondCombinations: InventoryDiamondCombinationOption[];
  stoneTypes: InventoryStoneTypeOption[];
}

export interface InventoryDiamondBreakdown {
  shapeCode: string;
  weightMilli: number;
  pieces: number;
}

export interface InventoryStoneBreakdown {
  tagLabel: string;
  weightUnit: InventoryStoneWeightUnit;
  weightMilli: number;
  pieces: number;
}

export interface InventoryItem {
  id: number;
  itemNumber: string;
  categoryId: number;
  categoryName: string;
  name: string | null;
  imagePath: string | null;
  grossWeightMilli: number | null;
  netWeightMilli: number | null;
  purityName: string | null;
  purityPercentBp: number | null;
  goldTypeId?: number | null;
  goldTypeName?: string | null;
  igiCertificateNumber: string | null;
  huid: string | null;
  notes: string | null;
  customValues: string;
  isArchived: number;
  createdAt?: string;
  diamondDetails: string | null;
  stoneDetails: string | null;
  diamondBreakdown?: InventoryDiamondBreakdown[];
  stoneBreakdown?: InventoryStoneBreakdown[];
}
