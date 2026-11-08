import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFontUrl from '../../assets/fonts/DejaVuSans.ttf?url';
import boldFontUrl from '../../assets/fonts/DejaVuSans-Bold.ttf?url';
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

const exportBaseName = (order: OrderDetails) => {
  const customer = order.customerName
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\\s+/g, ' ')
    .trim() || 'Customer';
  return `${customer} - ${orderNo(order.id)}`;
};

async function loadPdfFont(pdf: jsPDF, url: string, filename: string, style: 'normal' | 'bold') {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load PDF font: ${filename}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  pdf.addFileToVFS(filename, btoa(binary));
  pdf.addFont(filename, 'InventoryUnicode', style);
}
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

function materialTypeKey(kind: 'diamond' | 'stone', line: Record<string, any>): string {
  if (kind === 'diamond') {
    return `${String(line.shape ?? 'Diamond').trim()}|${String(line.quality ?? '').trim()}`;
  }
  return String(line.stone ?? 'Stone').trim();
}

function materialTypeLabel(kind: 'diamond' | 'stone', key: string): string {
  if (kind === 'stone') return key;
  const [shape, quality] = key.split('|');
  return quality ? `${shape} · ${quality}` : shape;
}

function getPdfMaterialTypes(order: OrderDetails, kind: 'diamond' | 'stone') {
  const types = new Map<string, string>();
  for (const item of order.items) {
    const snapshotLines = arr(kind === 'diamond' ? item.itemSnapshot?.diamonds : item.itemSnapshot?.stones);
    const breakdownLines = arr(kind === 'diamond' ? item.pricingBreakdown?.diamond_lines : item.pricingBreakdown?.stone_lines);
    for (const line of [...snapshotLines, ...breakdownLines]) {
      const key = materialTypeKey(kind, line);
      if (!types.has(key)) types.set(key, materialTypeLabel(kind, key));
    }
  }
  return [...types.entries()].map(([key, label]) => ({ key, label }));
}

type PdfMaterialCell = {
  weight: string;
  cost: string;
  rate: string;
  rawWeight: number;
  costPaise: number;
  pieceCount: number;
};

function getPdfMaterialCell(item: OrderDetailItem, kind: 'diamond' | 'stone', key: string): PdfMaterialCell {
  const snapshotLines = arr(kind === 'diamond' ? item.itemSnapshot?.diamonds : item.itemSnapshot?.stones);
  const breakdownLines = arr(kind === 'diamond' ? item.pricingBreakdown?.diamond_lines : item.pricingBreakdown?.stone_lines);
  const snapshot = snapshotLines.find((line) => materialTypeKey(kind, line) === key);
  const breakdown = breakdownLines.find((line) => materialTypeKey(kind, line) === key);
  // Missing material types are displayed as dashes on the item row, but
  // contribute numeric zeroes to the per-type totals below.
  if (!snapshot && !breakdown) {
    return {
      weight: '—',
      rate: '—',
      cost: '—',
      rawWeight: 0,
      costPaise: 0,
      pieceCount: 0,
    };
  }

  const rawWeight = kind === 'diamond'
    ? (breakdown?.weight_ct ?? (breakdown?.weightMilliCarats != null ? n(breakdown.weightMilliCarats) / 1000 : breakdown?.weightMilli != null ? n(breakdown.weightMilli) / 1000 : snapshot?.weightMilliCarats != null ? n(snapshot.weightMilliCarats) / 1000 : snapshot?.weightMilli != null ? n(snapshot.weightMilli) / 1000 : null))
    : (breakdown?.weight ?? (breakdown?.weightMilli != null ? n(breakdown.weightMilli) / 1000 : snapshot?.weightMilli != null ? n(snapshot.weightMilli) / 1000 : null));
  const unit = kind === 'diamond' ? 'ct' : String(breakdown?.unit ?? breakdown?.weightUnit ?? snapshot?.weightUnit ?? 'ct');
  const pieceCount = pieces(item, kind, breakdown ?? snapshot ?? {});
  const weight = rawWeight == null
    ? '—'
    : `${number(rawWeight, unit.toLowerCase() === 'ct' ? 2 : 3)} ${unit}${pieceCount == null ? '' : ` (${pieceCount} pcs)`}`;
  const costPaise = breakdown?.value_paise == null ? null : n(breakdown.value_paise);
  const ratePaise = kind === 'diamond'
    ? (breakdown?.rate_paise_per_ct == null ? null : n(breakdown.rate_paise_per_ct))
    : (breakdown?.rate_paise_per_unit == null ? null : n(breakdown.rate_paise_per_unit));
  const cost = costPaise == null ? '—' : money(costPaise);
  const rate = ratePaise == null ? '—' : money(ratePaise);
  return { weight, cost, rate, rawWeight: rawWeight == null ? 0 : n(rawWeight), costPaise: costPaise ?? 0, pieceCount: pieceCount ?? 0 };
}

function uniqueRateText(values: number[], suffix: string): string {
  const unique = [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
  if (!unique.length) return 'Rate not saved';
  if (unique.length > 1) return 'Multiple rates';
  return `${money(unique[0])}${suffix}`;
}

function goldHeaderRates(order: OrderDetails) {
  const items = order.items.filter(hasBreakdown);
  const goldRates = items
    .map((item) => n(item.pricingBreakdown?.gold_rate_paise_per_g))
    .filter((rate) => rate > 0);

  const wastageModes = items.map((item) => {
    const b = item.pricingBreakdown ?? {};
    const snapshot = b.rates_snapshot ?? {};
    const mode = b.wastage_mode ?? snapshot.wastageMode;
    if (mode === 'percent') {
      const percentBp = Number(snapshot.wastagePercentBp);
      return Number.isFinite(percentBp) && percentBp > 0
        ? `${number(percentBp / 100, 2)}%`
        : 'Wastage rate not saved';
    }
    if (mode === 'per_g') {
      const paisePerGram = Number(snapshot.wastagePaisePerGram);
      return Number.isFinite(paisePerGram) && paisePerGram > 0
        ? `${money(paisePerGram)}/g`
        : 'Wastage rate not saved';
    }
    return 'Wastage rate not saved';
  });
  const uniqueWastage = [...new Set(wastageModes)];

  return {
    goldRate: uniqueRateText(goldRates, '/g'),
    wastageRate: uniqueWastage.length === 1 ? uniqueWastage[0] : uniqueWastage.length ? 'Multiple rates' : 'Wastage rate not saved',
  };
}

function materialRateText(order: OrderDetails, kind: 'diamond' | 'stone', key: string): string {
  const matching = order.items.flatMap((item) => {
    const lines = arr(kind === 'diamond' ? item.pricingBreakdown?.diamond_lines : item.pricingBreakdown?.stone_lines);
    return lines
      .filter((line) => materialTypeKey(kind, line) === key)
      .map((line) => ({
        rate: kind === 'diamond' ? n(line.rate_paise_per_ct) : n(line.rate_paise_per_unit),
        unit: kind === 'diamond'
          ? 'ct'
          : String(line.unit ?? line.weightUnit ?? arr(item.itemSnapshot?.stones).find((entry) => materialTypeKey('stone', entry) === key)?.weightUnit ?? 'ct'),
      }))
      .filter((entry) => entry.rate > 0);
  });
  const units = [...new Set(matching.map((entry) => entry.unit))];
  const rates = matching.map((entry) => entry.rate);
  const suffix = units.length === 1 ? `/${units[0]}` : '/unit';
  return uniqueRateText(rates, suffix);
}

function materialRatesSubtitle(order: OrderDetails, kind: 'diamond' | 'stone', types: { key: string; label: string }[]): string {
  return types.map((type) => `${type.label}: ${materialRateText(order, kind, type.key)}`).join('  ·  ');
}

function certificationRateText(order: OrderDetails): string {
  const rates = order.items.filter(hasBreakdown).map((item) => {
    const snapshot = item.pricingBreakdown?.rates_snapshot ?? {};
    return Number(snapshot.certificationPaisePerCarat);
  }).filter((rate) => Number.isFinite(rate) && rate > 0);
  return uniqueRateText(rates, '/ct');
}

function purityLabel(item: OrderDetailItem): string {
  const b = item.pricingBreakdown ?? {};
  const karat = String(item.itemSnapshot?.purity ?? '—');
  const percent = b.purity_percent_bp == null ? null : Number(b.purity_percent_bp) / 100;
  return percent == null || !Number.isFinite(percent)
    ? karat
    : `${karat} (${number(percent, 2)}%)`;
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
    'Diamond details': diamonds.map((d) => `${d.shape ?? 'Diamond'}${d.quality ? ` / ${d.quality}` : ''}: ${number(n(d.weightMilliCarats ?? d.weightMilli) / 1000, 2)} ct${d.pieces == null ? '' : ` (${d.pieces} pcs)`}`).join('\n') || '—',
    'Stone details': stones.map((s) => `${s.stone ?? 'Stone'}: ${number(n(s.weightMilli) / 1000, String(s.weightUnit ?? 'ct').toLowerCase() === 'ct' ? 2 : 3)} ${s.weightUnit ?? 'ct'}${s.pieces == null ? '' : ` (${s.pieces} pcs)`}`).join('\n') || '—',
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
        'Weight': isDiamond ? number(line.weight_ct ?? n(line.weightMilliCarats ?? line.weightMilli) / 1000, 2) : number(line.weight ?? n(line.weightMilli) / 1000, String(line.unit ?? line.weightUnit ?? 'ct').toLowerCase() === 'ct' ? 2 : 3),
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
function styleSheet(ws: XLSX.WorkSheet, headerRow = 0) {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
  ws['!cols'] = Array.from({ length: range.e.c + 1 }, (_, col) => {
    let width = 14;
    for (let row = range.s.r; row <= Math.min(range.e.r, 20); row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
      width = Math.max(width, Math.min(42, String(cell?.v ?? '').split('\\n').reduce((max, line) => Math.max(max, line.length), 0) + 2));
    }
    return { wch: width };
  });

  // Keep the column headings consistent across every worksheet. Do not add
  // AutoFilter: its filter controls create dropdown arrows in the headings.
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c: col })];
    if (cell) {
      cell.s = {
        fill: { fgColor: { rgb: 'F4EFE8' } },
        font: { bold: true, color: { rgb: '302B26' } },
        alignment: { vertical: 'center', wrapText: true },
        border: { bottom: { style: 'thin', color: { rgb: 'D3CCC3' } } },
      };
    }
  }
  ws['!rows'] = ws['!rows'] ?? [];
  ws['!rows'][headerRow] = { hpt: 30 };
}

export async function exportOrderExcel(order: OrderDetails): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([[`Order ${orderNo(order.id)}`], ['Field', 'Value'], ...orderSummary(order).map((r) => [r.Field, r.Value])]);
  const items = order.items.map(itemRow).map(({ __diamondWeight: _dw, __stoneWeight: _sw, ...row }) => row);
  const itemSheet = XLSX.utils.json_to_sheet(items.length ? items : [{ 'Item number': 'No items' }]);
  const priceSheet = XLSX.utils.json_to_sheet(pricingRows(order).length ? pricingRows(order) : [{ 'Item number': 'No items' }]);
  const diamondSheet = XLSX.utils.json_to_sheet(materialRows(order, 'diamond').length ? materialRows(order, 'diamond') : [{ 'Type / quality': 'No saved diamond breakdowns' }]);
  const stoneSheet = XLSX.utils.json_to_sheet(materialRows(order, 'stone').length ? materialRows(order, 'stone') : [{ 'Type / quality': 'No saved stone breakdowns' }]);
  styleSheet(summary, 1);
  [itemSheet, priceSheet, diamondSheet, stoneSheet].forEach((sheet) => styleSheet(sheet, 0));
  summary['A1'].s = {
    font: { bold: true, sz: 16, color: { rgb: '302B26' } },
    alignment: { vertical: 'center' },
  };
  summary['!rows'] = [{ hpt: 28 }, { hpt: 30 }];
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
  await saveBytes(`${exportBaseName(order)}.xlsx`, 'xlsx', bytes);
}
export async function exportOrderPdf(order: OrderDetails): Promise<void> {
  // Use the same typography, warm neutral palette, and restrained table styling
  // as the Inventory and Customer exports.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  await Promise.all([
    loadPdfFont(doc, regularFontUrl, 'DejaVuSans.ttf', 'normal'),
    loadPdfFont(doc, boldFontUrl, 'DejaVuSans-Bold.ttf', 'bold'),
  ]);

  const title = `Order ${orderNo(order.id)}`;
  const subtitle = `${order.status} · ${order.exhibitionId == null ? 'Direct order' : (order.exhibitionName ?? 'Exhibition')}`;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 28;
  const tableTheme = {
    theme: 'grid' as const,
    styles: {
      font: 'InventoryUnicode',
      fontSize: 7,
      cellPadding: 4,
      overflow: 'linebreak' as const,
      valign: 'top' as const,
      lineColor: [211, 205, 197] as [number, number, number],
      lineWidth: 0.35,
      textColor: [48, 43, 38] as [number, number, number],
    },
    headStyles: {
      font: 'InventoryUnicode',
      fillColor: [244, 239, 232] as [number, number, number],
      textColor: [48, 43, 38] as [number, number, number],
      fontStyle: 'bold' as const,
      lineColor: [211, 204, 195] as [number, number, number],
      lineWidth: 0.3,
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [250, 249, 247] as [number, number, number] },
    margin: { top: 101, left: margin, right: margin },
  };

  const drawPageHeading = () => {
    doc.setFont('InventoryUnicode', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(48, 43, 38);
    doc.text(title, margin, 36);
    doc.setFont('InventoryUnicode', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(92, 84, 76);
    doc.text(subtitle, margin, 51);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('Customer:', margin, 65);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(order.customerName || '—', margin + 48, 65);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('Contact:', margin + 250, 65);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(order.contactName || '—', margin + 292, 65);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('Phone:', margin + 450, 65);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(order.phone || '—', margin + 486, 65);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('City:', margin + 620, 65);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(order.city || '—', margin + 646, 65);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('Created:', margin, 78);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(date(order.createdAt), margin + 48, 78);
    doc.setFont('InventoryUnicode', 'bold');
    doc.text('Confirmed:', margin + 250, 78);
    doc.setFont('InventoryUnicode', 'normal');
    doc.text(date(order.confirmedAt), margin + 310, 78);
    doc.setDrawColor(211, 205, 197);
    doc.setLineWidth(0.6);
    doc.line(margin, 86, pageWidth - margin, 86);
  };

  const sectionTitle = (label: string, y: number, subtitleText = '') => {
    const titleHeight = subtitleText ? 34 : 28;
    if (y + titleHeight > pageHeight - margin) {
      doc.addPage();
      drawPageHeading();
      y = 101;
    }
    doc.setFont('InventoryUnicode', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(48, 43, 38);
    doc.text(label, margin, y);
    if (subtitleText) {
      doc.setFont('InventoryUnicode', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(105, 96, 87);
      const subtitleLines = doc.splitTextToSize(subtitleText, pageWidth - margin * 2);
      doc.text(subtitleLines, margin, y + 11);
      return y + 14 + subtitleLines.length * 8;
    }
    return y + 8;
  };

  drawPageHeading();

  let y = 101;

  const calculated = order.items.filter(hasBreakdown);
  const sum = (field: string) => calculated.reduce((total, item) => total + n(item.pricingBreakdown?.[field]), 0);
  const drawTable = (heading: string, head: string[], body: (string | number)[][], startAt: number, options: Record<string, any> = {}, subtitleText = '') => {
    const tableY = sectionTitle(heading, startAt, subtitleText);
    autoTable(doc, {
      ...tableTheme,
      startY: tableY,
      head: [head],
      body,
      styles: { ...tableTheme.styles, fontSize: 7, cellPadding: 4 },
      headStyles: { ...tableTheme.headStyles, fontSize: 7, cellPadding: 4 },
      didDrawPage: () => drawPageHeading(),
      ...options,
      didParseCell: (data: any) => {
        if (data.section === 'body' && body[data.row.index]?.[0] === 'TOTAL') {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    return (doc as any).lastAutoTable.finalY + 14;
  };

  const drawMaterialTable = (
    heading: string,
    head: any[][],
    body: (string | number)[][],
    startAt: number,
    typeCount: number,
    subtitleText = '',
  ) => {
    const tableY = sectionTitle(heading, startAt, subtitleText);
    const columnCount = 1 + typeCount * 2;
    const fontSize = columnCount > 13 ? 4.8 : columnCount > 9 ? 5.5 : columnCount > 5 ? 6.2 : 7;
    autoTable(doc, {
      ...tableTheme,
      startY: tableY,
      head,
      body: body.length ? body : [['—', 'No calculations available']],
      styles: { ...tableTheme.styles, fontSize, cellPadding: columnCount > 9 ? 2.2 : 3, halign: 'center' },
      headStyles: { ...tableTheme.headStyles, fontSize, cellPadding: columnCount > 9 ? 2.2 : 3 },
      columnStyles: { 0: { cellWidth: 48, halign: 'left' } },
      didDrawPage: () => drawPageHeading(),
      didParseCell: (data: any) => {
        if (data.section === 'body' && body[data.row.index]?.[0] === 'TOTAL') {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    return (doc as any).lastAutoTable.finalY + 14;
  };

  // 1. Gold calculations — show shared gold and wastage rates in the section heading.
  const grossWeightTotal = order.items.reduce((total, item) => total + (item.grossWeightMilli == null ? 0 : item.grossWeightMilli / 1000), 0);
  const netWeightTotal = order.items.reduce((total, item) => total + (item.netWeightMilli == null ? 0 : item.netWeightMilli / 1000), 0);
  const goldRates = goldHeaderRates(order);
  const goldHeading = '1. Gold calculations';
  const goldSubtitle = `Gold rate: ${goldRates.goldRate}   ·   Wastage: ${goldRates.wastageRate}`;
  const goldBody = order.items.map((item) => {
    const b = item.pricingBreakdown ?? {};
    return [
      item.itemNumber,
      item.category || '—',
      item.grossWeightMilli == null ? '—' : number(item.grossWeightMilli / 1000),
      b.net_gold_g == null ? (item.netWeightMilli == null ? '—' : number(item.netWeightMilli / 1000)) : number(b.net_gold_g),
      purityLabel(item),
      hasBreakdown(item) ? money(b.gold_value_paise) : '—',
      hasBreakdown(item) ? money(b.wastage_value_paise) : '—',
    ];
  });
  goldBody.push([
    'TOTAL', '', number(grossWeightTotal), number(netWeightTotal), '', money(sum('gold_value_paise')), money(sum('wastage_value_paise')),
  ]);
  y = drawTable(
    goldHeading,
    ['Item', 'Category', 'Gross wt. (g)', 'Net gold wt. (g)', 'Purity', 'Gold value', 'Wastage'],
    goldBody,
    y,
    { styles: { ...tableTheme.styles, fontSize: 6.8, cellPadding: 4 }, columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 62 } } },
    goldSubtitle,
  );

  // 2. Diamond calculations — diamond rates are shown once in the section details.
  const diamondTypes = getPdfMaterialTypes(order, 'diamond');
  const diamondHead = diamondTypes.length
    ? [
        [
          { content: 'Item', rowSpan: 2, styles: { valign: 'middle' } },
          ...diamondTypes.map((type) => ({ content: type.label, colSpan: 2, styles: { halign: 'center' } })),
        ],
        diamondTypes.flatMap(() => [
          { content: 'Weight (ct)', styles: { halign: 'center' } },
          { content: 'Total cost', styles: { halign: 'center' } },
        ]),
      ]
    : [['Item', 'Diamond calculations']];
  const diamondBody: (string | number)[][] = order.items.map((item) => diamondTypes.length
    ? [item.itemNumber, ...diamondTypes.flatMap((type) => {
        const cell = getPdfMaterialCell(item, 'diamond', type.key);
        return [cell.weight, cell.cost];
      })]
    : [item.itemNumber, 'No diamond details']);
  if (diamondTypes.length) {
    diamondBody.push(['TOTAL', ...diamondTypes.flatMap((type) => {
      const cells = order.items.map((item) => getPdfMaterialCell(item, 'diamond', type.key));
      const totalWeight = cells.reduce((sum, cell) => sum + (cell.rawWeight ?? 0), 0);
      const totalPieces = cells.reduce((sum, cell) => sum + (cell.pieceCount ?? 0), 0);
      const totalCost = cells.reduce((sum, cell) => sum + (cell.costPaise ?? 0), 0);
      return [totalWeight ? `${number(totalWeight, 2)} ct${totalPieces ? ` (${totalPieces} pcs)` : ''}` : '—', money(totalCost)];
    })]);
  }
  y = drawMaterialTable('2. Diamond calculations', diamondHead, diamondBody, y, diamondTypes.length, materialRatesSubtitle(order, 'diamond', diamondTypes));

  // 3. Stone calculations — rates are shown once in the section details.
  const stoneTypes = getPdfMaterialTypes(order, 'stone');
  const stoneHead = stoneTypes.length
    ? [
        [
          { content: 'Item', rowSpan: 2, styles: { valign: 'middle' } },
          ...stoneTypes.map((type) => ({ content: type.label, colSpan: 2, styles: { halign: 'center' } })),
        ],
        stoneTypes.flatMap(() => [
          { content: 'Weight (ct)', styles: { halign: 'center' } },
          { content: 'Total cost', styles: { halign: 'center' } },
        ]),
      ]
    : [['Item', 'Stone calculations']];
  const stoneBody: (string | number)[][] = order.items.map((item) => stoneTypes.length
    ? [item.itemNumber, ...stoneTypes.flatMap((type) => {
        const cell = getPdfMaterialCell(item, 'stone', type.key);
        return [cell.weight, cell.cost];
      })]
    : [item.itemNumber, 'No stone details']);
  if (stoneTypes.length) {
    stoneBody.push(['TOTAL', ...stoneTypes.flatMap((type) => {
      const cells = order.items.map((item) => getPdfMaterialCell(item, 'stone', type.key));
      const totalWeight = cells.reduce((sum, cell) => sum + (cell.rawWeight ?? 0), 0);
      const totalPieces = cells.reduce((sum, cell) => sum + (cell.pieceCount ?? 0), 0);
      const totalCost = cells.reduce((sum, cell) => sum + (cell.costPaise ?? 0), 0);
      return [totalWeight ? `${number(totalWeight, 2)} ct${totalPieces ? ` (${totalPieces} pcs)` : ''}` : '—', money(totalCost)];
    })]);
  }
  y = drawMaterialTable('3. Stone calculations', stoneHead, stoneBody, y, stoneTypes.length, materialRatesSubtitle(order, 'stone', stoneTypes));


  // 4. Other charges — certification, extra cost, subtotal before GST, GST, and calculated price.
  const chargesBody = order.items.map((item) => {
    const b = item.pricingBreakdown ?? {};
    return [
      item.itemNumber,
      hasBreakdown(item) ? money(b.certification_value_paise) : '—',
      hasBreakdown(item) ? money(b.extra_cost_paise) : '—',
      hasBreakdown(item) ? money(b.subtotal_paise) : '—',
      hasBreakdown(item) ? money(b.gst_value_paise) : '—',
      hasBreakdown(item) ? money(b.calculated_total_paise) : '—',
    ];
  });
  chargesBody.push([
    'TOTAL',
    money(sum('certification_value_paise')),
    money(sum('extra_cost_paise')),
    money(sum('subtotal_paise')),
    money(sum('gst_value_paise')),
    money(sum('calculated_total_paise')),
  ]);
  y = drawTable(
    '4. Other charges',
    ['Item', 'Certification', 'Extra cost', 'Subtotal before GST', 'GST', 'Calculated price'],
    chargesBody,
    y,
    { styles: { ...tableTheme.styles, fontSize: 7, cellPadding: 5 }, headStyles: { ...tableTheme.headStyles, fontSize: 7, cellPadding: 5 } },
    `Certification rate: ${certificationRateText(order)}`,
  );

  if (order.items.some((item) => !hasBreakdown(item))) {
    const note = 'Items entered as a direct final amount do not have a saved component breakdown; component values are shown as dashes for those items.';
    if (y + 28 > pageHeight - margin) {
      doc.addPage();
      drawPageHeading();
      y = 80;
    }
    doc.setFont('InventoryUnicode', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(92, 84, 76);
    const lines = doc.splitTextToSize(note, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 9 + 8;
  }

  const calculatedItemTotal = order.items.reduce((total, item) => total + (hasBreakdown(item) ? n(item.pricingBreakdown?.calculated_total_paise) : n(item.agreedPricePaise)), 0);
  const roundingAdjustment = n(order.totalValuePaise) - calculatedItemTotal;
  const orderTotalRows: (string | number)[][] = order.items.map((item) => [
    item.itemNumber,
    hasBreakdown(item) ? money(item.pricingBreakdown?.calculated_total_paise) : money(item.agreedPricePaise),
  ]);
  orderTotalRows.push(['TOTAL', money(calculatedItemTotal)]);
  if (roundingAdjustment !== 0) orderTotalRows.push(['Rounding adjustment', money(order.totalValuePaise)]);

  // Keep the Order totals heading and table together when they fit on a fresh page.
  // This avoids leaving a partial table at the bottom of the previous page.
  const estimatedOrderTotalsHeight = 34 + orderTotalRows.length * 18;
  if (y + 8 + estimatedOrderTotalsHeight > pageHeight - margin) {
    doc.addPage();
    drawPageHeading();
    y = 101;
  }
  y = sectionTitle('5. Order totals', y + 8);
  autoTable(doc, {
    ...tableTheme,
    startY: y,
    head: [['Item no.', 'Calculated price']],
    body: orderTotalRows,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    styles: { ...tableTheme.styles, fontSize: 8, cellPadding: 5 },
    didDrawPage: () => drawPageHeading(),
    columnStyles: { 0: { cellWidth: 180 } },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.row.index >= order.items.length) {
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  if (order.notes) {
    y = (doc as any).lastAutoTable.finalY + 14;
    if (y + 28 > pageHeight - margin) {
      doc.addPage();
      drawPageHeading();
      y = 80;
    }
    doc.setFont('InventoryUnicode', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(48, 43, 38);
    doc.text('Notes', margin, y);
    doc.setFont('InventoryUnicode', 'normal');
    doc.setFontSize(8);
    const noteLines = doc.splitTextToSize(order.notes, pageWidth - margin * 2);
    doc.text(noteLines, margin, y + 12);
  }

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  await saveBytes(`${exportBaseName(order)}.pdf`, 'pdf', bytes);
}
