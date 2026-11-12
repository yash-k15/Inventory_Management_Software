import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFontUrl from '../../assets/fonts/DejaVuSans.ttf?url';
import boldFontUrl from '../../assets/fonts/DejaVuSans-Bold.ttf?url';
import type { OrderDetails, OrderDetailItem } from './orders.queries';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (paise: unknown) =>
  typeof paise === 'number' && Number.isFinite(paise)
    ? currency.format(paise / 100)
    : 'Not available';
const number = (value: unknown, digits = 3) =>
  value == null || value === '' || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toFixed(digits);
const date = (value: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
};
const orderNo = (id: number) => `ORD-${String(id).padStart(4, '0')}`;

const exportBaseName = (order: OrderDetails) => {
  const customer =
    order.customerName
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\\s+/g, ' ')
      .trim() || 'Customer';
  return `${customer} - ${orderNo(order.id)}`;
};

async function loadPdfFont(
  pdf: jsPDF,
  url: string,
  filename: string,
  style: 'normal' | 'bold',
) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load PDF font: ${filename}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  pdf.addFileToVFS(filename, btoa(binary));
  pdf.addFont(filename, 'InventoryUnicode', style);
}
const arr = (value: unknown): Record<string, any>[] =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === 'object') : [];
const n = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.isFinite(Number(value))
      ? Number(value)
      : 0;
const hasBreakdown = (item: OrderDetailItem) =>
  item.pricingBreakdown?.breakdown_available !== false &&
  item.pricingBreakdown?.source !== 'direct' &&
  typeof item.pricingBreakdown?.calculated_total_paise === 'number';
function pieces(
  item: OrderDetailItem,
  kind: 'diamond' | 'stone',
  line: Record<string, any>,
): number | null {
  if (typeof line.pieces === 'number') return line.pieces;
  if (typeof line.piece_count === 'number') return line.piece_count;
  const source = arr(
    kind === 'diamond'
      ? item.itemSnapshot?.diamonds
      : item.itemSnapshot?.stones,
  );
  const match = source.find((entry) =>
    kind === 'diamond'
      ? String(entry.shape ?? '') === String(line.shape ?? '') &&
        String(entry.quality ?? '') === String(line.quality ?? '')
      : String(entry.stone ?? '') === String(line.stone ?? ''),
  );
  return match?.pieces == null || !Number.isFinite(Number(match.pieces))
    ? null
    : Number(match.pieces);
}

function materialTypeKey(
  kind: 'diamond' | 'stone',
  line: Record<string, any>,
): string {
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
    const snapshotLines = arr(
      kind === 'diamond'
        ? item.itemSnapshot?.diamonds
        : item.itemSnapshot?.stones,
    );
    const breakdownLines = arr(
      kind === 'diamond'
        ? item.pricingBreakdown?.diamond_lines
        : item.pricingBreakdown?.stone_lines,
    );
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

function getPdfMaterialCell(
  item: OrderDetailItem,
  kind: 'diamond' | 'stone',
  key: string,
): PdfMaterialCell {
  const snapshotLines = arr(
    kind === 'diamond'
      ? item.itemSnapshot?.diamonds
      : item.itemSnapshot?.stones,
  );
  const breakdownLines = arr(
    kind === 'diamond'
      ? item.pricingBreakdown?.diamond_lines
      : item.pricingBreakdown?.stone_lines,
  );
  const snapshot = snapshotLines.find(
    (line) => materialTypeKey(kind, line) === key,
  );
  const breakdown = breakdownLines.find(
    (line) => materialTypeKey(kind, line) === key,
  );
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

  const rawWeight =
    kind === 'diamond'
      ? (breakdown?.weight_ct ??
        (breakdown?.weightMilliCarats != null
          ? n(breakdown.weightMilliCarats) / 1000
          : breakdown?.weightMilli != null
            ? n(breakdown.weightMilli) / 1000
            : snapshot?.weightMilliCarats != null
              ? n(snapshot.weightMilliCarats) / 1000
              : snapshot?.weightMilli != null
                ? n(snapshot.weightMilli) / 1000
                : null))
      : (breakdown?.weight_ct ??
        breakdown?.weight ??
        (breakdown?.weightMilli != null
          ? n(breakdown.weightMilli) / 1000
          : snapshot?.weightMilli != null
            ? n(snapshot.weightMilli) / 1000
            : null));
  // Diamond and other-stone weights are both stored and exported in carats.
  const unit = 'ct';
  const pieceCount = pieces(item, kind, breakdown ?? snapshot ?? {});
  const weight =
    rawWeight == null
      ? '—'
      : `${number(rawWeight, 2)} ${unit}${pieceCount == null ? '' : ` (${pieceCount} pcs)`}`;
  const costPaise =
    breakdown?.value_paise == null ? null : n(breakdown.value_paise);
  // Older saved order snapshots used rate_paise_per_unit; retain that
  // fallback for historical exports while all stone rates are now per ct.
  const ratePaise =
    kind === 'diamond'
      ? breakdown?.rate_paise_per_ct == null
        ? null
        : n(breakdown.rate_paise_per_ct)
      : (breakdown?.rate_paise_per_ct ?? breakdown?.rate_paise_per_unit) == null
        ? null
        : n(breakdown?.rate_paise_per_ct ?? breakdown?.rate_paise_per_unit);
  const cost = costPaise == null ? '—' : money(costPaise);
  const rate = ratePaise == null ? '—' : money(ratePaise);
  return {
    weight,
    cost,
    rate,
    rawWeight: rawWeight == null ? 0 : n(rawWeight),
    costPaise: costPaise ?? 0,
    pieceCount: pieceCount ?? 0,
  };
}

function uniqueRateText(values: number[], suffix: string): string {
  const unique = [
    ...new Set(values.filter((value) => Number.isFinite(value) && value > 0)),
  ];
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
    wastageRate:
      uniqueWastage.length === 1
        ? uniqueWastage[0]
        : uniqueWastage.length
          ? 'Multiple rates'
          : 'Wastage rate not saved',
  };
}

function materialRateText(
  order: OrderDetails,
  kind: 'diamond' | 'stone',
  key: string,
): string {
  const matching = order.items.flatMap((item) => {
    const lines = arr(
      kind === 'diamond'
        ? item.pricingBreakdown?.diamond_lines
        : item.pricingBreakdown?.stone_lines,
    );
    return lines
      .filter((line) => materialTypeKey(kind, line) === key)
      .map((line) => ({
        rate:
          kind === 'diamond'
            ? n(line.rate_paise_per_ct)
            : n(line.rate_paise_per_ct ?? line.rate_paise_per_unit),
        unit: 'ct',
      }))
      .filter((entry) => entry.rate > 0);
  });
  const rates = matching.map((entry) => entry.rate);
  return uniqueRateText(rates, '/ct');
}

function materialRatesSubtitle(
  order: OrderDetails,
  kind: 'diamond' | 'stone',
  types: { key: string; label: string }[],
): string {
  return types
    .map((type) => `${type.label}: ${materialRateText(order, kind, type.key)}`)
    .join('  ·  ');
}

function certificationRateText(order: OrderDetails): string {
  const rates = order.items
    .filter(hasBreakdown)
    .map((item) => {
      const snapshot = item.pricingBreakdown?.rates_snapshot ?? {};
      return Number(snapshot.certificationPaisePerCarat);
    })
    .filter((rate) => Number.isFinite(rate) && rate > 0);
  return uniqueRateText(rates, '/ct');
}

function purityLabel(item: OrderDetailItem): string {
  const b = item.pricingBreakdown ?? {};
  const karat = String(item.itemSnapshot?.purity ?? '—');
  const percent =
    b.purity_percent_bp == null ? null : Number(b.purity_percent_bp) / 100;
  return percent == null || !Number.isFinite(percent)
    ? karat
    : `${karat} (${number(percent, 2)}%)`;
}

function saveBytes(
  filename: string,
  format: 'xlsx' | 'pdf',
  bytes: Uint8Array,
) {
  return (async () => {
    const path = await save({
      defaultPath: filename,
      filters: [
        {
          name: format === 'xlsx' ? 'Excel workbook' : 'PDF document',
          extensions: [format],
        },
      ],
    });
    if (!path) return;
    await invoke('write_export_file', { path, bytes: Array.from(bytes) });
  })();
}
export async function exportOrderExcel(order: OrderDetails): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const rows: (string | number | null)[][] = [];
  const merges: XLSX.Range[] = [];
  const sectionRows: number[] = [];
  const tableHeaderRows: number[] = [];
  const totalRows: number[] = [];
  const subtitleRows: number[] = [];
  const currencyCells: string[] = [];
  const weightCells: string[] = [];
  const boldRows: number[] = [];
  const columnCount = Math.max(
    7,
    1 + getPdfMaterialTypes(order, 'diamond').length * 3,
    1 + getPdfMaterialTypes(order, 'stone').length * 3,
    6,
  );
  const add = (values: (string | number | null)[]) => {
    const row = rows.length;
    rows.push(values);
    return row;
  };
  const addSection = (title: string, subtitle = '') => {
    const titleRow = add([title]);
    sectionRows.push(titleRow);
    if (subtitle) {
      const subtitleRow = add([subtitle]);
      subtitleRows.push(subtitleRow);
    }
    return rows.length;
  };
  const moneyValue = (paise: unknown): number | null => {
    if (paise == null || !Number.isFinite(Number(paise))) return null;
    return Number(paise) / 100;
  };
  const markCurrency = (row: number, col: number) =>
    currencyCells.push(XLSX.utils.encode_cell({ r: row, c: col }));
  const markWeight = (row: number, col: number, unit = 'ct') =>
    weightCells.push(`${XLSX.utils.encode_cell({ r: row, c: col })}|${unit}`);
  const addTableHeader = (values: (string | number | null)[]) => {
    const row = add(values);
    tableHeaderRows.push(row);
    return row;
  };
  const addTotal = (values: (string | number | null)[]) => {
    const row = add(values);
    totalRows.push(row);
    return row;
  };

  // Order heading and customer details (kept as a compact page-style header).
  const titleRow = add([`Order ${orderNo(order.id)}`]);
  boldRows.push(titleRow);
  const sourceRow = add([
    `${order.status} · ${order.exhibitionId == null ? 'Direct order' : (order.exhibitionName ?? 'Exhibition')}`,
  ]);
  subtitleRows.push(sourceRow);
  const customerRow = add([
    `Customer: ${order.customerName || '—'}`,
    `Contact: ${order.contactName || '—'}`,
    `Phone: ${order.phone || '—'}`,
    `City: ${order.city || '—'}`,
  ]);
  const datesRow = add([
    `Created: ${date(order.createdAt)}`,
    `Confirmed: ${date(order.confirmedAt)}`,
  ]);
  boldRows.push(customerRow, datesRow);
  add([]);

  const calculated = order.items.filter(hasBreakdown);
  const sum = (field: string) =>
    calculated.reduce(
      (total, item) => total + n(item.pricingBreakdown?.[field]),
      0,
    );

  // 1. Gold calculations.
  const goldRates = goldHeaderRates(order);
  addSection(
    '1. Gold calculations',
    `Gold rate: ${goldRates.goldRate}  ·  Wastage: ${goldRates.wastageRate}`,
  );
  addTableHeader([
    'Item',
    'Category',
    'Gross wt. (g)',
    'Net gold wt. (g)',
    'Purity',
    'Gold value',
    'Wastage',
  ]);
  const grossWeightTotal = order.items.reduce(
    (total, item) =>
      total +
      (item.grossWeightMilli == null ? 0 : item.grossWeightMilli / 1000),
    0,
  );
  const netWeightTotal = order.items.reduce(
    (total, item) =>
      total + (item.netWeightMilli == null ? 0 : item.netWeightMilli / 1000),
    0,
  );
  order.items.forEach((item) => {
    const b = item.pricingBreakdown ?? {};
    const row = add([
      item.itemNumber,
      item.category || '—',
      item.grossWeightMilli == null ? null : item.grossWeightMilli / 1000,
      b.net_gold_g == null
        ? item.netWeightMilli == null
          ? null
          : item.netWeightMilli / 1000
        : n(b.net_gold_g),
      purityLabel(item),
      hasBreakdown(item) ? moneyValue(b.gold_value_paise) : null,
      hasBreakdown(item) ? moneyValue(b.wastage_value_paise) : null,
    ]);
    if (rows[row][2] != null) markWeight(row, 2, 'g');
    if (rows[row][3] != null) markWeight(row, 3, 'g');
    markCurrency(row, 5);
    markCurrency(row, 6);
  });
  const goldTotalRow = addTotal([
    'TOTAL',
    '',
    grossWeightTotal,
    netWeightTotal,
    '',
    moneyValue(sum('gold_value_paise')),
    moneyValue(sum('wastage_value_paise')),
  ]);
  markWeight(goldTotalRow, 2, 'g');
  markWeight(goldTotalRow, 3, 'g');
  markCurrency(goldTotalRow, 5);
  markCurrency(goldTotalRow, 6);
  add([]);

  // 2. Diamond calculations. One row per item; each type has its own grouped columns.
  const diamondTypes = getPdfMaterialTypes(order, 'diamond');
  addSection(
    '2. Diamond calculations',
    materialRatesSubtitle(order, 'diamond', diamondTypes),
  );
  const diamondHeaderRow = rows.length;
  const diamondHead1: (string | number | null)[] = ['Item'];
  const diamondHead2: (string | number | null)[] = [''];
  diamondTypes.forEach((type, index) => {
    diamondHead1.push(type.label, null, null);
    diamondHead2.push('Weight (ct)', 'Pieces', 'Total cost');
    if (index > 0) {
      /* grouped header merge is added below */
    }
  });
  addTableHeader(diamondHead1);
  addTableHeader(diamondHead2);
  if (diamondTypes.length) {
    merges.push({
      s: { r: diamondHeaderRow, c: 0 },
      e: { r: diamondHeaderRow + 1, c: 0 },
    });
    diamondTypes.forEach((_, index) =>
      merges.push({
        s: { r: diamondHeaderRow, c: 1 + index * 3 },
        e: { r: diamondHeaderRow, c: 3 + index * 3 },
      }),
    );
  } else {
    rows[diamondHeaderRow][1] = 'Diamond calculations';
    rows[diamondHeaderRow + 1] = [];
  }
  if (diamondTypes.length) {
    order.items.forEach((item) => {
      const rowValues: (string | number | null)[] = [item.itemNumber];
      diamondTypes.forEach((type) => {
        const cell = getPdfMaterialCell(item, 'diamond', type.key);
        const missing = cell.weight === '—';
        rowValues.push(
          missing ? '—' : cell.rawWeight,
          missing ? '—' : cell.pieceCount,
          missing ? '—' : moneyValue(cell.costPaise),
        );
      });
      const row = add(rowValues);
      diamondTypes.forEach((_, index) => {
        const base = 1 + index * 3;
        if (rowValues[base] !== '—') markWeight(row, base, 'ct');
        if (rowValues[base + 2] !== '—') markCurrency(row, base + 2);
      });
    });
    const totals: (string | number | null)[] = ['TOTAL'];
    diamondTypes.forEach((type) => {
      const cells = order.items.map((item) =>
        getPdfMaterialCell(item, 'diamond', type.key),
      );
      totals.push(
        cells.reduce((total, cell) => total + cell.rawWeight, 0),
        cells.reduce((total, cell) => total + cell.pieceCount, 0),
        moneyValue(cells.reduce((total, cell) => total + cell.costPaise, 0)),
      );
    });
    const row = addTotal(totals);
    diamondTypes.forEach((_, index) => {
      const base = 1 + index * 3;
      markWeight(row, base, 'ct');
      markCurrency(row, base + 2);
    });
  } else {
    add(['—', 'No diamond details']);
  }
  add([]);

  // 3. Stone calculations.
  const stoneTypes = getPdfMaterialTypes(order, 'stone');
  addSection(
    '3. Stone calculations',
    materialRatesSubtitle(order, 'stone', stoneTypes),
  );
  const stoneHeaderRow = rows.length;
  const stoneHead1: (string | number | null)[] = ['Item'];
  const stoneHead2: (string | number | null)[] = [''];
  stoneTypes.forEach((type) => {
    stoneHead1.push(type.label, null, null);
    stoneHead2.push('Weight', 'Pieces', 'Total cost');
  });
  addTableHeader(stoneHead1);
  addTableHeader(stoneHead2);
  if (stoneTypes.length) {
    merges.push({
      s: { r: stoneHeaderRow, c: 0 },
      e: { r: stoneHeaderRow + 1, c: 0 },
    });
    stoneTypes.forEach((_, index) =>
      merges.push({
        s: { r: stoneHeaderRow, c: 1 + index * 3 },
        e: { r: stoneHeaderRow, c: 3 + index * 3 },
      }),
    );
    order.items.forEach((item) => {
      const rowValues: (string | number | null)[] = [item.itemNumber];
      stoneTypes.forEach((type) => {
        const cell = getPdfMaterialCell(item, 'stone', type.key);
        const missing = cell.weight === '—';
        rowValues.push(
          missing ? '—' : cell.rawWeight,
          missing ? '—' : cell.pieceCount,
          missing ? '—' : moneyValue(cell.costPaise),
        );
      });
      const row = add(rowValues);
      stoneTypes.forEach((_, index) => {
        const base = 1 + index * 3;
        if (rowValues[base] !== '—') markWeight(row, base, 'ct');
        if (rowValues[base + 2] !== '—') markCurrency(row, base + 2);
      });
    });
    const totals: (string | number | null)[] = ['TOTAL'];
    stoneTypes.forEach((type) => {
      const cells = order.items.map((item) =>
        getPdfMaterialCell(item, 'stone', type.key),
      );
      totals.push(
        cells.reduce((total, cell) => total + cell.rawWeight, 0),
        cells.reduce((total, cell) => total + cell.pieceCount, 0),
        moneyValue(cells.reduce((total, cell) => total + cell.costPaise, 0)),
      );
    });
    const row = addTotal(totals);
    stoneTypes.forEach((_, index) => {
      const base = 1 + index * 3;
      markCurrency(row, base + 2);
    });
  } else {
    add(['—', 'No stone details']);
  }
  add([]);

  // 4. Other charges, including certification rate in the section subtitle.
  addSection(
    '4. Other charges',
    `Certification rate: ${certificationRateText(order)}`,
  );
  addTableHeader([
    'Item',
    'Certification',
    'Extra cost',
    'Subtotal before GST',
    'GST',
    'Calculated price',
  ]);
  order.items.forEach((item) => {
    const b = item.pricingBreakdown ?? {};
    const row = add([
      item.itemNumber,
      hasBreakdown(item) ? moneyValue(b.certification_value_paise) : null,
      hasBreakdown(item) ? moneyValue(b.extra_cost_paise) : null,
      hasBreakdown(item) ? moneyValue(b.subtotal_paise) : null,
      hasBreakdown(item) ? moneyValue(b.gst_value_paise) : null,
      hasBreakdown(item) ? moneyValue(b.calculated_total_paise) : null,
    ]);
    for (let col = 1; col <= 5; col++) markCurrency(row, col);
  });
  const chargesTotal = addTotal([
    'TOTAL',
    moneyValue(sum('certification_value_paise')),
    moneyValue(sum('extra_cost_paise')),
    moneyValue(sum('subtotal_paise')),
    moneyValue(sum('gst_value_paise')),
    moneyValue(sum('calculated_total_paise')),
  ]);
  for (let col = 1; col <= 5; col++) markCurrency(chargesTotal, col);
  if (order.items.some((item) => !hasBreakdown(item))) {
    add([
      `Note: Items entered as a direct final amount do not have a saved component breakdown; component values are shown as dashes for those items.`,
    ]);
  }
  add([]);

  // 5. Item-wise order totals and rounding adjustment.
  addSection('5. Order totals');
  addTableHeader(['Item no.', 'Calculated price']);
  const calculatedItemTotal = order.items.reduce(
    (total, item) =>
      total +
      (hasBreakdown(item)
        ? n(item.pricingBreakdown?.calculated_total_paise)
        : n(item.agreedPricePaise)),
    0,
  );
  order.items.forEach((item) => {
    const row = add([
      item.itemNumber,
      moneyValue(
        hasBreakdown(item)
          ? item.pricingBreakdown?.calculated_total_paise
          : item.agreedPricePaise,
      ),
    ]);
    markCurrency(row, 1);
  });
  const orderTotalRow = addTotal(['TOTAL', moneyValue(calculatedItemTotal)]);
  markCurrency(orderTotalRow, 1);
  if (n(order.totalValuePaise) !== calculatedItemTotal) {
    const roundingRow = addTotal([
      'Rounding adjustment',
      moneyValue(order.totalValuePaise),
    ]);
    markCurrency(roundingRow, 1);
  }
  if (order.notes?.trim()) {
    add([]);
    const noteTitle = add(['Notes']);
    boldRows.push(noteTitle);
    add([order.notes]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const lastRow = rows.length - 1;
  const lastCol = Math.max(columnCount, ...rows.map((row) => row.length)) - 1;
  [titleRow, ...sectionRows, ...subtitleRows].forEach((row) => {
    if (lastCol > 0)
      merges.push({ s: { r: row, c: 0 }, e: { r: row, c: lastCol } });
  });
  sheet['!merges'] = merges;
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: lastRow, c: lastCol },
  });
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const border = {
    top: { style: 'thin', color: { rgb: 'D3CDC5' } },
    bottom: { style: 'thin', color: { rgb: 'D3CDC5' } },
    left: { style: 'thin', color: { rgb: 'D3CDC5' } },
    right: { style: 'thin', color: { rgb: 'D3CDC5' } },
  };
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[ref];
      if (!cell) continue;
      cell.s = {
        font: { name: 'Arial', sz: 9, color: { rgb: '302B26' } },
        alignment: { vertical: 'center', wrapText: true },
        border,
      };
      if (tableHeaderRows.includes(r)) {
        cell.s = {
          ...cell.s,
          fill: { fgColor: { rgb: 'F4EFE8' } },
          font: { name: 'Arial', sz: 9, bold: true, color: { rgb: '302B26' } },
          alignment: {
            vertical: 'center',
            horizontal: 'center',
            wrapText: true,
          },
          border,
        };
      } else if (totalRows.includes(r)) {
        cell.s = {
          ...cell.s,
          fill: { fgColor: { rgb: 'F4EFE8' } },
          font: { name: 'Arial', sz: 9, bold: true, color: { rgb: '302B26' } },
          border,
        };
      } else if (sectionRows.includes(r)) {
        cell.s = {
          ...cell.s,
          fill: { fgColor: { rgb: '3F342A' } },
          font: { name: 'Arial', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
          border,
        };
      } else if (r % 2 === 0) {
        cell.s = { ...cell.s, fill: { fgColor: { rgb: 'FAF9F7' } } };
      }
      if (boldRows.includes(r))
        cell.s = {
          ...cell.s,
          font: {
            name: 'Arial',
            sz: r === titleRow ? 17 : 9,
            bold: true,
            color: { rgb: '302B26' },
          },
        };
      if (subtitleRows.includes(r))
        cell.s = {
          ...cell.s,
          font: {
            name: 'Arial',
            sz: 8,
            color: { rgb: '696057' },
            italic: true,
          },
        };
    }
  }
  currencyCells.forEach((ref) => {
    if (sheet[ref]) {
      sheet[ref].t = 'n';
      sheet[ref].z = '₹#,##0.00;[Red]-₹#,##0.00;–';
    }
  });
  weightCells.forEach((entry) => {
    const [ref, unit] = entry.split('|');
    if (sheet[ref]) {
      sheet[ref].t = 'n';
      sheet[ref].z = unit === 'g' ? '0.000' : '0.00';
    }
  });
  sheet['!cols'] = Array.from({ length: lastCol + 1 }, (_, col) => {
    if (col === 0) return { wch: 16 };
    if (col === 1 && lastCol < 9) return { wch: 22 };
    return { wch: lastCol > 12 ? 13 : 19 };
  });
  sheet['!rows'] = rows.map((_, index) => ({
    hpt: sectionRows.includes(index)
      ? 22
      : tableHeaderRows.includes(index)
        ? 28
        : subtitleRows.includes(index)
          ? 20
          : 19,
  }));
  sheet['!freeze'] = { xSplit: 0, ySplit: 5 };
  sheet['!pageSetup'] = {
    orientation: 'landscape',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    scale: 0,
  };
  sheet['!margins'] = {
    left: 0.25,
    right: 0.25,
    top: 0.5,
    bottom: 0.5,
    header: 0.2,
    footer: 0.2,
  };
  sheet['!printOptions'] = { horizontalCentered: true };
  sheet['!autofilter'] = undefined;

  XLSX.utils.book_append_sheet(workbook, sheet, 'Order Summary');
  const workbookBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;
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
    alternateRowStyles: {
      fillColor: [250, 249, 247] as [number, number, number],
    },
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
      const subtitleLines = doc.splitTextToSize(
        subtitleText,
        pageWidth - margin * 2,
      );
      doc.text(subtitleLines, margin, y + 11);
      return y + 14 + subtitleLines.length * 8;
    }
    return y + 8;
  };

  drawPageHeading();

  let y = 101;

  const calculated = order.items.filter(hasBreakdown);
  const sum = (field: string) =>
    calculated.reduce(
      (total, item) => total + n(item.pricingBreakdown?.[field]),
      0,
    );
  const drawTable = (
    heading: string,
    head: string[],
    body: (string | number)[][],
    startAt: number,
    options: Record<string, any> = {},
    subtitleText = '',
  ) => {
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
    const fontSize =
      columnCount > 13
        ? 4.8
        : columnCount > 9
          ? 5.5
          : columnCount > 5
            ? 6.2
            : 7;
    autoTable(doc, {
      ...tableTheme,
      startY: tableY,
      head,
      body: body.length ? body : [['—', 'No calculations available']],
      styles: {
        ...tableTheme.styles,
        fontSize,
        cellPadding: columnCount > 9 ? 2.2 : 3,
        halign: 'center',
      },
      headStyles: {
        ...tableTheme.headStyles,
        fontSize,
        cellPadding: columnCount > 9 ? 2.2 : 3,
      },
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
  const grossWeightTotal = order.items.reduce(
    (total, item) =>
      total +
      (item.grossWeightMilli == null ? 0 : item.grossWeightMilli / 1000),
    0,
  );
  const netWeightTotal = order.items.reduce(
    (total, item) =>
      total + (item.netWeightMilli == null ? 0 : item.netWeightMilli / 1000),
    0,
  );
  const goldRates = goldHeaderRates(order);
  const goldHeading = '1. Gold calculations';
  const goldSubtitle = `Gold rate: ${goldRates.goldRate}   ·   Wastage: ${goldRates.wastageRate}`;
  const goldBody = order.items.map((item) => {
    const b = item.pricingBreakdown ?? {};
    return [
      item.itemNumber,
      item.category || '—',
      item.grossWeightMilli == null
        ? '—'
        : number(item.grossWeightMilli / 1000),
      b.net_gold_g == null
        ? item.netWeightMilli == null
          ? '—'
          : number(item.netWeightMilli / 1000)
        : number(b.net_gold_g),
      purityLabel(item),
      hasBreakdown(item) ? money(b.gold_value_paise) : '—',
      hasBreakdown(item) ? money(b.wastage_value_paise) : '—',
    ];
  });
  goldBody.push([
    'TOTAL',
    '',
    number(grossWeightTotal),
    number(netWeightTotal),
    '',
    money(sum('gold_value_paise')),
    money(sum('wastage_value_paise')),
  ]);
  y = drawTable(
    goldHeading,
    [
      'Item',
      'Category',
      'Gross wt. (g)',
      'Net gold wt. (g)',
      'Purity',
      'Gold value',
      'Wastage',
    ],
    goldBody,
    y,
    {
      styles: { ...tableTheme.styles, fontSize: 6.8, cellPadding: 4 },
      columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 62 } },
    },
    goldSubtitle,
  );

  // 2. Diamond calculations — diamond rates are shown once in the section details.
  const diamondTypes = getPdfMaterialTypes(order, 'diamond');
  const diamondHead = diamondTypes.length
    ? [
        [
          { content: 'Item', rowSpan: 2, styles: { valign: 'middle' } },
          ...diamondTypes.map((type) => ({
            content: type.label,
            colSpan: 2,
            styles: { halign: 'center' },
          })),
        ],
        diamondTypes.flatMap(() => [
          { content: 'Weight (ct)', styles: { halign: 'center' } },
          { content: 'Total cost', styles: { halign: 'center' } },
        ]),
      ]
    : [['Item', 'Diamond calculations']];
  const diamondBody: (string | number)[][] = order.items.map((item) =>
    diamondTypes.length
      ? [
          item.itemNumber,
          ...diamondTypes.flatMap((type) => {
            const cell = getPdfMaterialCell(item, 'diamond', type.key);
            return [cell.weight, cell.cost];
          }),
        ]
      : [item.itemNumber, 'No diamond details'],
  );
  if (diamondTypes.length) {
    diamondBody.push([
      'TOTAL',
      ...diamondTypes.flatMap((type) => {
        const cells = order.items.map((item) =>
          getPdfMaterialCell(item, 'diamond', type.key),
        );
        const totalWeight = cells.reduce(
          (sum, cell) => sum + (cell.rawWeight ?? 0),
          0,
        );
        const totalPieces = cells.reduce(
          (sum, cell) => sum + (cell.pieceCount ?? 0),
          0,
        );
        const totalCost = cells.reduce(
          (sum, cell) => sum + (cell.costPaise ?? 0),
          0,
        );
        return [
          totalWeight
            ? `${number(totalWeight, 2)} ct${totalPieces ? ` (${totalPieces} pcs)` : ''}`
            : '—',
          money(totalCost),
        ];
      }),
    ]);
  }
  y = drawMaterialTable(
    '2. Diamond calculations',
    diamondHead,
    diamondBody,
    y,
    diamondTypes.length,
    materialRatesSubtitle(order, 'diamond', diamondTypes),
  );

  // 3. Stone calculations — rates are shown once in the section details.
  const stoneTypes = getPdfMaterialTypes(order, 'stone');
  const stoneHead = stoneTypes.length
    ? [
        [
          { content: 'Item', rowSpan: 2, styles: { valign: 'middle' } },
          ...stoneTypes.map((type) => ({
            content: type.label,
            colSpan: 2,
            styles: { halign: 'center' },
          })),
        ],
        stoneTypes.flatMap(() => [
          { content: 'Weight (ct)', styles: { halign: 'center' } },
          { content: 'Total cost', styles: { halign: 'center' } },
        ]),
      ]
    : [['Item', 'Stone calculations']];
  const stoneBody: (string | number)[][] = order.items.map((item) =>
    stoneTypes.length
      ? [
          item.itemNumber,
          ...stoneTypes.flatMap((type) => {
            const cell = getPdfMaterialCell(item, 'stone', type.key);
            return [cell.weight, cell.cost];
          }),
        ]
      : [item.itemNumber, 'No stone details'],
  );
  if (stoneTypes.length) {
    stoneBody.push([
      'TOTAL',
      ...stoneTypes.flatMap((type) => {
        const cells = order.items.map((item) =>
          getPdfMaterialCell(item, 'stone', type.key),
        );
        const totalWeight = cells.reduce(
          (sum, cell) => sum + (cell.rawWeight ?? 0),
          0,
        );
        const totalPieces = cells.reduce(
          (sum, cell) => sum + (cell.pieceCount ?? 0),
          0,
        );
        const totalCost = cells.reduce(
          (sum, cell) => sum + (cell.costPaise ?? 0),
          0,
        );
        return [
          totalWeight
            ? `${number(totalWeight, 2)} ct${totalPieces ? ` (${totalPieces} pcs)` : ''}`
            : '—',
          money(totalCost),
        ];
      }),
    ]);
  }
  y = drawMaterialTable(
    '3. Stone calculations',
    stoneHead,
    stoneBody,
    y,
    stoneTypes.length,
    materialRatesSubtitle(order, 'stone', stoneTypes),
  );

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
    [
      'Item',
      'Certification',
      'Extra cost',
      'Subtotal before GST',
      'GST',
      'Calculated price',
    ],
    chargesBody,
    y,
    {
      styles: { ...tableTheme.styles, fontSize: 7, cellPadding: 5 },
      headStyles: { ...tableTheme.headStyles, fontSize: 7, cellPadding: 5 },
    },
    `Certification rate: ${certificationRateText(order)}`,
  );

  if (order.items.some((item) => !hasBreakdown(item))) {
    const note =
      'Items entered as a direct final amount do not have a saved component breakdown; component values are shown as dashes for those items.';
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

  const calculatedItemTotal = order.items.reduce(
    (total, item) =>
      total +
      (hasBreakdown(item)
        ? n(item.pricingBreakdown?.calculated_total_paise)
        : n(item.agreedPricePaise)),
    0,
  );
  const roundingAdjustment = n(order.totalValuePaise) - calculatedItemTotal;
  const orderTotalRows: (string | number)[][] = order.items.map((item) => [
    item.itemNumber,
    hasBreakdown(item)
      ? money(item.pricingBreakdown?.calculated_total_paise)
      : money(item.agreedPricePaise),
  ]);
  orderTotalRows.push(['TOTAL', money(calculatedItemTotal)]);
  if (roundingAdjustment !== 0)
    orderTotalRows.push(['Rounding adjustment', money(order.totalValuePaise)]);

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
