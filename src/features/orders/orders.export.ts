import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { OrderDetails, OrderDetailItem } from './orders.queries';

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (paise: unknown) => typeof paise === 'number' && Number.isFinite(paise) ? currency.format(paise / 100) : 'Not available';
const number = (value: unknown, digits = 3) => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
const date = (value: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
};
const orderNo = (id: number) => `ORD-${String(id).padStart(4, '0')}`;
const arr = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : [];
const n = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : Number.isFinite(Number(value)) ? Number(value) : 0;
const hasBreakdown = (item: OrderDetailItem) => item.pricingBreakdown?.breakdown_available !== false && item.pricingBreakdown?.source !== 'direct' && typeof item.pricingBreakdown?.calculated_total_paise === 'number';
function pieces(item: OrderDetailItem, kind: 'diamond' | 'stone', line: Record<string, any>): number | null {
  if (typeof line.pieces === 'number') return line.pieces;
  if (typeof line.piece_count === 'number') return line.piece_count;
  const source = arr(kind === 'diamond' ? item.itemSnapshot?.diamonds : item.itemSnapshot?.stones);
  const match = source.find((entry) => kind === 'diamond'
    ? String(entry.shape ?? '') === String(line.shape ?? '') && String(entry.quality ?? '') === String(line.quality ?? '')
    : String(entry.stone ?? '') === String(line.stone ?? ''));
  return match?.pieces == null || !Number.isFinite(Number(match.pieces)) ? null : Number(match.pieces);
}
function itemDescription(item: OrderDetailItem) {
  const snapshot = item.itemSnapshot ?? {};
  return [item.category, snapshot.name, item.details].filter((v) => typeof v === 'string' && v.trim()).join(' · ') || '—';
}
function saveBytes(filename: string, format: 'xlsx' | 'pdf', bytes: Uint8Array) {
  return (async () => {
    const path = await save({ defaultPath: filename, filters: [{ name: format === 'xlsx' ? 'Excel workbook' : 'PDF document', extensions: [format] }] });
    if (!path) return;
    await invoke('write_export_file', { path, bytes: Array.from(bytes) });
  })();
}
function itemRow(item: OrderDetailItem) {
  const snapshot = item.itemSnapshot ?? {};
  const diamonds = arr(snapshot.diamonds);
  const stones = arr(snapshot.stones);
  const diamondWeightMilli = diamonds.reduce((sum, line) => sum + n(line.weightMilliCarats ?? line.weightMilli), 0);
  const stoneWeightMilli = stones.reduce((sum, line) => sum + n(line.weightMilli), 0);
  return {
    'Item number': item.itemNumber,
    'Category': item.category,
    'Description': itemDescription(item),
    'Gross weight (g)': item.grossWeightMilli == null ? '—' : Number(item.grossWeightMilli) / 1000,
    'Net gold weight (g)': item.netWeightMilli == null ? '—' : Number(item.netWeightMilli) / 1000,
    'Diamond details': diamonds.map((d) => `${d.shape ?? 'Diamond'}${d.quality ? ` / ${d.quality}` : ''}: ${number(n(d.weightMilliCarats ?? d.weightMilli) / 1000)} ct${d.pieces == null ? '' : ` (${d.pieces} pcs)`}`).join('\n') || '—',
    'Stone details': stones.map((s) => `${s.stone ?? 'Stone'}: ${number(n(s.weightMilli) / 1000)} ${s.weightUnit ?? 'ct'}${s.pieces == null ? '' : ` (${s.pieces} pcs)`}`).join('\n') || '—',
    'Calculated price': hasBreakdown(item) ? money(item.pricingBreakdown?.calculated_total_paise) : 'Unavailable — direct final amount',
    'Agreed price': money(item.agreedPricePaise),
    __diamondWeight: diamondWeightMilli / 1000,
    __stoneWeight: stoneWeightMilli / 1000,
  };
}
function pricingRows(order: OrderDetails) {
  return order.items.map((item) => {
    const b = item.pricingBreakdown ?? {};
    return {
      'Item number': item.itemNumber,
      'Pricing method': hasBreakdown(item) ? 'Saved calculation' : 'Direct final amount — component breakdown unavailable',
      'Net gold weight (g)': b.net_gold_g ?? (item.netWeightMilli == null ? '—' : item.netWeightMilli / 1000),
      'Purity (%)': b.purity_percent_bp == null ? '—' : Number(b.purity_percent_bp) / 100,
      'Gold rate per g': b.gold_rate_paise_per_g == null ? '—' : money(b.gold_rate_paise_per_g),
      'Gold value': hasBreakdown(item) ? money(b.gold_value_paise) : 'Unavailable',
      'Wastage': hasBreakdown(item) ? money(b.wastage_value_paise) : 'Unavailable',
      'Extra cost': hasBreakdown(item) ? money(b.extra_cost_paise) : 'Unavailable',
      'Certification': hasBreakdown(item) ? money(b.certification_value_paise) : 'Unavailable',
      'Subtotal before GST': hasBreakdown(item) ? money(b.subtotal_paise) : 'Unavailable',
      'GST rate (%)': b.gst_rate_bp == null ? '—' : Number(b.gst_rate_bp) / 100,
      'GST amount': hasBreakdown(item) ? money(b.gst_value_paise) : 'Unavailable',
      'Calculated total': hasBreakdown(item) ? money(b.calculated_total_paise) : 'Unavailable',
      'Agreed price': money(item.agreedPricePaise),
    };
  });
}
function materialRows(order: OrderDetails, kind: 'diamond' | 'stone') {
  const result: Record<string, any>[] = [];
  for (const item of order.items.filter(hasBreakdown)) {
    const b = item.pricingBreakdown ?? {};
    const lines = arr(kind === 'diamond' ? b.diamond_lines : b.stone_lines);
    for (const line of lines) {
      const isDiamond = kind === 'diamond';
      result.push({
        'Item number': item.itemNumber,
        'Type / quality': isDiamond ? `${line.shape ?? 'Diamond'}${line.quality ? ` · ${line.quality}` : ''}` : String(line.stone ?? 'Stone'),
        'Pieces': pieces(item, kind, line) ?? '—',
        'Weight': isDiamond ? number(line.weight_ct ?? n(line.weightMilliCarats ?? line.weightMilli) / 1000) : number(line.weight ?? n(line.weightMilli) / 1000),
        'Unit': isDiamond ? 'ct' : String(line.unit ?? line.weightUnit ?? 'ct'),
        'Rate per unit': isDiamond ? (line.rate_paise_per_ct == null ? '—' : money(line.rate_paise_per_ct)) : (line.rate_paise_per_unit == null ? '—' : money(line.rate_paise_per_unit)),
        'Cost': line.value_paise == null ? '—' : money(line.value_paise),
      });
    }
  }
  return result;
}
function orderSummary(order: OrderDetails) {
  return [
    { Field: 'Order number', Value: orderNo(order.id) },
    { Field: 'Status', Value: order.status },
    { Field: 'Order source', Value: order.exhibitionId == null ? 'Direct order' : 'Exhibition' },
    { Field: 'Exhibition', Value: order.exhibitionName ?? 'Direct order' },
    { Field: 'Exhibition dates', Value: order.exhibitionId == null ? '—' : `${date(order.exhibitionStartDate)} – ${date(order.exhibitionEndDate)}` },
    { Field: 'Created date', Value: date(order.createdAt) },
    { Field: 'Confirmed date', Value: date(order.confirmedAt) },
    { Field: 'Customer', Value: order.customerName },
    { Field: 'Contact name', Value: order.contactName ?? '—' },
    { Field: 'Phone', Value: order.phone ?? '—' },
    { Field: 'City', Value: order.city ?? '—' },
    { Field: 'Item count', Value: order.items.length },
    { Field: 'Calculated total (items with saved calculation)', Value: money(order.items.filter(hasBreakdown).reduce((sum, item) => sum + n(item.pricingBreakdown?.calculated_total_paise), 0)) },
    { Field: 'Final order value', Value: money(order.totalValuePaise) },
    { Field: 'Payment received', Value: money(order.paymentReceivedPaise) },
    { Field: 'Payment pending', Value: money(order.paymentPendingPaise) },
    { Field: 'Notes', Value: order.notes ?? '—' },
  ];
}
function styleSheet(ws: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  ws['!cols'] = Array.from({ length: range.e.c + 1 }, (_, col) => {
    let width = 14;
    for (let row = range.s.r; row <= Math.min(range.e.r, 20); row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      width = Math.max(width, Math.min(42, String(cell?.v ?? '').split('\n').reduce((max, line) => Math.max(max, line.length), 0) + 2));
    }
    return { wch: width };
  });
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: col })];
    if (cell) cell.s = { fill: { fgColor: { rgb: '3F342A' } }, font: { bold: true, color: { rgb: 'FFFFFF' } }, alignment: { vertical: 'center', wrapText: true } };
  }
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: ws['!ref'] ?? 'A1:A1' };
}
export async function exportOrderExcel(order: OrderDetails): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([[`Order ${orderNo(order.id)}`], ['Field', 'Value'], ...orderSummary(order).map((r) => [r.Field, r.Value])]);
  const items = order.items.map(itemRow).map(({ __diamondWeight: _dw, __stoneWeight: _sw, ...row }) => row);
  const itemSheet = XLSX.utils.json_to_sheet(items.length ? items : [{ 'Item number': 'No items' }]);
  const priceSheet = XLSX.utils.json_to_sheet(pricingRows(order).length ? pricingRows(order) : [{ 'Item number': 'No items' }]);
  const diamondSheet = XLSX.utils.json_to_sheet(materialRows(order, 'diamond').length ? materialRows(order, 'diamond') : [{ 'Type / quality': 'No saved diamond breakdowns' }]);
  const stoneSheet = XLSX.utils.json_to_sheet(materialRows(order, 'stone').length ? materialRows(order, 'stone') : [{ 'Type / quality': 'No saved stone breakdowns' }]);
  [summary, itemSheet, priceSheet, diamondSheet, stoneSheet].forEach(styleSheet);
  summary['!cols'] = [{ wch: 38 }, { wch: 58 }];
  XLSX.utils.book_append_sheet(workbook, summary, 'Order Summary');
  XLSX.utils.book_append_sheet(workbook, itemSheet, 'Order Items');
  XLSX.utils.book_append_sheet(workbook, priceSheet, 'Price Breakdown');
  XLSX.utils.book_append_sheet(workbook, diamondSheet, 'Diamonds');
  XLSX.utils.book_append_sheet(workbook, stoneSheet, 'Stones');
  // SheetJS returns an ArrayBuffer for type: 'array'. Wrap it in a Uint8Array
  // before converting to a number array for the Tauri Rust command. Casting the
  // ArrayBuffer directly to Uint8Array makes Array.from(...) produce an empty array.
  const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const bytes = new Uint8Array(workbookBuffer);
  await saveBytes(`${orderNo(order.id)}_details.xlsx`, 'xlsx', bytes);
}
export async function exportOrderPdf(order: OrderDetails): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const title = `Order ${orderNo(order.id)}`;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.text(title, 14, 17);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${order.status}  •  ${order.exhibitionId == null ? 'Direct order' : (order.exhibitionName ?? 'Exhibition')}`, 14, 23);
  autoTable(doc, { startY: 28, head: [['Customer', 'Contact', 'Phone', 'City', 'Created', 'Confirmed']], body: [[order.customerName, order.contactName ?? '—', order.phone ?? '—', order.city ?? '—', date(order.createdAt), date(order.confirmedAt)]], theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5 }, headStyles: { fillColor: [63, 52, 42] } });
  const yItems = (doc as any).lastAutoTable.finalY + 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Jewelry items', 14, yItems);
  autoTable(doc, { startY: yItems + 3, head: [['Item', 'Description', 'Gross wt. (g)', 'Net wt. (g)', 'Diamonds', 'Stones', 'Calculated price', 'Agreed price']], body: order.items.map((item) => {
    const row = itemRow(item);
    return [item.itemNumber, row['Description'], row['Gross weight (g)'] === '—' ? '—' : number(row['Gross weight (g)']), row['Net gold weight (g)'] === '—' ? '—' : number(row['Net gold weight (g)']), row['Diamond details'], row['Stone details'], row['Calculated price'], row['Agreed price']];
  }), theme: 'grid', styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak', valign: 'top' }, headStyles: { fillColor: [63, 52, 42] }, columnStyles: { 1: { cellWidth: 45 }, 4: { cellWidth: 34 }, 5: { cellWidth: 32 } }, didDrawPage: () => { doc.setFontSize(8); doc.text(title, 14, 7); } });
  let y = (doc as any).lastAutoTable.finalY + 8;
  if (y > 165) { doc.addPage(); y = 16; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Order totals', 14, y);
  autoTable(doc, { startY: y + 3, head: [['Item count', 'Final order value', 'Payment received', 'Payment pending']], body: [[String(order.items.length), money(order.totalValuePaise), money(order.paymentReceivedPaise), money(order.paymentPendingPaise)]], theme: 'grid', styles: { fontSize: 9, cellPadding: 3 }, headStyles: { fillColor: [63, 52, 42] } });
  const calculated = order.items.filter(hasBreakdown);
  y = (doc as any).lastAutoTable.finalY + 7;
  if (y > 165) { doc.addPage(); y = 16; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Price breakdown summary', 14, y);
  const sum = (field: string) => calculated.reduce((total, item) => total + n(item.pricingBreakdown?.[field]), 0);
  autoTable(doc, { startY: y + 3, head: [['Gold', 'Wastage', 'Extra cost', 'Certification', 'GST', 'Calculated total (priced items)']], body: [[money(sum('gold_value_paise')), money(sum('wastage_value_paise')), money(sum('extra_cost_paise')), money(sum('certification_value_paise')), money(sum('gst_value_paise')), money(sum('calculated_total_paise'))]], theme: 'grid', styles: { fontSize: 8, cellPadding: 2.5 }, headStyles: { fillColor: [63, 52, 42] } });
  if (order.items.some((item) => !hasBreakdown(item))) { const yy = (doc as any).lastAutoTable.finalY + 5; doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.text('Items entered as a direct final amount do not have a saved component breakdown; those values are excluded from the component totals.', 14, yy, { maxWidth: 265 }); }
  if (order.notes) { const yy = Math.min((doc as any).lastAutoTable.finalY + 13, 195); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text('Notes:', 14, yy); doc.setFont('helvetica', 'normal'); doc.text(order.notes, 27, yy, { maxWidth: 255 }); }
  const bytes = new Uint8Array(doc.output('arraybuffer'));
  await saveBytes(`${orderNo(order.id)}_report.pdf`, 'pdf', bytes);
}
