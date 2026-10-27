import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import './ExhibitionInventory.css';
import JewelryTagPreview from '../tags/JewelryTagPreview';
import type { InventoryItem } from '../inventory/inventory.types';
import type { ExhibitionInventoryRow } from './exhibition.queries';
import {
  getExhibitionInventory,
  registerExhibitionItems,
  unregisterExhibitionItem,
} from './exhibition.queries';

type Notice = { kind: 'success' | 'warning' | 'error'; text: string };
const EMPTY_FILTERS = {
  search: '',
  categoryId: null as number | null,
  registeredOnly: false,
};
type InventoryTab = 'available' | 'registered';
type SortKey =
  | 'itemNumber'
  | 'categoryName'
  | 'grossWeightMilli'
  | 'netWeightMilli'
  | 'diamondDetails'
  | 'stoneDetails'
  | 'selectionCount';
type SortState = { key: SortKey; direction: 'asc' | 'desc' };

function formatWeight(value: number | null) {
  return value == null ? '—' : `${(value / 1000).toFixed(3)} g`;
}

function parseDetailWeights(details: string | null): Map<string, number> {
  const totals = new Map<string, number>();
  if (!details) return totals;
  for (const line of details.split(/\r?\n/)) {
    const match = line.match(/·\s*([\d,.]+)\s*(ct|g|mg)\b/i);
    if (!match) continue;
    const amount = Number(match[1].replace(/,/g, ''));
    const unit = match[2].toLowerCase();
    if (Number.isFinite(amount))
      totals.set(unit, (totals.get(unit) ?? 0) + amount);
  }
  return totals;
}

function formatDetailTotals(
  rows: ExhibitionInventoryRow[],
  field: 'diamondDetails' | 'stoneDetails',
  defaultUnit: string,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [unit, amount] of parseDetailWeights(row[field])) {
      totals.set(unit, (totals.get(unit) ?? 0) + amount);
    }
  }
  if (!totals.size) return '—';
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, amount]) => `${amount.toFixed(3)} ${unit || defaultUnit}`)
    .join(' · ');
}

export default function ExhibitionInventory({
  exhibitionId,
  exhibitionEnded,
  exhibitionUpcoming = false,
  onInventoryChanged,
}: {
  exhibitionId: number;
  exhibitionEnded: boolean;
  exhibitionUpcoming?: boolean;
  onInventoryChanged?: () => Promise<void>;
}) {
  const [items, setItems] = useState<ExhibitionInventoryRow[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeTab, setActiveTab] = useState<InventoryTab>('registered');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [availableCategoryIds, setAvailableCategoryIds] = useState<number[]>(
    [],
  );
  const [registeredCategoryIds, setRegisteredCategoryIds] = useState<number[]>(
    [],
  );
  // One shared row selection drives both tag printing and inventory actions.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showTagPreview, setShowTagPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState>({
    key: 'itemNumber',
    direction: 'asc',
  });

  useEffect(() => {
    setCurrentPage(1);
  }, [
    activeTab,
    filters.search,
    availableCategoryIds,
    registeredCategoryIds,
    sort,
    pageSize,
  ]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch the complete inventory so category chips and counts remain stable while searching.
      const rows = await getExhibitionInventory(exhibitionId, EMPTY_FILTERS);
      setItems(rows);
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Unable to load exhibition inventory.',
      });
    } finally {
      setLoading(false);
    }
  }, [exhibitionId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  const availableItems = useMemo(
    () => items.filter((item) => !item.isRegistered && !item.isArchived),
    [items],
  );
  const registeredItems = useMemo(
    () => items.filter((item) => Boolean(item.isRegistered)),
    [items],
  );
  const tagPreviewItems = useMemo<InventoryItem[]>(
    () =>
      items
        .filter((item) => selectedIds.includes(item.id))
        .map((item) => ({
          ...item,
          diamondDetails: item.diamondDetails,
          stoneDetails: item.stoneDetails,
          purityName: null,
          purityPercentBp: null,
          notes: null,
          customValues: '',
        })),
    [items, selectedIds],
  );
  const matchesSearch = useCallback(
    (item: ExhibitionInventoryRow) => {
      const query = filters.search.trim().toLocaleLowerCase();
      if (!query) return true;
      return [
        item.itemNumber,
        item.name,
        item.categoryName,
        item.igiCertificateNumber,
        item.huid,
        item.diamondDetails,
        item.stoneDetails,
      ].some((value) => value?.toLocaleLowerCase().includes(query));
    },
    [filters.search],
  );
  const categoriesFor = (source: ExhibitionInventoryRow[]) => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const item of source) {
      const current = map.get(item.categoryId) ?? {
        id: item.categoryId,
        name: item.categoryName,
        count: 0,
      };
      current.count += 1;
      map.set(item.categoryId, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const availableCategories = useMemo(
    () => categoriesFor(availableItems),
    [availableItems],
  );
  const registeredCategories = useMemo(
    () => categoriesFor(registeredItems),
    [registeredItems],
  );
  const visibleAvailableItems = useMemo(
    () =>
      availableItems.filter(
        (item) =>
          matchesSearch(item) &&
          (!availableCategoryIds.length ||
            availableCategoryIds.includes(item.categoryId)),
      ),
    [availableItems, availableCategoryIds, matchesSearch],
  );
  const visibleRegisteredItems = useMemo(
    () =>
      registeredItems.filter(
        (item) =>
          matchesSearch(item) &&
          (!registeredCategoryIds.length ||
            registeredCategoryIds.includes(item.categoryId)),
      ),
    [registeredItems, registeredCategoryIds, matchesSearch],
  );

  function toggleSelected(id: number, checked: boolean) {
    setSelectedIds((ids) =>
      checked
        ? ids.includes(id)
          ? ids
          : [...ids, id]
        : ids.filter((value) => value !== id),
    );
  }

  async function handleRegister(ids: number[]) {
    const eligibleIds = ids.filter((id) =>
      availableItems.some((item) => item.id === id),
    );
    if (!eligibleIds.length || busy || exhibitionEnded) return;
    setBusy(true);
    try {
      const added = await registerExhibitionItems(exhibitionId, eligibleIds);
      setNotice({
        kind: 'success',
        text: `${added} item${added === 1 ? '' : 's'} registered for this exhibition.`,
      });
      setSelectedIds([]);
      await loadItems();
      await onInventoryChanged?.();
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Unable to register selected items.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleUnregisterMany(ids: number[]) {
    const eligibleItems = registeredItems.filter((item) =>
      ids.includes(item.id),
    );
    if (!eligibleItems.length || busy || !exhibitionUpcoming || exhibitionEnded)
      return;

    const removableItems = eligibleItems.filter(
      (item) => item.selectionCount === 0,
    );
    const protectedCount = eligibleItems.length - removableItems.length;
    if (!removableItems.length) {
      setNotice({
        kind: 'warning',
        text: 'Items with active customer selections cannot be removed. Remove those selections first.',
      });
      return;
    }

    const confirmation = window.confirm(
      `Remove ${removableItems.length} item${removableItems.length === 1 ? '' : 's'} from this exhibition?${protectedCount ? ` ${protectedCount} item${protectedCount === 1 ? '' : 's'} with active selections will be kept.` : ''}`,
    );
    if (!confirmation) return;

    setBusy(true);
    try {
      let removed = 0;
      let failed = 0;
      for (const item of removableItems) {
        try {
          await unregisterExhibitionItem(exhibitionId, item.id);
          removed += 1;
        } catch {
          failed += 1;
        }
      }
      setSelectedIds([]);
      await loadItems();
      if (removed > 0) await onInventoryChanged?.();
      if (failed) {
        setNotice({
          kind: 'warning',
          text: `${removed} item${removed === 1 ? '' : 's'} removed. ${failed} could not be removed.`,
        });
      } else {
        setNotice({
          kind: 'success',
          text: `${removed} item${removed === 1 ? '' : 's'} removed from this exhibition.`,
        });
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Unable to remove items from this exhibition.',
      });
    } finally {
      setBusy(false);
    }
  }

  const currentItems =
    activeTab === 'available' ? visibleAvailableItems : visibleRegisteredItems;

  const sortedItems = useMemo(() => {
    const valueFor = (
      item: ExhibitionInventoryRow,
      key: SortKey,
    ): string | number => {
      if (key === 'diamondDetails' || key === 'stoneDetails') {
        const unitTotals = parseDetailWeights(item[key]);
        if (!unitTotals.size) return '';
        // Normalize all supported units to grams for a meaningful numeric sort.
        return [...unitTotals.entries()].reduce((sum, [unit, amount]) => {
          if (unit === 'ct') return sum + amount * 0.2;
          if (unit === 'mg') return sum + amount / 1000;
          return sum + amount;
        }, 0);
      }
      const value = item[key];
      if (value == null) return '';
      return typeof value === 'number' ? value : value.toLocaleLowerCase();
    };
    return [...currentItems].sort((a, b) => {
      const left = valueFor(a, sort.key);
      const right = valueFor(b, sort.key);
      let result =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, {
              numeric: true,
              sensitivity: 'base',
            });
      if (left === '' && right !== '') result = 1;
      else if (right === '' && left !== '') result = -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [currentItems, sort]);

  function changeSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  }

  function sortHeading(label: string, key: SortKey) {
    return (
      <button
        type='button'
        className='exhibition-inventory-sort-button'
        onClick={() => changeSort(key)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden='true'>
          {sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
        </span>
      </button>
    );
  }

  function renderInventoryTable(
    rows: ExhibitionInventoryRow[],
    registered: boolean,
  ) {
    const selected = selectedIds;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const safeCurrentPage = Math.min(currentPage, pageCount);
    const pageRows = rows.slice(
      (safeCurrentPage - 1) * pageSize,
      safeCurrentPage * pageSize,
    );
    const firstRow = rows.length ? (safeCurrentPage - 1) * pageSize + 1 : 0;
    const lastRow = Math.min(safeCurrentPage * pageSize, rows.length);
    // Checked items with active customer selections remain printable, but are
    // excluded from removal counts and removal actions.
    const selectable = rows.filter(
      (item) => !registered || item.selectionCount === 0,
    );
    const selectedVisibleIds = rows
      .filter((item) => selected.includes(item.id))
      .map((item) => item.id);
    const removableSelectedIds = rows
      .filter((item) => selected.includes(item.id) && (!registered || item.selectionCount === 0))
      .map((item) => item.id);
    const selectedVisibleCount = removableSelectedIds.length;
    const allSelected =
      rows.length > 0 && rows.every((item) => selected.includes(item.id));
    const grossTotal = rows.reduce(
      (sum, item) => sum + (item.grossWeightMilli ?? 0),
      0,
    );
    const netTotal = rows.reduce(
      (sum, item) => sum + (item.netWeightMilli ?? 0),
      0,
    );
    const hasGrossWeight = rows.some((item) => item.grossWeightMilli != null);
    const hasNetWeight = rows.some((item) => item.netWeightMilli != null);
    const categoryIds = registered
      ? registeredCategoryIds
      : availableCategoryIds;
    const setCategoryIds = registered
      ? setRegisteredCategoryIds
      : setAvailableCategoryIds;
    const categories = registered ? registeredCategories : availableCategories;
    const toggleCategory = (id: number) =>
      setCategoryIds((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
    return (
      <>
        <div className='exhibition-inventory-list-controls'>
          <div className='exhibition-inventory-category-chips'>
            <button
              type='button'
              aria-pressed={categoryIds.length === 0}
              className={categoryIds.length === 0 ? 'is-active' : ''}
              onClick={() => setCategoryIds([])}
            >
              All{' '}
              <span>
                {registered ? registeredItems.length : availableItems.length}
              </span>
            </button>
            {categories.map((category) => (
              <button
                type='button'
                key={category.id}
                aria-pressed={categoryIds.includes(category.id)}
                className={categoryIds.includes(category.id) ? 'is-active' : ''}
                onClick={() => toggleCategory(category.id)}
              >
                {category.name} <span>{category.count}</span>
              </button>
            ))}
          </div>
          <label className='exhibition-inventory-search exhibition-inventory-search--inline'>
            <span aria-hidden='true'>⌕</span>
            <input
              value={filters.search}
              onChange={(e) =>
                setFilters((f) => ({ ...f, search: e.target.value }))
              }
              placeholder='Search inventory…'
              aria-label='Search inventory'
            />
          </label>
        </div>
        {loading ? (
          <div className='exhibition-inventory-empty'>Loading inventory…</div>
        ) : !rows.length ? (
          <div className='exhibition-inventory-empty'>
            <p>
              {registered
                ? 'No registered items match your search.'
                : 'No available inventory items match your search.'}
            </p>
          </div>
        ) : (
          <div className='exhibition-inventory-table-scroll'>
            <table className='exhibition-inventory-table'>
              <thead>
                <tr>
                  <th className='exhibition-inventory-check-column'>
                    <input
                      aria-label='Select all visible items'
                      type='checkbox'
                      checked={allSelected}
                      disabled={!rows.length || busy || exhibitionEnded}
                      onChange={(event) =>
                        setSelectedIds((ids) =>
                          event.target.checked
                            ? [...new Set([...ids, ...rows.map((item) => item.id)])]
                            : ids.filter((id) => !rows.some((item) => item.id === id)),
                        )
                      }
                    />
                  </th>
                  <th className='exhibition-inventory-serial-column'>S.No.</th>
                  <th>{sortHeading('Item', 'itemNumber')}</th>
                  <th>{sortHeading('Category', 'categoryName')}</th>
                  <th>{sortHeading('Gold weight', 'grossWeightMilli')}</th>
                  <th>{sortHeading('Net weight', 'netWeightMilli')}</th>
                  <th>{sortHeading('Diamonds', 'diamondDetails')}</th>
                  <th>{sortHeading('Other stones', 'stoneDetails')}</th>
                  {registered && (
                    <th>{sortHeading('Selections', 'selectionCount')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item, index) => (
                  <tr key={item.id}>
                    <td className='exhibition-inventory-check-column'>
                      <input
                        type='checkbox'
                        aria-label={`Select ${item.itemNumber}`}
                        checked={selected.includes(item.id)}
                        disabled={busy || exhibitionEnded}
                        title={
                          registered && item.selectionCount > 0
                            ? 'Can be printed, but cannot be removed while customer selections are active'
                            : undefined
                        }
                        onChange={(event) =>
                          toggleSelected(item.id, event.target.checked)
                        }
                      />
                    </td>
                    <td className='exhibition-inventory-serial-column'>{firstRow + index}</td>
                    <td>
                      <div className='exhibition-inventory-item-cell'>
                        {item.imagePath ? (
                          <InventoryImage path={item.imagePath} />
                        ) : (
                          <span className='exhibition-inventory-item-image exhibition-inventory-item-image--empty'>
                            ◇
                          </span>
                        )}
                        <span className='exhibition-inventory-item-copy'>
                          <strong className='exhibition-inventory-item-number'>
                            {item.itemNumber}
                          </strong>
                          {item.name && (
                            <span className='exhibition-inventory-item-name'>
                              {item.name}
                            </span>
                          )}
                          {Boolean(item.isArchived) && (
                            <span className='exhibition-inventory-archived'>
                              Archived
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td>{item.categoryName}</td>
                    <td>{formatWeight(item.grossWeightMilli)}</td>
                    <td>{formatWeight(item.netWeightMilli)}</td>
                    <td>
                      <span className='exhibition-inventory-details'>
                        {item.diamondDetails ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className='exhibition-inventory-details'>
                        {item.stoneDetails ?? '—'}
                      </span>
                    </td>
                    {registered && (
                      <td>
                        <span className='exhibition-inventory-selection-label'>
                          {item.selectionCount
                            ? `${item.selectionCount} active`
                            : 'None'}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className='exhibition-inventory-totals-row'>
                  <td></td>
                  <td></td>
                  <td colSpan={2}>Totals ({rows.length} items)</td>
                  <td>{hasGrossWeight ? formatWeight(grossTotal) : '—'}</td>
                  <td>{hasNetWeight ? formatWeight(netTotal) : '—'}</td>
                  <td>{formatDetailTotals(rows, 'diamondDetails', 'ct')}</td>
                  <td>{formatDetailTotals(rows, 'stoneDetails', 'ct')}</td>
                  {registered && <td>—</td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <footer className='exhibition-inventory-table-footer'>
          {rows.length} {registered ? 'registered items' : 'available items'}
          {selected.length ? ` · ${selected.length} selected` : ''}
        </footer>
        {rows.length > 0 && (
          <div className='exhibition-inventory-pagination'>
            <div className='exhibition-inventory-pagination-summary'>
              Showing {firstRow}–{lastRow} of {rows.length} items
            </div>
            <div className='exhibition-inventory-pagination-controls'>
              <label className='exhibition-inventory-page-size'>
                Rows per page
                <select
                  value={pageSize}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  aria-label='Rows per page'
                >
                  {[10, 25, 50, 100].map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
              </label>
              <button type='button' onClick={() => setCurrentPage(1)} disabled={safeCurrentPage === 1} aria-label='First page'>«</button>
              <button type='button' onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safeCurrentPage === 1} aria-label='Previous page'>‹</button>
              <span>Page {safeCurrentPage} of {pageCount}</span>
              <button type='button' onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))} disabled={safeCurrentPage === pageCount} aria-label='Next page'>›</button>
              <button type='button' onClick={() => setCurrentPage(pageCount)} disabled={safeCurrentPage === pageCount} aria-label='Last page'>»</button>
            </div>
          </div>
        )}
        <div className='exhibition-inventory-bulk-actions'>
          <label className='exhibition-inventory-select-visible'>
            <input
              type='checkbox'
              checked={allSelected}
              disabled={!rows.length || busy || exhibitionEnded}
              onChange={(event) =>
                setSelectedIds((ids) =>
                  event.target.checked
                    ? [...new Set([...ids, ...rows.map((item) => item.id)])]
                    : ids.filter((id) => !rows.some((item) => item.id === id)),
                )
              }
            />{' '}
            Select all visible
          </label>
          <div className='exhibition-inventory-bulk-buttons'>
            <button
              type='button'
              className='exhibition-overview-primary'
              disabled={!selectedIds.length || loading || showTagPreview}
              onClick={() => setShowTagPreview(true)}
            >
              Print tags ({selectedIds.length})
            </button>
            {registered ? (
              <>
                <button
                  type='button'
                  className='exhibition-overview-secondary'
                  disabled={
                    !exhibitionUpcoming ||
                    busy ||
                    exhibitionEnded ||
                    !selectedVisibleCount
                  }
                  title={
                    exhibitionEnded
                      ? 'Registered inventory is frozen after the exhibition ends.'
                      : exhibitionUpcoming
                        ? 'Items with active customer selections cannot be removed.'
                        : 'Items cannot be removed while the exhibition is active.'
                  }
                  onClick={() => void handleUnregisterMany(removableSelectedIds)}
                >
                  Remove selected ({selectedVisibleCount})
                </button>
                <button
                  type='button'
                  className='exhibition-overview-primary'
                  disabled={
                    !exhibitionUpcoming ||
                    busy ||
                    exhibitionEnded ||
                    !selectable.length
                  }
                  title={
                    exhibitionEnded
                      ? 'Registered inventory is frozen after the exhibition ends.'
                      : exhibitionUpcoming
                        ? 'Items with active customer selections cannot be removed.'
                        : 'Items cannot be removed while the exhibition is active.'
                  }
                  onClick={() =>
                    void handleUnregisterMany(selectable.map((item) => item.id))
                  }
                >
                  Remove all
                </button>
              </>
            ) : (
              <>
                <button
                  type='button'
                  className='exhibition-overview-secondary'
                  disabled={!selectedVisibleCount || busy || exhibitionEnded}
                  onClick={() => void handleRegister(selectedVisibleIds)}
                >
                  Add selected ({selectedVisibleCount})
                </button>
                <button
                  type='button'
                  className='exhibition-overview-primary'
                  disabled={!rows.length || busy || exhibitionEnded}
                  onClick={() =>
                    void handleRegister(rows.map((item) => item.id))
                  }
                >
                  Add all
                </button>
              </>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <section className='exhibition-inventory'>
      {exhibitionEnded && (
        <p className='exhibition-inventory-frozen'>
          This exhibition has ended. Its registered inventory is frozen.
        </p>
      )}
      {notice && (
        <div
          className={`exhibition-inventory-notice exhibition-inventory-notice--${notice.kind}`}
          role='status'
        >
          <span>{notice.text}</span>
          <button
            type='button'
            aria-label='Dismiss message'
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      <div
        className='exhibition-inventory-tabs'
        role='tablist'
        aria-label='Exhibition inventory lists'
      >
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'registered'}
          className={activeTab === 'registered' ? 'is-active' : ''}
          onClick={() => setActiveTab('registered')}
        >
          Registered Inventory <span>{registeredItems.length}</span>
        </button>
        <button
          type='button'
          role='tab'
          aria-selected={activeTab === 'available'}
          className={activeTab === 'available' ? 'is-active' : ''}
          onClick={() => setActiveTab('available')}
        >
          Available Inventory <span>{availableItems.length}</span>
        </button>
      </div>
      <div className='exhibition-inventory-table-card'>
        {renderInventoryTable(sortedItems, activeTab === 'registered')}
      </div>
    </section>
    {showTagPreview && tagPreviewItems.length > 0 && (
      <JewelryTagPreview
        items={tagPreviewItems}
        onClose={() => {
          setShowTagPreview(false);
          setSelectedIds([]);
        }}
      />
    )}
    </>
  );
}

function InventoryImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPreviewTimer = () => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  };

  const handleMouseEnter = (event: MouseEvent<HTMLImageElement>) => {
    if (!src) return;
    clearPreviewTimer();

    const rect = event.currentTarget.getBoundingClientRect();
    const previewWidth = Math.min(420, window.innerWidth - 32);
    const previewHeight = Math.min(560, window.innerHeight - 32);
    const left =
      rect.right + previewWidth + 16 <= window.innerWidth
        ? rect.right + 16
        : Math.max(16, rect.left - previewWidth - 16);
    const top = Math.min(
      Math.max(16, rect.top),
      Math.max(16, window.innerHeight - previewHeight - 16),
    );

    previewTimerRef.current = setTimeout(() => {
      setPreview({ left, top });
      previewTimerRef.current = null;
    }, 1500);
  };

  const handleMouseLeave = () => {
    clearPreviewTimer();
    setPreview(null);
  };

  useEffect(() => () => clearPreviewTimer(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Inventory image paths are stored relative to the app data directory.
        // Resolve them to an absolute path before authorizing and loading them.
        const absolutePath = path.startsWith('/')
          ? path
          : await join(await appDataDir(), path);
        await invoke('allow_image_preview', { path: absolutePath });
        if (alive) setSrc(convertFileSrc(absolutePath));
      } catch (error) {
        console.error(
          'Exhibition inventory image failed to load:',
          path,
          error,
        );
        if (alive) setSrc(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <>
      {src ? (
        <img
          className='exhibition-inventory-item-image'
          src={src}
          alt=''
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onError={() => {
            handleMouseLeave();
            setSrc(null);
          }}
        />
      ) : (
        <span className='exhibition-inventory-item-image exhibition-inventory-item-image--empty'>
          ◇
        </span>
      )}
      {preview && src && (
        <div
          className='exhibition-inventory-image-preview'
          style={{ left: preview.left, top: preview.top }}
          aria-hidden='true'
        >
          <img src={src} alt='' />
        </div>
      )}
    </>
  );
}
