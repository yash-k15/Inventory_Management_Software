import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import './ExhibitionInventory.css';
import type { ExhibitionInventoryRow } from './exhibition.queries';
import {
  getExhibitionInventory,
  registerExhibitionItems,
  unregisterExhibitionItem,
} from './exhibition.queries';

type Notice = { kind: 'success' | 'warning' | 'error'; text: string };
const EMPTY_FILTERS = { search: '', categoryId: null as number | null, registeredOnly: false };
type InventoryTab = 'available' | 'registered';
type SortKey = 'itemNumber' | 'categoryName' | 'grossWeightMilli' | 'netWeightMilli' | 'diamondDetails' | 'stoneDetails' | 'selectionCount';
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
    if (Number.isFinite(amount)) totals.set(unit, (totals.get(unit) ?? 0) + amount);
  }
  return totals;
}

function formatDetailTotals(rows: ExhibitionInventoryRow[], field: 'diamondDetails' | 'stoneDetails', defaultUnit: string) {
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

export default function ExhibitionInventory({ exhibitionId, exhibitionEnded, exhibitionUpcoming = false }: { exhibitionId: number; exhibitionEnded: boolean; exhibitionUpcoming?: boolean }) {
  const [items, setItems] = useState<ExhibitionInventoryRow[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeTab, setActiveTab] = useState<InventoryTab>('available');
  const [availableCategoryId, setAvailableCategoryId] = useState<number | null>(null);
  const [registeredCategoryId, setRegisteredCategoryId] = useState<number | null>(null);
  const [availableSelectedIds, setAvailableSelectedIds] = useState<number[]>([]);
  const [registeredSelectedIds, setRegisteredSelectedIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'itemNumber', direction: 'asc' });

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch the complete inventory so category chips and counts remain stable while searching.
      const rows = await getExhibitionInventory(exhibitionId, EMPTY_FILTERS);
      setItems(rows);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load exhibition inventory.' });
    } finally { setLoading(false); }
  }, [exhibitionId]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const availableItems = useMemo(() => items.filter((item) => !item.isRegistered), [items]);
  const registeredItems = useMemo(() => items.filter((item) => Boolean(item.isRegistered)), [items]);
  const matchesSearch = useCallback((item: ExhibitionInventoryRow) => {
    const query = filters.search.trim().toLocaleLowerCase();
    if (!query) return true;
    return [item.itemNumber, item.name, item.categoryName, item.igiCertificateNumber, item.huid, item.diamondDetails, item.stoneDetails]
      .some((value) => value?.toLocaleLowerCase().includes(query));
  }, [filters.search]);
  const categoriesFor = (source: ExhibitionInventoryRow[]) => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const item of source) {
      const current = map.get(item.categoryId) ?? { id: item.categoryId, name: item.categoryName, count: 0 };
      current.count += 1;
      map.set(item.categoryId, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  const availableCategories = useMemo(() => categoriesFor(availableItems), [availableItems]);
  const registeredCategories = useMemo(() => categoriesFor(registeredItems), [registeredItems]);
  const visibleAvailableItems = useMemo(() => availableItems.filter((item) => matchesSearch(item) && (availableCategoryId === null || item.categoryId === availableCategoryId)), [availableItems, availableCategoryId, matchesSearch]);
  const visibleRegisteredItems = useMemo(() => registeredItems.filter((item) => matchesSearch(item) && (registeredCategoryId === null || item.categoryId === registeredCategoryId)), [registeredItems, registeredCategoryId, matchesSearch]);

  function toggleSelected(id: number, checked: boolean, registered: boolean) {
    const setter = registered ? setRegisteredSelectedIds : setAvailableSelectedIds;
    setter((ids) => checked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((value) => value !== id));
  }

  async function handleRegister(ids: number[]) {
    const eligibleIds = ids.filter((id) => availableItems.some((item) => item.id === id));
    if (!eligibleIds.length || busy || exhibitionEnded) return;
    setBusy(true);
    try {
      const added = await registerExhibitionItems(exhibitionId, eligibleIds);
      setNotice({ kind: 'success', text: `${added} item${added === 1 ? '' : 's'} registered for this exhibition.` });
      setAvailableSelectedIds([]);
      await loadItems();
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to register selected items.' }); }
    finally { setBusy(false); }
  }

  async function handleUnregisterMany(ids: number[]) {
    const eligibleItems = registeredItems.filter((item) => ids.includes(item.id));
    if (!eligibleItems.length || busy || !exhibitionUpcoming || exhibitionEnded) return;

    const removableItems = eligibleItems.filter((item) => item.selectionCount === 0);
    const protectedCount = eligibleItems.length - removableItems.length;
    if (!removableItems.length) {
      setNotice({ kind: 'warning', text: 'Items with active customer selections cannot be removed. Remove those selections first.' });
      return;
    }

    const confirmation = window.confirm(
      `Remove ${removableItems.length} item${removableItems.length === 1 ? '' : 's'} from this exhibition?${protectedCount ? ` ${protectedCount} item${protectedCount === 1 ? '' : 's'} with active selections will be kept.` : ''}`
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
      setRegisteredSelectedIds([]);
      await loadItems();
      if (failed) {
        setNotice({ kind: 'warning', text: `${removed} item${removed === 1 ? '' : 's'} removed. ${failed} could not be removed.` });
      } else {
        setNotice({ kind: 'success', text: `${removed} item${removed === 1 ? '' : 's'} removed from this exhibition.` });
      }
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to remove items from this exhibition.' });
    } finally {
      setBusy(false);
    }
  }

  const currentItems = activeTab === 'available' ? visibleAvailableItems : visibleRegisteredItems;

  const sortedItems = useMemo(() => {
    const valueFor = (item: ExhibitionInventoryRow, key: SortKey): string | number => {
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
      let result = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
      if (left === '' && right !== '') result = 1;
      else if (right === '' && left !== '') result = -1;
      return sort.direction === 'asc' ? result : -result;
    });
  }, [currentItems, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: 'asc' });
  }

  function sortHeading(label: string, key: SortKey) {
    return <button type='button' className='exhibition-inventory-sort-button' onClick={() => changeSort(key)} aria-label={`Sort by ${label}`}>
      {label}<span aria-hidden='true'>{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
    </button>;
  }

  function renderInventoryTable(rows: ExhibitionInventoryRow[], registered: boolean) {
    const selected = registered ? registeredSelectedIds : availableSelectedIds;
    const selectable = rows.filter((item) => !registered || item.selectionCount === 0);
    const selectedVisibleCount = rows.filter((item) => selected.includes(item.id)).length;
    const selectedVisibleIds = rows.filter((item) => selected.includes(item.id)).map((item) => item.id);
    const allSelected = selectable.length > 0 && selectable.every((item) => selected.includes(item.id));
    const grossTotal = rows.reduce((sum, item) => sum + (item.grossWeightMilli ?? 0), 0);
    const netTotal = rows.reduce((sum, item) => sum + (item.netWeightMilli ?? 0), 0);
    const hasGrossWeight = rows.some((item) => item.grossWeightMilli != null);
    const hasNetWeight = rows.some((item) => item.netWeightMilli != null);
    const categoryId = registered ? registeredCategoryId : availableCategoryId;
    const categories = registered ? registeredCategories : availableCategories;
    return <>
      <div className='exhibition-inventory-list-controls'>
        <div className='exhibition-inventory-category-chips'>
          <button type='button' className={categoryId === null ? 'is-active' : ''} onClick={() => (registered ? setRegisteredCategoryId : setAvailableCategoryId)(null)}>All <span>{registered ? registeredItems.length : availableItems.length}</span></button>
          {categories.map((category) => <button type='button' key={category.id} className={categoryId === category.id ? 'is-active' : ''} onClick={() => (registered ? setRegisteredCategoryId : setAvailableCategoryId)(category.id)}>{category.name} <span>{category.count}</span></button>)}
        </div>
        <label className='exhibition-inventory-search exhibition-inventory-search--inline'><span aria-hidden='true'>⌕</span><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder='Search inventory…' aria-label='Search inventory' /></label>
      </div>
      {loading ? <div className='exhibition-inventory-empty'>Loading inventory…</div> : !rows.length ? <div className='exhibition-inventory-empty'><p>{registered ? 'No registered items match your search.' : 'No available inventory items match your search.'}</p></div> : <div className='exhibition-inventory-table-scroll'><table className='exhibition-inventory-table'>
        <thead><tr>
          <th className='exhibition-inventory-check-column'><input aria-label='Select all visible items' type='checkbox' checked={allSelected} disabled={!selectable.length || busy || exhibitionEnded} onChange={(event) => { const setter = registered ? setRegisteredSelectedIds : setAvailableSelectedIds; setter((ids) => event.target.checked ? [...new Set([...ids, ...selectable.map((item) => item.id)])] : ids.filter((id) => !selectable.some((item) => item.id === id))); }} /></th>
          <th>{sortHeading('Item', 'itemNumber')}</th><th>{sortHeading('Category', 'categoryName')}</th>
          <th>{sortHeading('Gold weight', 'grossWeightMilli')}</th><th>{sortHeading('Net weight', 'netWeightMilli')}</th>
          <th>{sortHeading('Diamonds', 'diamondDetails')}</th><th>{sortHeading('Other stones', 'stoneDetails')}</th>
          {registered && <th>{sortHeading('Selections', 'selectionCount')}</th>}
        </tr></thead>
        <tbody>{sortedItems.map((item) => <tr key={item.id}>
          <td className='exhibition-inventory-check-column'><input type='checkbox' aria-label={`Select ${item.itemNumber}`} checked={selected.includes(item.id)} disabled={busy || exhibitionEnded || (registered && item.selectionCount > 0)} title={registered && item.selectionCount > 0 ? 'Remove active customer selections first' : undefined} onChange={(event) => toggleSelected(item.id, event.target.checked, registered)} /></td>
          <td><div className='exhibition-inventory-item-cell'>{item.imagePath ? <InventoryImage path={item.imagePath} /> : <span className='exhibition-inventory-item-image exhibition-inventory-item-image--empty'>◇</span>}<span className='exhibition-inventory-item-copy'><strong className='exhibition-inventory-item-number'>{item.itemNumber}</strong>{item.name && <span className='exhibition-inventory-item-name'>{item.name}</span>}{Boolean(item.isArchived) && <span className='exhibition-inventory-archived'>Archived</span>}</span></div></td>
          <td>{item.categoryName}</td><td>{formatWeight(item.grossWeightMilli)}</td><td>{formatWeight(item.netWeightMilli)}</td>
          <td><span className='exhibition-inventory-details'>{item.diamondDetails ?? '—'}</span></td><td><span className='exhibition-inventory-details'>{item.stoneDetails ?? '—'}</span></td>
          {registered && <td><span className='exhibition-inventory-selection-label'>{item.selectionCount ? `${item.selectionCount} active` : 'None'}</span></td>}
        </tr>)}</tbody>
        <tfoot><tr className='exhibition-inventory-totals-row'><td></td><td colSpan={2}>Totals ({rows.length} items)</td><td>{hasGrossWeight ? formatWeight(grossTotal) : '—'}</td><td>{hasNetWeight ? formatWeight(netTotal) : '—'}</td><td>{formatDetailTotals(rows, 'diamondDetails', 'ct')}</td><td>{formatDetailTotals(rows, 'stoneDetails', 'ct')}</td>{registered && <td>—</td>}</tr></tfoot>
      </table></div>}
      <footer className='exhibition-inventory-table-footer'>{rows.length} {registered ? 'registered items' : 'available items'}{selected.length ? ` · ${selected.length} selected` : ''}</footer>
      <div className='exhibition-inventory-bulk-actions'>
        <label className='exhibition-inventory-select-visible'><input type='checkbox' checked={allSelected} disabled={!selectable.length || busy || exhibitionEnded} onChange={(event) => { const setter = registered ? setRegisteredSelectedIds : setAvailableSelectedIds; setter((ids) => event.target.checked ? [...new Set([...ids, ...selectable.map((item) => item.id)])] : ids.filter((id) => !selectable.some((item) => item.id === id))); }} /> Select all visible</label>
        <div className='exhibition-inventory-bulk-buttons'>
          {registered ? <><button type='button' className='exhibition-overview-secondary' disabled={!exhibitionUpcoming || busy || exhibitionEnded || !selectedVisibleCount} title={exhibitionEnded ? 'Registered inventory is frozen after the exhibition ends.' : exhibitionUpcoming ? 'Items with active customer selections cannot be removed.' : 'Items cannot be removed while the exhibition is active.'} onClick={() => void handleUnregisterMany(selectedVisibleIds)}>Remove selected ({selectedVisibleCount})</button><button type='button' className='exhibition-overview-primary' disabled={!exhibitionUpcoming || busy || exhibitionEnded || !selectable.length} title={exhibitionEnded ? 'Registered inventory is frozen after the exhibition ends.' : exhibitionUpcoming ? 'Items with active customer selections cannot be removed.' : 'Items cannot be removed while the exhibition is active.'} onClick={() => void handleUnregisterMany(selectable.map((item) => item.id))}>Remove all</button></> : <><button type='button' className='exhibition-overview-secondary' disabled={!selectedVisibleCount || busy || exhibitionEnded} onClick={() => void handleRegister(selectedVisibleIds)}>Add selected ({selectedVisibleCount})</button><button type='button' className='exhibition-overview-primary' disabled={!rows.length || busy || exhibitionEnded} onClick={() => void handleRegister(rows.map((item) => item.id))}>Add all</button></>}
        </div>
      </div>
    </>;
  }

  return <section className='exhibition-inventory'>
    {exhibitionEnded && <p className='exhibition-inventory-frozen'>This exhibition has ended. Its registered inventory is frozen.</p>}
    {notice && <div className={`exhibition-inventory-notice exhibition-inventory-notice--${notice.kind}`} role='status'><span>{notice.text}</span><button type='button' aria-label='Dismiss message' onClick={() => setNotice(null)}>×</button></div>}
    <div className='exhibition-inventory-tabs' role='tablist' aria-label='Exhibition inventory lists'>
      <button type='button' role='tab' aria-selected={activeTab === 'available'} className={activeTab === 'available' ? 'is-active' : ''} onClick={() => setActiveTab('available')}>Inventory <span>{availableItems.length}</span></button>
      <button type='button' role='tab' aria-selected={activeTab === 'registered'} className={activeTab === 'registered' ? 'is-active' : ''} onClick={() => setActiveTab('registered')}>Registered Inventory <span>{registeredItems.length}</span></button>
    </div>
    <div className='exhibition-inventory-table-card'>
      {renderInventoryTable(sortedItems, activeTab === 'registered')}
    </div>
  </section>;
}

function InventoryImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Inventory image paths are stored relative to the app data directory.
        // Resolve them to an absolute path before authorizing and loading them.
        const absolutePath = path.startsWith('/') ? path : await join(await appDataDir(), path);
        await invoke('allow_image_preview', { path: absolutePath });
        if (alive) setSrc(convertFileSrc(absolutePath));
      } catch (error) {
        console.error('Exhibition inventory image failed to load:', path, error);
        if (alive) setSrc(null);
      }
    })();
    return () => { alive = false; };
  }, [path]);
  return src ? <img className='exhibition-inventory-item-image' src={src} alt='' onError={() => setSrc(null)} /> : <span className='exhibition-inventory-item-image exhibition-inventory-item-image--empty'>◇</span>;
}
