import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFontUrl from '../../assets/fonts/DejaVuSans.ttf?url';
import boldFontUrl from '../../assets/fonts/DejaVuSans-Bold.ttf?url';
import './ExportDialog.css';
import { buildCsv, cellText, escapeCsv } from './export.utils';
import type {
  ExportColumn,
  ExportConfiguration,
  ExportFormat,
  ExportScope,
} from './export.types';

type Props<T> = {
  configuration: ExportConfiguration<T>;
  /** Column keys selected when the dialog first opens. If omitted, each column's defaultVisible setting is used. */
  defaultSelectedColumns?: string[];
  /** When supplied and non-empty, export only these explicitly selected records. */
  selectedRows?: T[];
  onClose: () => void;
};

type SelectOption = { value: string; label: string };

function StyledSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSpanElement>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!selectRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className='export-select-field'>
      <span className='export-select-label'>{label}</span>
      <span className='export-select' ref={selectRef}>
        <button
          type='button'
          className='export-select-trigger'
          aria-haspopup='listbox'
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{selectedOption?.label ?? ''}</span>
          <svg className={`export-select-chevron${open ? ' is-open' : ''}`} aria-hidden='true' width='16' height='16' viewBox='0 0 24 24' fill='none'>
            <path d='m7 10 5 5 5-5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </button>
        {open && !disabled && (
          <>
            <div className='export-select-menu' role='listbox' aria-label={label}>
              {options.map((option) => (
                <button
                  type='button'
                  role='option'
                  aria-selected={option.value === value}
                  className={`export-select-option${option.value === value ? ' is-selected' : ''}`}
                  key={option.value}
                  onClick={() => {
                    // Apply the choice and close the menu in the same event.
                    // Keep this controlled by the option click, not the parent label.
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value && <span aria-hidden='true'>✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </span>
    </div>
  );
}

type ConfiguredColumn<T> = ExportColumn<T> & {
  outputLabel: string;
  included: boolean;
};

type RowWithBreakdown = {
  diamondBreakdown?: Array<{
    shapeCode: string;
    weightMilli: number;
    pieces: number;
  }>;
  stoneBreakdown?: Array<{
    tagLabel: string;
    weightUnit: 'ct' | 'g';
    weightMilli: number;
    pieces: number;
  }>;
};

function getBreakdown(row: unknown): RowWithBreakdown {
  return row && typeof row === 'object' ? (row as RowWithBreakdown) : {};
}

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

function normalizedTypeKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function buildTotalsRow<T>(
  rows: T[],
  columns: Array<{
    key: string;
    label: string;
    outputLabel: string;
    value: (row: T) => unknown;
    total?: (rows: T[]) => string | number | null | undefined;
  }>,
): string[] {
  const totals = columns.map(() => '');
  if (!columns.length) return totals;

  const totalableKeys = new Set([
    'grossWeight',
    'netWeight',
    'diamondDetails',
    'stoneDetails',
    'itemCount',
    'calculatedTotal',
    'orderValue',
    'itemPrice',
  ]);
  const sumWeightColumn = (key: 'grossWeight' | 'netWeight') => {
    const index = columns.findIndex((column) => column.key === key);
    if (index < 0) return;
    let sum = 0;
    let count = 0;
    rows.forEach((row) => {
      const raw = cellText(columns[index].value(row));
      const match = raw.match(/(-?\d+(?:\.\d+)?)\s*g\b/i);
      if (match) {
        sum += Number(match[1]);
        count += 1;
      }
    });
    if (count) totals[index] = `${sum.toFixed(3)} g`;
  };
  sumWeightColumn('grossWeight');
  sumWeightColumn('netWeight');

  // Order export rows keep their money values in integer paise. Sum those
  // source values directly instead of parsing the formatted currency strings.
  const sumOrderColumn = (key: 'itemCount' | 'calculatedTotal' | 'orderValue' | 'itemPrice') => {
    const index = columns.findIndex((column) => column.key === key);
    if (index < 0) return;

    const sum = rows.reduce((total, row) => {
      const source = row as Record<string, unknown>;
      const rawValue =
        key === 'itemCount'
          ? source.itemCount
          : key === 'calculatedTotal'
            ? source.calculatedTotalPaise
            : key === 'itemPrice'
              ? source.itemPricePaise
              : source.totalPaise;
      const value = Number(rawValue ?? 0);
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);

    if (key === 'itemCount') {
      totals[index] = String(sum);
      return;
    }

    totals[index] = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(sum / 100);
  };

  sumOrderColumn('itemCount');
  sumOrderColumn('calculatedTotal');
  sumOrderColumn('orderValue');
  sumOrderColumn('itemPrice');

  columns.forEach((column, index) => {
    if (column.key === 'diamondDetails') {
      const byShape = new Map<string, { weightMilli: number; pieces: number }>();
      rows.forEach((row) => {
        (getBreakdown(row).diamondBreakdown ?? []).forEach((entry) => {
          const current = byShape.get(entry.shapeCode) ?? { weightMilli: 0, pieces: 0 };
          current.weightMilli += entry.weightMilli;
          current.pieces += entry.pieces;
          byShape.set(entry.shapeCode, current);
        });
      });
      totals[index] = [...byShape.entries()]
        .map(([shapeCode, total]) => `${shapeCode}: ${(total.weightMilli / 1000).toFixed(2)} ct (${total.pieces} pcs)`)
        .join('\n');
    } else if (column.key === 'stoneDetails') {
      const byType = new Map<string, { weightUnit: 'ct' | 'g'; weightMilli: number; pieces: number }>();
      rows.forEach((row) => {
        (getBreakdown(row).stoneBreakdown ?? []).forEach((entry) => {
          const mapKey = `${entry.tagLabel}__${entry.weightUnit}`;
          const current = byType.get(mapKey) ?? {
            weightUnit: entry.weightUnit,
            weightMilli: 0,
            pieces: 0,
          };
          current.weightMilli += entry.weightMilli;
          current.pieces += entry.pieces;
          byType.set(mapKey, current);
        });
      });
      totals[index] = [...byType.entries()]
        .map(([mapKey, total]) => {
          const tagLabel = mapKey.slice(0, mapKey.lastIndexOf('__'));
          const weight = total.weightMilli / 1000;
          return `${tagLabel}: ${weight.toFixed(total.weightUnit === 'ct' ? 2 : 3)} ${total.weightUnit} (${total.pieces} pcs)`;
        })
        .join('\n');
    } else if (column.key.startsWith('__diamond_type_')) {
      const typeKey = column.key.slice('__diamond_type_'.length);
      let weightMilli = 0;
      let pieces = 0;
      rows.forEach((row) => {
        (getBreakdown(row).diamondBreakdown ?? []).forEach((entry) => {
          if (normalizedTypeKey(entry.shapeCode) === typeKey) {
            weightMilli += entry.weightMilli;
            pieces += entry.pieces;
          }
        });
      });
      if (weightMilli || pieces) totals[index] = `${(weightMilli / 1000).toFixed(2)} ct (${pieces} pcs)`;
    } else if (column.key.startsWith('__stone_type_')) {
      const typeKey = column.key.slice('__stone_type_'.length);
      let weightMilli = 0;
      let pieces = 0;
      let unit: 'ct' | 'g' = 'ct';
      rows.forEach((row) => {
        (getBreakdown(row).stoneBreakdown ?? []).forEach((entry) => {
          if (normalizedTypeKey(entry.tagLabel) === typeKey) {
            weightMilli += entry.weightMilli;
            pieces += entry.pieces;
            unit = entry.weightUnit;
          }
        });
      });
      if (weightMilli || pieces) {
        totals[index] = `${(weightMilli / 1000).toFixed(unit === 'ct' ? 2 : 3)} ${unit} (${pieces} pcs)`;
      }
    }
  });

  columns.forEach((column, index) => {
    if (column.total) {
      const total = column.total(rows);
      totals[index] = total == null ? '' : String(total);
    }
  });

  const labelIndex = columns.findIndex(
    (column) =>
      !column.total &&
      !totalableKeys.has(column.key) &&
      !column.key.startsWith('__diamond_type_') &&
      !column.key.startsWith('__stone_type_'),
  );
  if (labelIndex >= 0) {
    totals[labelIndex] = 'TOTAL';
  } else {
    const emptyIndex = totals.findIndex((value) => !value);
    if (emptyIndex >= 0) totals[emptyIndex] = 'TOTAL';
  }

  return totals;
}

function createDetailedColumns<T>(
  rows: T[],
  category: 'diamonds' | 'stones',
): ExportColumn<T>[] {
  if (category === 'diamonds') {
    const diamondCodes = [
      ...new Set(
        rows.flatMap((row) =>
          (getBreakdown(row).diamondBreakdown ?? []).map(
            (entry) => entry.shapeCode,
          ),
        ),
      ),
    ];

    return diamondCodes.map((shapeCode) => ({
      key: `__diamond_type_${shapeCode.trim().replace(/[^a-zA-Z0-9_-]+/g, '_')}`,
      label: `D ${shapeCode}`,
      defaultVisible: true,
      value: (row: T) => {
        const entry = (getBreakdown(row).diamondBreakdown ?? []).find(
          (item) => item.shapeCode === shapeCode,
        );
        return entry
          ? `${(entry.weightMilli / 1000).toFixed(2)} ct (${entry.pieces} pcs)`
          : '';
      },
    }));
  }

  const stoneTypes = new Map<string, 'ct' | 'g'>();
  rows.forEach((row) => {
    (getBreakdown(row).stoneBreakdown ?? []).forEach((entry) => {
      if (!stoneTypes.has(entry.tagLabel))
        stoneTypes.set(entry.tagLabel, entry.weightUnit);
    });
  });

  return [...stoneTypes.entries()].map(([tagLabel, weightUnit]) => {
    const keyPart = tagLabel.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
    return {
      key: `__stone_type_${keyPart}`,
      label: tagLabel,
      defaultVisible: true,
      value: (row: T) => {
        const entry = (getBreakdown(row).stoneBreakdown ?? []).find(
          (item) => item.tagLabel === tagLabel,
        );
        return entry
          ? `${(entry.weightMilli / 1000).toFixed(weightUnit === 'ct' ? 2 : 3)} ${weightUnit} (${entry.pieces} pcs)`
          : '';
      },
    };
  });
}

function replaceDetailedColumns<T>(
  current: ConfiguredColumn<T>[],
  category: 'diamonds' | 'stones',
  rows: T[],
): ConfiguredColumn<T>[] {
  const prefix = category === 'diamonds' ? '__diamond_type_' : '__stone_type_';
  const parentKey = category === 'diamonds' ? 'diamondDetails' : 'stoneDetails';
  const generated = createDetailedColumns(rows, category);
  const existingByKey = new Map(
    current
      .filter((column) => column.key.startsWith(prefix))
      .map((column) => [column.key, column]),
  );

  const detailedColumns: ConfiguredColumn<T>[] = generated.map((column) => {
    const existing = existingByKey.get(column.key);
    return {
      ...column,
      outputLabel: existing?.outputLabel ?? column.label,
      included: existing?.included ?? column.defaultVisible !== false,
    };
  });

  const withoutOldDetails = current.filter((column) => !column.key.startsWith(prefix));
  const parentIndex = withoutOldDetails.findIndex((column) => column.key === parentKey);
  const insertionIndex = parentIndex >= 0 ? parentIndex + 1 : withoutOldDetails.length;

  return [
    ...withoutOldDetails.slice(0, insertionIndex),
    ...detailedColumns,
    ...withoutOldDetails.slice(insertionIndex),
  ];
}

function ExportDialog<T>({ configuration, defaultSelectedColumns, selectedRows, onClose }: Props<T>) {
  const [step, setStep] = useState<1 | 2>(1);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [scope, setScope] = useState<ExportScope>(selectedRows?.length ? 'selected' : 'filtered');
  const [separateDiamonds, setSeparateDiamonds] = useState(false);
  const [separateStones, setSeparateStones] = useState(false);
  const [includeTotals, setIncludeTotals] = useState(false);
  const [columns, setColumns] = useState<ConfiguredColumn<T>[]>(() => {
    const configuredColumns = [
      {
        key: '__serial',
        label: 'Sr No.',
        value: (_row: T) => '',
        defaultVisible: false,
      } as ExportColumn<T>,
      ...configuration.columns,
    ].map((column) => ({
      ...column,
      outputLabel: column.label,
      included:
        column.key === '__serial'
          ? false
          : defaultSelectedColumns
            ? defaultSelectedColumns.includes(column.key)
            : column.defaultVisible !== false,
    }));

    if (!defaultSelectedColumns?.length) return configuredColumns;

    const priority = new Map(
      defaultSelectedColumns.map((key, index) => [key, index]),
    );

    return configuredColumns
      .map((column, originalIndex) => ({ column, originalIndex }))
      .sort((a, b) => {
        // Keep Sr No. at the top of the column list, regardless of selection.
        if (a.column.key === '__serial') return -1;
        if (b.column.key === '__serial') return 1;

        const aPriority = priority.get(a.column.key);
        const bPriority = priority.get(b.column.key);
        if (aPriority !== undefined && bPriority !== undefined) {
          return aPriority - bPriority;
        }
        if (aPriority !== undefined) return -1;
        if (bPriority !== undefined) return 1;
        return a.originalIndex - b.originalIndex;
      })
      .map(({ column }) => column);
  });
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    'landscape',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSourceRows, setPreviewSourceRows] = useState<T[]>(
    selectedRows?.length ? selectedRows : configuration.filteredRows,
  );

  const activeColumns = useMemo(
    () =>
      columns.filter((column) => {
        if (!column.included) return false;
        if (column.key === 'diamondDetails' && separateDiamonds) return false;
        if (column.key === 'stoneDetails' && separateStones) return false;
        if (column.key.startsWith('__diamond_type_')) {
          return (
            separateDiamonds &&
            columns.find((item) => item.key === 'diamondDetails')?.included !==
              false
          );
        }
        if (column.key.startsWith('__stone_type_')) {
          return (
            separateStones &&
            columns.find((item) => item.key === 'stoneDetails')?.included !==
              false
          );
        }
        return true;
      }),
    [columns, separateDiamonds, separateStones],
  );
  const hasSelectedRows = Boolean(selectedRows?.length);

  // Use the same record-scope rules for dynamic detail columns and final export:
  // explicit selections take priority, otherwise use all rows or filtered rows.
  const getRowsForScope = async (
    requestedScope: ExportScope = scope,
  ): Promise<T[]> => {
    if (requestedScope === 'selected' && hasSelectedRows) return selectedRows!;
    if (requestedScope === 'all') return configuration.getAllRows();
    return configuration.filteredRows;
  };

  const previewRows = previewSourceRows.slice(0, 5);
  const previewTotalsRow = includeTotals
    ? buildTotalsRow(
        previewRows,
        activeColumns.map(({ key, label, value, outputLabel, total }) => ({
          key,
          label,
          value,
          outputLabel,
          total,
        })),
      )
    : null;
  const updateColumn = (key: string, patch: Partial<ConfiguredColumn<T>>) => {
    setColumns((current) =>
      current.map((column) =>
        column.key === key ? { ...column, ...patch } : column,
      ),
    );
  };

  const moveColumn = (index: number, direction: -1 | 1) => {
    setColumns((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const changeSeparateDetails = async (
    category: 'diamonds' | 'stones',
    enabled: boolean,
  ) => {
    const isCurrentlyEnabled =
      category === 'diamonds' ? separateDiamonds : separateStones;
    if (enabled === isCurrentlyEnabled) return;
    setError(null);

    if (!enabled) {
      if (category === 'diamonds') setSeparateDiamonds(false);
      else setSeparateStones(false);
      return;
    }

    setBusy(true);
    try {
      const rowsForExport = await getRowsForScope();
      setColumns((current) => replaceDetailedColumns(current, category, rowsForExport));

      if (category === 'diamonds') setSeparateDiamonds(true);
      else setSeparateStones(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load detailed stone columns.',
      );
    } finally {
      setBusy(false);
    }
  };

  const exportData = async () => {
    if (!activeColumns.length) {
      setError('Choose at least one column to include.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rows = await getRowsForScope();
      const selected = activeColumns.map(
        ({ key, label, value, outputLabel, total }) => ({
          key,
          label,
          value: key === '__serial' ? (row: T) => rows.indexOf(row) + 1 : value,
          outputLabel,
          total,
        }),
      );
      const totalsRow = includeTotals ? buildTotalsRow(rows, selected) : null;
      const configuredBaseName = configuration.filename.replace(/\.(xlsx|csv|pdf)$/i, '');
      const fileBaseName = configuredBaseName.toLowerCase() === 'inventory'
        ? 'inventory_items'
        : configuredBaseName;
      const dateStamp = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
      const baseName = `${fileBaseName}_${dateStamp}`;
      if (format === 'csv') {
        const csv = buildCsv(rows, selected);
        const csvWithTotals = totalsRow
          ? `${csv}\r\n${totalsRow.map(escapeCsv).join(',')}`
          : csv;
        await saveExportFile(
          `${baseName}.csv`,
          'csv',
          new TextEncoder().encode('\uFEFF' + csvWithTotals),
        );
      } else if (format === 'xlsx') {
        // Insert real cell line breaks between adjacent jewelry types. The source
        // detail strings can be concatenated without a separator, so wrapping
        // alone cannot make each type appear on its own line in spreadsheet apps.
        const excelCellValue = (
          column: (typeof selected)[number],
          row: T,
          rowIndex: number,
        ) => {
          const value =
            column.key === '__serial'
              ? String(rowIndex + 1)
              : cellText(column.value(row));
          if (column.key !== 'diamondDetails' && column.key !== 'stoneDetails')
            return value;
          return value.replace(
            /\)\s*(?=(?:RD|P\/M|T\/B|R\s*ST|G\s*ST|PEARL)\s*:)/gi,
            ')\n',
          );
        };
        const data = [
          selected.map((column) => column.outputLabel),
          ...rows.map((row, rowIndex) =>
            selected.map((column) => excelCellValue(column, row, rowIndex)),
          ),
          ...(totalsRow ? [totalsRow] : []),
        ];
        const worksheet = XLSX.utils.aoa_to_sheet(data);
        worksheet['!cols'] = selected.map((column) => ({
          // Give combined detail columns enough room for labels and values;
          // keep the remaining columns proportional to their headings.
          wch:
            column.key === 'diamondDetails' || column.key === 'stoneDetails'
              ? 38
              : Math.min(30, Math.max(12, column.outputLabel.length + 2)),
        }));
        // Explicit row heights make the embedded line breaks visible in Excel,
        // WPS and Google Sheets rather than relying on each app's auto-fit rules.
        rows.forEach((row, rowIndex) => {
          const lineCounts = selected.map((column) => {
            const value = excelCellValue(column, row, rowIndex);
            return value ? value.split(/\r\n|\n|\r/).length : 1;
          });
          const maxLines = Math.max(1, ...lineCounts);
          worksheet['!rows'] ??= [];
          worksheet['!rows'][rowIndex + 1] = {
            hpt: Math.max(18, maxLines * 16),
          };
        });
        if (totalsRow) {
          const totalsLines = Math.max(1, ...totalsRow.map((value) => value ? value.split(/\r\n|\n|\r/).length : 1));
          worksheet['!rows'] ??= [];
          worksheet['!rows'][rows.length + 1] = { hpt: Math.max(20, totalsLines * 16) };
        }
        // Apply actual XLSX cell styles. The `xlsx` community package does not
        // write styles; `xlsx-js-style` is used above so Excel and WPS receive
        // the wrap-text alignment rather than relying on an edit to recalculate it.
        selected.forEach((_column, colIndex) => {
          const headerRef = XLSX.utils.encode_cell({ r: 0, c: colIndex });
          const headerCell = worksheet[headerRef];
          if (headerCell) {
            headerCell.s = {
              font: { bold: true },
              alignment: { wrapText: true, vertical: 'center' },
            };
          }
        });

        rows.forEach((_row, rowIndex) => {
          selected.forEach((_column, colIndex) => {
            const ref = XLSX.utils.encode_cell({ r: rowIndex + 1, c: colIndex });
            const cell = worksheet[ref];
            if (!cell) return;
            cell.s = {
              alignment: { wrapText: true, vertical: 'top' },
            };
          });
        });

        if (totalsRow) {
          totalsRow.forEach((_value, colIndex) => {
            const ref = XLSX.utils.encode_cell({ r: rows.length + 1, c: colIndex });
            const cell = worksheet[ref] ?? (worksheet[ref] = { t: 's', v: '' });
            cell.s = {
              font: { bold: true },
              alignment: { wrapText: true, vertical: 'top' },
              border: { top: { style: 'thin', color: { rgb: 'B8AFA3' } } },
            };
          });
        }
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');
        const workbookBytes = XLSX.write(workbook, {
          bookType: 'xlsx',
          type: 'array',
        }) as ArrayBuffer;
        await saveExportFile(
          `${baseName}.xlsx`,
          'xlsx',
          new Uint8Array(workbookBytes),
        );
      } else if (format === 'pdf') {
        const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
        await Promise.all([
          loadPdfFont(pdf, regularFontUrl, 'DejaVuSans.ttf', 'normal'),
          loadPdfFont(pdf, boldFontUrl, 'DejaVuSans-Bold.ttf', 'bold'),
        ]);
        pdf.setFont('InventoryUnicode', 'normal');
        pdf.setFontSize(16);
        pdf.text(configuration.title, 40, 36);
        pdf.setFontSize(9);
        pdf.text(
          `${rows.length} records · ${new Date().toLocaleDateString()}`,
          40,
          53,
        );
        autoTable(pdf, {
          startY: 66,
          head: [selected.map((column) => column.outputLabel)],
          body: [
            ...rows.map((row, rowIndex) =>
              selected.map((column) =>
                column.key === '__serial'
                  ? String(rowIndex + 1)
                  : cellText(column.value(row)),
              ),
            ),
            ...(totalsRow ? [totalsRow] : []),
          ],
          didParseCell: (data) => {
            if (totalsRow && data.section === 'body' && data.row.index === rows.length) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.lineWidth = 0.8;
              data.cell.styles.lineColor = [170, 160, 148];
              data.cell.styles.fillColor = [244, 239, 232];
            }
          },
          didDrawCell: (data) => {
            // Keep vertical gridlines a little lighter, with horizontal row
            // separators one shade darker for easier reading on paper.
            if (data.section === 'head' || data.section === 'body') {
              const { x, y, width, height } = data.cell;
              const isTotalsRow =
                totalsRow && data.section === 'body' && data.row.index === rows.length;
              if (isTotalsRow) {
                pdf.setDrawColor(170, 160, 148);
              } else {
                pdf.setDrawColor(190, 182, 172);
              }
              pdf.setLineWidth(isTotalsRow ? 0.8 : 0.45);
              pdf.line(x, y + height, x + width, y + height);
            }
          },
          // Keep every selected column on the same page. AutoTable will wrap
          // long values instead of creating a mostly-empty page for a final column.
          styles: {
            font: 'InventoryUnicode',
            fontSize: selected.length > 10 ? 5.5 : selected.length > 7 ? 6 : 7,
            cellPadding: selected.length > 10 ? 2 : 3,
            overflow: 'linebreak',
            lineColor: [211, 205, 197],
            lineWidth: 0.35,
            textColor: [48, 43, 38],
          },
          headStyles: {
            font: 'InventoryUnicode',
            fillColor: [244, 239, 232],
            textColor: [48, 43, 38],
            fontStyle: 'bold',
            lineColor: [211, 204, 195],
            lineWidth: 0.3,
            fontSize: selected.length > 10 ? 5.5 : selected.length > 7 ? 6 : 7,
          },
          alternateRowStyles: {
            fillColor: [250, 249, 247],
          },
          margin: { left: 28, right: 28 },
          tableWidth: 'auto',
        });
        await saveExportFile(
          `${baseName}.pdf`,
          'pdf',
          new Uint8Array(pdf.output('arraybuffer')),
        );
      }
      onClose();
    } catch (err) {
      console.error('Export failed:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to create the export. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className='export-overlay'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className='export-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='export-title'
      >
        <header className='export-header'>
          <div>
            <p className='export-eyebrow'>DATA OUTPUT</p>
            <h2 id='export-title'>Export</h2>
            <p>
              Choose your records, arrange columns, and select an output format.
            </p>
          </div>
          <button
            className='export-close'
            type='button'
            onClick={onClose}
            disabled={busy}
            aria-label='Close export dialog'
          >
            ×
          </button>
        </header>
        <div className={`export-step-content${step === 1 ? ' export-step-content--columns' : ''}`} key={step}>
          {step === 1 ? (
            <>
              <div className='export-settings-grid'>
                <StyledSelect
                  label='Format'
                  value={format}
                  options={[
                    { value: 'xlsx', label: 'Excel workbook (.xlsx)' },
                    { value: 'pdf', label: 'PDF document (.pdf)' },
                    { value: 'csv', label: 'CSV (.csv)' },
                  ]}
                  onChange={(value) => {
                    const nextFormat = value as ExportFormat;
                    setFormat(nextFormat);
                    setColumns((current) =>
                      current.map((column) =>
                        column.key === '__serial'
                          ? { ...column, included: nextFormat === 'pdf' }
                          : column,
                      ),
                    );
                  }}
                />
                <StyledSelect
                  label='Records'
                  value={scope}
                  options={[
                    ...(hasSelectedRows
                      ? [{ value: 'selected', label: `Selected items (${selectedRows!.length})` }]
                      : []),
                    { value: 'filtered', label: `Current filtered results (${configuration.filteredRows.length})` },
                    { value: 'all', label: 'All inventory records' },
                  ]}
                  onChange={async (value) => {
                    const nextScope = value as ExportScope;
                    setScope(nextScope);
                    setBusy(true);
                    setError(null);
                    try {
                      const rowsForExport = await getRowsForScope(nextScope);
                      setPreviewSourceRows(rowsForExport);
                      if (!separateDiamonds && !separateStones) return;
                      setColumns((current) => {
                        let next = current;
                        if (separateDiamonds) next = replaceDetailedColumns(next, 'diamonds', rowsForExport);
                        if (separateStones) next = replaceDetailedColumns(next, 'stones', rowsForExport);
                        return next;
                      });
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Unable to refresh detailed columns.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                {format === 'pdf' && (
                  <StyledSelect
                    label='Page orientation'
                    value={orientation}
                    options={[
                      { value: 'landscape', label: 'Landscape' },
                      { value: 'portrait', label: 'Portrait' },
                    ]}
                    onChange={(value) => setOrientation(value as 'portrait' | 'landscape')}
                  />
                )}
              </div>
              <div className='export-columns-heading'>
                <div>
                  <h3>Choose and arrange columns</h3>
                  <p>Rename headings, include fields, or change their order.</p>
                </div>
                <span>{activeColumns.length} included</span>
              </div>
              <div className='export-column-list'>
                {columns.map((column, index) => {
                  const isDiamondType =
                    column.key.startsWith('__diamond_type_');
                  const isStoneType = column.key.startsWith('__stone_type_');
                  if (isDiamondType && !separateDiamonds) return null;
                  if (isStoneType && !separateStones) return null;

                  const isDiamondGroup = column.key === 'diamondDetails';
                  const isStoneGroup = column.key === 'stoneDetails';
                  const separateChecked = isDiamondGroup
                    ? separateDiamonds
                    : isStoneGroup
                      ? separateStones
                      : false;

                  return (
                    <div
                      className={`export-column-row${column.included ? '' : ' is-excluded'}`}
                      key={column.key}
                    >
                      <input
                        type='checkbox'
                        checked={column.included}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          if (
                            (isDiamondGroup && separateDiamonds) ||
                            (isStoneGroup && separateStones)
                          ) {
                            const prefix = isDiamondGroup
                              ? '__diamond_type_'
                              : '__stone_type_';
                            setColumns((current) =>
                              current.map((item) =>
                                item.key === column.key ||
                                item.key.startsWith(prefix)
                                  ? { ...item, included: checked }
                                  : item,
                              ),
                            );
                          } else {
                            updateColumn(column.key, { included: checked });
                          }
                        }}
                        aria-label={`Include ${column.label}`}
                      />
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <input
                          className='export-column-name'
                          style={{ flex: 1, width: 'auto' }}
                          value={column.outputLabel}
                          onChange={(event) =>
                            updateColumn(column.key, {
                              outputLabel: event.target.value,
                            })
                          }
                          aria-label={`Output heading for ${column.label}`}
                        />
                        {(isDiamondGroup || isStoneGroup) && (
                          <label
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              whiteSpace: 'nowrap',
                              fontSize: 12,
                              flexShrink: 0,
                            }}
                          >
                            <input
                              type='checkbox'
                              style={{
                                width: 15,
                                height: 15,
                                accentColor: '#957044',
                                margin: 0,
                              }}
                              checked={separateChecked}
                              onChange={(event) =>
                                void changeSeparateDetails(
                                  isDiamondGroup ? 'diamonds' : 'stones',
                                  event.target.checked,
                                )
                              }
                              disabled={busy}
                              aria-label={`Separate ${isDiamondGroup ? 'diamond' : 'stone'} details by type`}
                            />
                            Separate details
                          </label>
                        )}
                      </div>
                      <div className='export-order-buttons'>
                        <button
                          type='button'
                          onClick={() => moveColumn(index, -1)}
                          disabled={index === 0}
                          aria-label={`Move ${column.label} up`}
                        >
                          <svg aria-hidden='true' width='16' height='16' viewBox='0 0 24 24' fill='none'>
                            <path d='M12 19V5M6.5 11.5 12 5l5.5 6.5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
                          </svg>
                        </button>
                        <button
                          type='button'
                          onClick={() => moveColumn(index, 1)}
                          disabled={index === columns.length - 1}
                          aria-label={`Move ${column.label} down`}
                        >
                          <svg aria-hidden='true' width='16' height='16' viewBox='0 0 24 24' fill='none'>
                            <path d='M12 5v14m5.5-6.5L12 19l-5.5-6.5' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className='export-preview-heading'>
                <div>
                  <h3>Preview</h3>
                  <p>
                    Sample of the first five records. The final output uses your selected record scope.
                  </p>
                </div>
              </div>
              <div className='export-preview-table-wrap'>
                <table className='export-preview-table'>
                  <thead>
                    <tr>
                      {activeColumns.map((column) => (
                        <th key={column.key}>
                          {column.outputLabel || column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length ? (
                      previewRows.map((row, index) => (
                        <tr key={index}>
                          {activeColumns.map((column) => (
                            <td key={column.key}>
                              {column.key === '__serial'
                                ? index + 1
                                : cellText(column.value(row)) || '—'}
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={Math.max(1, activeColumns.length)}>
                          No filtered records to preview.
                        </td>
                      </tr>
                    )}
                    {previewTotalsRow && previewRows.length > 0 && (
                      <tr className='export-preview-totals-row'>
                        {previewTotalsRow.map((value, index) => (
                          <td key={activeColumns[index]?.key ?? index}>
                            {value || '—'}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <label className='export-totals-toggle'>
                  <input
                    type='checkbox'
                    checked={includeTotals}
                    onChange={(event) => setIncludeTotals(event.target.checked)}
                    disabled={busy}
                  />
                  <span className='export-totals-toggle-copy'>
                    <strong>Include totals row</strong>
                    <span>
                      {includeTotals
                        ? 'Totals for the five preview records are shown above.'
                        : 'Add weight and piece-count totals to the exported file.'}
                    </span>
                  </span>
              </label>
            </>
          )}
        </div>
        {error && (
          <p className='export-error' role='alert'>
            {error}
          </p>
        )}
        <footer className='export-footer'>
          <span>
             {scope === 'selected' && hasSelectedRows
              ? `Selected items (${selectedRows!.length})`
              : scope === 'all'
                ? 'All inventory records'
                : 'Current filtered results'}
            {' · '}
            {activeColumns.length} columns
          </span>
          <div>
            {step === 2 && (
              <button
                type='button'
                className='export-secondary-button'
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                disabled={busy}
              >
                Back
              </button>
            )}
            <button
              type='button'
              className='export-secondary-button'
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            {step === 1 ? (
              <button
                type='button'
                className='export-primary-button'
                onClick={async () => {
                  if (!activeColumns.length) {
                    setError('Choose at least one column to include.');
                    return;
                  }
                  setBusy(true);
                  setError(null);
                  try {
                    const rows = await getRowsForScope();
                    setPreviewSourceRows(rows);
                    setStep(2);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Unable to load preview records.');
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Preview items
              </button>
            ) : (
              <button
                type='button'
                className='export-primary-button'
                onClick={() => void exportData()}
                disabled={busy}
              >
                {busy ? (
                  'Preparing…'
                ) : (
                  <>
                    <svg
                      aria-hidden='true'
                      width='15'
                      height='15'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      style={{ verticalAlign: 'middle', marginRight: 7 }}
                    >
                      <path d='M12 3v12' />
                      <path d='m7 10 5 5 5-5' />
                      <path d='M5 19h14' />
                    </svg>
                    Export
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}

async function saveExportFile(
  filename: string,
  format: 'xlsx' | 'csv' | 'pdf',
  bytes: Uint8Array,
): Promise<void> {
  const filters: Record<
    'xlsx' | 'csv' | 'pdf',
    { name: string; extensions: string[] }[]
  > = {
    xlsx: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
    csv: [{ name: 'CSV file', extensions: ['csv'] }],
    pdf: [{ name: 'PDF document', extensions: ['pdf'] }],
  };

  const path = await save({
    defaultPath: filename,
    filters: [...filters[format]],
  });

  if (!path) return;

  await invoke('write_export_file', {
    path,
    bytes: Array.from(bytes),
  });
}

export default ExportDialog;
