import type { ExportColumn } from '../../components/export/export.types';
import type { ExhibitionInventoryRow } from './exhibition.queries';

const weight = (milli: number | null) =>
  milli === null ? '' : `${(milli / 1000).toFixed(3)} g`;

export const EXHIBITION_INVENTORY_EXPORT_COLUMNS: ExportColumn<ExhibitionInventoryRow>[] = [
  { key: 'itemNumber', label: 'Item number', value: (item) => item.itemNumber },
  { key: 'categoryName', label: 'Category', value: (item) => item.categoryName },
  { key: 'name', label: 'Item name', value: (item) => item.name },
  { key: 'grossWeight', label: 'Gross weight', value: (item) => weight(item.grossWeightMilli) },
  { key: 'netWeight', label: 'Net weight', value: (item) => weight(item.netWeightMilli) },
  { key: 'diamondDetails', label: 'Diamond details', value: (item) => item.diamondDetails },
  { key: 'stoneDetails', label: 'Other stone details', value: (item) => item.stoneDetails },
  { key: 'igiCertificateNumber', label: 'IGI certificate number', value: (item) => item.igiCertificateNumber },
  { key: 'huid', label: 'HUID', value: (item) => item.huid },
  { key: 'isArchived', label: 'Status', value: (item) => item.isArchived ? 'Archived' : 'Active' },
  { key: 'selectionCount', label: 'Selections', defaultVisible: false, value: (item) => item.selectionCount ? `${item.selectionCount} active` : 'None' },
];
