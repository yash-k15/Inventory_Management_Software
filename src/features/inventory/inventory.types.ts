export type InventoryArchiveFilter = 'active' | 'archived' | 'all';

export type InventoryCertificationFilter = 'all' | 'certified' | 'uncertified';

export interface InventoryFilters {
  search: string;
  categoryId: number | null;
  certification: InventoryCertificationFilter;
  archiveStatus: InventoryArchiveFilter;
}

export interface InventoryCategoryOption {
  id: number;
  name: string;
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
  igiCertificateNumber: string | null;
  huid: string | null;
  notes: string | null;
  customValues: string;
  isArchived: number;
  diamondDetails: string | null;
  stoneDetails: string | null;
}