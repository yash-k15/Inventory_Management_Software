import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import type { FormEvent } from 'react';
import type { ExhibitionInventoryRow } from './exhibition.queries';
import {
  getExhibitionInventory,
  registerExhibitionItemByBarcode,
  registerExhibitionItems,
  unregisterExhibitionItem,
} from './exhibition.queries';

type Notice = { kind: 'success' | 'warning' | 'error'; text: string };
const EMPTY_FILTERS = { search: '', categoryId: null as number | null, registeredOnly: false };

function formatWeight(value: number | null) {
  return value == null ? '—' : `${(value / 1000).toFixed(3)} g`;
}

export default function ExhibitionInventory({ exhibitionId, exhibitionEnded }: { exhibitionId: number; exhibitionEnded: boolean }) {
  const [items, setItems] = useState<ExhibitionInventoryRow[]>([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [modalCategory, setModalCategory] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [scanValue, setScanValue] = useState('');
  const [busy, setBusy] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getExhibitionInventory(exhibitionId, filters);
      setItems(rows);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to load exhibition inventory.' });
    } finally { setLoading(false); }
  }, [exhibitionId, filters]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  const categories = useMemo(() => {
    const map = new Map<number, { id: number; name: string; count: number }>();
    for (const item of items) {
      const current = map.get(item.categoryId) ?? { id: item.categoryId, name: item.categoryName, count: 0 };
      current.count += item.isRegistered;
      map.set(item.categoryId, current);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const modalItems = useMemo(() => items.filter((item) => {
    const search = modalSearch.trim().toLowerCase();
    return !item.isRegistered && (!modalCategory || item.categoryId === modalCategory) &&
      (!search || `${item.itemNumber} ${item.name ?? ''} ${item.categoryName} ${item.igiCertificateNumber ?? ''} ${item.huid ?? ''}`.toLowerCase().includes(search));
  }), [items, modalSearch, modalCategory]);

  async function handleScan(event?: FormEvent) {
    event?.preventDefault();
    if (!scanValue.trim() || busy || exhibitionEnded) return;
    setBusy(true);
    try {
      const result = await registerExhibitionItemByBarcode(exhibitionId, scanValue);
      if (result === 'registered') setNotice({ kind: 'success', text: `${scanValue.trim()} registered for this exhibition.` });
      else if (result === 'already-registered') setNotice({ kind: 'warning', text: `${scanValue.trim()} is already registered.` });
      else setNotice({ kind: 'error', text: `No inventory item found for barcode “${scanValue.trim()}”.` });
      setScanValue('');
      await loadItems();
      scanRef.current?.focus();
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Barcode registration failed.' }); }
    finally { setBusy(false); }
  }

  async function handleRegisterSelected() {
    if (!selectedIds.length || busy) return;
    setBusy(true);
    try {
      const added = await registerExhibitionItems(exhibitionId, selectedIds);
      setNotice({ kind: 'success', text: `${added} item${added === 1 ? '' : 's'} registered for this exhibition.` });
      setModalOpen(false); setSelectedIds([]); setModalSearch(''); await loadItems();
    } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to register selected items.' }); }
    finally { setBusy(false); }
  }

  async function handleUnregister(item: ExhibitionInventoryRow) {
    if (busy || exhibitionEnded) return;
    if (!window.confirm(`Remove ${item.itemNumber} from this exhibition? This does not delete the inventory item.`)) return;
    setBusy(true);
    try { await unregisterExhibitionItem(exhibitionId, item.id); setNotice({ kind: 'success', text: `${item.itemNumber} removed from this exhibition.` }); await loadItems(); }
    catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Unable to remove registration.' }); }
    finally { setBusy(false); }
  }

  return <section className='exhibition-inventory'>
    <div className='exhibition-inventory-toolbar'>
      <label className='exhibition-inventory-search'><span aria-hidden='true'>⌕</span><input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder='Search item number, name, certificate…' aria-label='Search inventory' /></label>
      <select value={filters.categoryId ?? ''} onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value ? Number(e.target.value) : null }))} aria-label='Filter category'><option value=''>All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <button type='button' className='exhibition-overview-primary' onClick={() => { setModalOpen(true); setSelectedIds([]); }} disabled={exhibitionEnded}>＋ Register inventory</button>
    </div>
    <form className='exhibition-inventory-quick-register' onSubmit={handleScan}><strong>Quick barcode registration</strong><input ref={scanRef} className='exhibition-inventory-barcode' value={scanValue} onChange={(e) => setScanValue(e.target.value)} placeholder='Scan or enter item number' disabled={exhibitionEnded || busy} /><button type='submit' className='exhibition-overview-secondary' disabled={exhibitionEnded || busy || !scanValue.trim()}>{busy ? 'Working…' : 'Register'}</button></form>
    {exhibitionEnded && <p className='exhibition-inventory-frozen'>This exhibition has ended. Its registered inventory is frozen.</p>}
    {notice && <div className={`exhibition-inventory-notice exhibition-inventory-notice--${notice.kind}`} role='status'><span>{notice.text}</span><button type='button' aria-label='Dismiss message' onClick={() => setNotice(null)}>×</button></div>}
    <div className='exhibition-inventory-table-card'>
      <div className='exhibition-inventory-category-chips'><button type='button' className={!filters.categoryId ? 'is-active' : ''} onClick={() => setFilters((f) => ({ ...f, categoryId: null }))}>All <span>{items.filter((i) => i.isRegistered).length}</span></button>{categories.map((c) => <button type='button' key={c.id} className={filters.categoryId === c.id ? 'is-active' : ''} onClick={() => setFilters((f) => ({ ...f, categoryId: f.categoryId === c.id ? null : c.id }))}>{c.name} <span>{c.count}</span></button>)}</div>
      {loading ? <div className='exhibition-inventory-empty'>Loading inventory…</div> : !items.length ? <div className='exhibition-inventory-empty'><p>No inventory items match your search.</p></div> : <div className='exhibition-inventory-table-scroll'><table className='exhibition-inventory-table'><thead><tr><th>Item</th><th>Category</th><th>Gold weight</th><th>Diamonds</th><th>Other stones</th><th>Certification</th><th>Selections</th><th>Exhibition</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><div className='exhibition-inventory-item-cell'>{item.imagePath ? <InventoryImage path={item.imagePath} /> : <span className='exhibition-inventory-item-image exhibition-inventory-item-image--empty'>◇</span>}<span className='exhibition-inventory-item-copy'><strong className='exhibition-inventory-item-number'>{item.itemNumber}</strong>{item.name && <span className='exhibition-inventory-item-name'>{item.name}</span>}{Boolean(item.isArchived) && <span className='exhibition-inventory-archived'>Archived</span>}</span></div></td><td>{item.categoryName}</td><td><span className='exhibition-inventory-details'>{formatWeight(item.grossWeightMilli)}{item.netWeightMilli != null ? `\nNet ${formatWeight(item.netWeightMilli)}` : ''}</span></td><td><span className='exhibition-inventory-details'>{item.diamondDetails ?? '—'}</span></td><td><span className='exhibition-inventory-details'>{item.stoneDetails ?? '—'}</span></td><td>{item.igiCertificateNumber ? <span className='exhibition-inventory-cert-ok'>IGI · {item.igiCertificateNumber}</span> : <span className='exhibition-inventory-cert-missing'>{item.huid ? `HUID · ${item.huid}` : '—'}</span>}</td><td><span className='exhibition-inventory-selection-label'>{item.selectionCount ? `${item.selectionCount} active` : 'None'}</span></td><td>{item.isRegistered ? <button type='button' className='exhibition-inventory-remove' disabled={exhibitionEnded || busy || item.selectionCount > 0} title={item.selectionCount ? 'Remove active customer selections first' : 'Remove registration'} onClick={() => void handleUnregister(item)}>Remove</button> : <span className='exhibition-inventory-cert-missing'>Not registered</span>}</td></tr>)}</tbody></table></div>}
      <footer className='exhibition-inventory-table-footer'>{items.filter((i) => i.isRegistered).length} registered · {items.length} matching inventory items</footer>
    </div>
    {modalOpen && <div className='exhibition-register-backdrop' role='presentation' onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}><section className='exhibition-register-modal' role='dialog' aria-modal='true' aria-labelledby='register-modal-title'><header className='exhibition-register-header'><div><h2 id='register-modal-title'>Register inventory</h2><p>Select existing inventory items to make them available at this exhibition.</p></div><button type='button' aria-label='Close' onClick={() => setModalOpen(false)}>×</button></header><form className='exhibition-register-scan' onSubmit={async (e) => { e.preventDefault(); const value = scanValue.trim(); if (!value) return; setBusy(true); try { const result = await registerExhibitionItemByBarcode(exhibitionId, value); setNotice(result === 'registered' ? { kind: 'success', text: `${value} registered.` } : result === 'already-registered' ? { kind: 'warning', text: `${value} is already registered.` } : { kind: 'error', text: `No inventory item found for ${value}.` }); setScanValue(''); await loadItems(); } catch (error) { setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Scan failed.' }); } finally { setBusy(false); } }}><strong><span /> Scan barcode</strong><input value={scanValue} onChange={(e) => setScanValue(e.target.value)} placeholder='Scan or enter item number' /><button type='submit' disabled={busy || !scanValue.trim()}>Scan</button></form><div className='exhibition-register-search-row'><label className='exhibition-inventory-search'><span aria-hidden='true'>⌕</span><input value={modalSearch} onChange={(e) => setModalSearch(e.target.value)} placeholder='Search available inventory' /></label><select value={modalCategory ?? ''} onChange={(e) => setModalCategory(e.target.value ? Number(e.target.value) : null)}><option value=''>All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div><div className='exhibition-register-table-wrap'><table className='exhibition-register-table'><thead><tr><th></th><th>Item</th><th>Category</th><th>Weight</th></tr></thead><tbody>{modalItems.map((item) => <tr key={item.id}><td><input type='checkbox' checked={selectedIds.includes(item.id)} onChange={(e) => setSelectedIds((ids) => e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} /></td><td><strong>{item.itemNumber}</strong>{item.name && <div>{item.name}</div>}</td><td>{item.categoryName}</td><td>{formatWeight(item.grossWeightMilli)}</td></tr>)}{!modalItems.length && <tr><td colSpan={4} className='exhibition-register-no-results'>No unregistered inventory items found.</td></tr>}</tbody></table></div><footer className='exhibition-register-footer'><span>{selectedIds.length} selected</span><div><button type='button' className='exhibition-overview-secondary' onClick={() => setModalOpen(false)}>Cancel</button><button type='button' className='exhibition-overview-primary' disabled={!selectedIds.length || busy} onClick={() => void handleRegisterSelected()}>{busy ? 'Registering…' : `Register ${selectedIds.length || ''} item${selectedIds.length === 1 ? '' : 's'}`}</button></div></footer></section></div>}
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
