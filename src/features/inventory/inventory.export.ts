import type { ExportColumn } from '../../components/export/export.types';
import type { InventoryItem } from './inventory.types';

const weight = (milli: number | null) => milli === null ? '' : `${(milli / 1000).toFixed(3)} g`;

export const INVENTORY_EXPORT_COLUMNS: ExportColumn<InventoryItem>[] = [
  { key: 'itemNumber', label: 'Item number', value: (item) => item.itemNumber },
  { key: 'category', label: 'Category', value: (item) => item.categoryName },
  { key: 'name', label: 'Item name', value: (item) => item.name },
  { key: 'grossWeight', label: 'Gross weight', value: (item) => weight(item.grossWeightMilli) },
  { key: 'netWeight', label: 'Net weight', value: (item) => weight(item.netWeightMilli) },
  { key: 'purity', label: 'Purity', value: (item) => [item.purityName, item.purityPercentBp == null ? '' : `${(item.purityPercentBp / 100).toFixed(2)}%`].filter(Boolean).join(' ') },
  { key: 'goldType', label: 'Gold type', value: (item) => item.goldTypeName },
  { key: 'diamondDetails', label: 'Diamond details', value: (item) => item.diamondDetails },
  { key: 'stoneDetails', label: 'Other stone details', value: (item) => item.stoneDetails },
  { key: 'igiCertificateNumber', label: 'IGI certificate number', value: (item) => item.igiCertificateNumber },
  { key: 'huid', label: 'HUID', value: (item) => item.huid },
  { key: 'notes', label: 'Notes', value: (item) => item.notes },
  { key: 'status', label: 'Status', value: (item) => item.isArchived === 1 ? 'Archived' : 'Active' },
  { key: 'createdAt', label: 'Date added', value: (item) => item.createdAt },
];
