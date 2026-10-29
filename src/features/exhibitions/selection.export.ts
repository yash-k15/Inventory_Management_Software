import type { ExportColumn } from '../../components/export/export.types';
import type { SelectionOrderSummary, SelectionRow } from './selection.queries';

const weight = (milli: number | null) =>
  milli == null ? '' : `${(milli / 1000).toFixed(3)} g`;

const diamondDetails = (entries: SelectionRow['diamonds']) =>
  entries.map((entry) => `${entry.label}: ${(entry.weight_milli == null ? 0 : entry.weight_milli / 1000).toFixed(2)} ct${entry.pieces == null ? '' : ` (${entry.pieces} pcs)`}`).join('\n');

const stoneDetails = (entries: SelectionRow['stones']) =>
  entries.map((entry) => `${entry.label}: ${(entry.weight_milli == null ? 0 : entry.weight_milli / 1000).toFixed(entry.weight_unit === 'g' ? 3 : 2)} ${entry.weight_unit ?? 'ct'}${entry.pieces == null ? '' : ` (${entry.pieces} pcs)`}`).join('\n');

export const SELECTION_EXPORT_COLUMNS: ExportColumn<SelectionRow>[] = [
  { key: 'itemNumber', label: 'Item number', value: (item) => item.itemNumber },
  { key: 'category', label: 'Category', value: (item) => item.categoryName },
  { key: 'name', label: 'Item name', value: (item) => item.name },
  { key: 'grossWeight', label: 'Gross weight', value: (item) => weight(item.grossWeightMilli) },
  { key: 'netWeight', label: 'Net weight', value: (item) => weight(item.netWeightMilli) },
  { key: 'purity', label: 'Purity', value: (item) => item.purityName },
  { key: 'diamondDetails', label: 'Diamond details', value: (item) => diamondDetails(item.diamonds) },
  { key: 'stoneDetails', label: 'Other stone details', value: (item) => stoneDetails(item.stones) },
  { key: 'status', label: 'Selection status', value: (item) => item.status === 'active' ? 'Active' : 'Removed' },
  { key: 'addedAt', label: 'Date added', value: (item) => item.addedAt },
];

const money = (paise: number | null | undefined) =>
  paise == null ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

const date = (value: string) => {
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN');
};

export const SELECTION_ORDER_EXPORT_COLUMNS: ExportColumn<SelectionOrderSummary>[] = [
  { key: 'orderNumber', label: 'Order', value: (order) => order.orderNumber },
  { key: 'createdAt', label: 'Order date', value: (order) => date(order.createdAt) },
  { key: 'itemCount', label: 'Items', value: (order) => order.itemCount },
  { key: 'status', label: 'Status', value: (order) => order.status },
  { key: 'calculatedTotal', label: 'Calculated total', value: (order) => money(order.calculatedTotalPaise) },
  { key: 'roundedTotal', label: 'Rounded total', value: (order) => money(order.roundedTotalPaise) },
  { key: 'orderValue', label: 'Order value', value: (order) => money(order.totalPaise) },
];


export interface SelectionOrderItemExportRow {
  orderNumber: string;
  createdAt: string;
  status: string;
  itemNumber: string;
  categoryName: string;
  grossWeight: string;
  netWeight: string;
  diamondDetails: string;
  stoneDetails: string;
  itemPricePaise: number;
  diamondBreakdown: Array<{
    shapeCode: string;
    weightMilli: number;
    pieces: number;
  }>;
  stoneBreakdown: Array<{
    tagLabel: string;
    weightUnit: 'ct' | 'g';
    weightMilli: number;
    pieces: number;
  }>;
}

const orderItemMoney = (paise: number | null | undefined) =>
  paise == null
    ? ''
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(paise / 100);

const orderItemWeight = (milli: number | null) =>
  milli == null ? '' : `${(milli / 1000).toFixed(3)} g`;

const orderItemDetails = (entries: Array<{
  label: string;
  pieces: number | null;
  weight_milli: number | null;
  weight_unit?: 'ct' | 'g' | null;
}>) => entries.map((entry) => {
  const unit = entry.weight_unit ?? 'ct';
  const weight = entry.weight_milli == null
    ? ''
    : `${(entry.weight_milli / 1000).toFixed(unit === 'g' ? 3 : 2)} ${unit}`;
  const pieces = entry.pieces == null ? '' : ` (${entry.pieces} pcs)`;
  return `${entry.label}${weight ? `: ${weight}` : ''}${pieces}`;
}).join('\n');

export const SELECTION_ORDER_ITEM_EXPORT_COLUMNS: ExportColumn<SelectionOrderItemExportRow>[] = [
  { key: 'orderNumber', label: 'Order', value: (row) => row.orderNumber },
  { key: 'createdAt', label: 'Order date', value: (row) => date(row.createdAt) },
  { key: 'status', label: 'Status', value: (row) => row.status },
  { key: 'itemNumber', label: 'Item number', value: (row) => row.itemNumber },
  { key: 'categoryName', label: 'Category', value: (row) => row.categoryName },
  { key: 'grossWeight', label: 'Gross weight', value: (row) => row.grossWeight },
  { key: 'netWeight', label: 'Net weight', value: (row) => row.netWeight },
  { key: 'diamondDetails', label: 'Diamond details', value: (row) => row.diamondDetails },
  { key: 'stoneDetails', label: 'Other stone details', value: (row) => row.stoneDetails },
  { key: 'itemPrice', label: 'Item price', value: (row) => orderItemMoney(row.itemPricePaise) },
];

export function toSelectionOrderItemExportRow(
  order: SelectionOrderSummary,
  item: import('./selection.queries').SelectionOrderDetail['items'][number],
): SelectionOrderItemExportRow {
  return {
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    itemNumber: item.itemNumber,
    categoryName: item.categoryName,
    grossWeight: orderItemWeight(item.grossWeightMilli),
    netWeight: orderItemWeight(item.netWeightMilli),
    diamondDetails: orderItemDetails(item.diamonds),
    stoneDetails: orderItemDetails(item.stones),
    itemPricePaise: item.pricePaise,
    // ExportDialog uses these structured values to generate one column per
    // diamond shape and stone type. The formatted detail strings above are
    // for the non-separated-details view only.
    diamondBreakdown: item.diamonds.map((entry) => ({
      shapeCode: entry.label,
      weightMilli: entry.weight_milli ?? 0,
      pieces: entry.pieces ?? 0,
    })),
    stoneBreakdown: item.stones.map((entry) => ({
      tagLabel: entry.label,
      weightUnit: entry.weight_unit === 'g' ? 'g' : 'ct',
      weightMilli: entry.weight_milli ?? 0,
      pieces: entry.pieces ?? 0,
    })),
  };
}
