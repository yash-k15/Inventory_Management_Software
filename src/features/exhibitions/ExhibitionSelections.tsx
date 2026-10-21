import { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  addSelectionItem,
  getSelectionCustomers,
  getSelectionItems,
  removeSelectionItem,
  searchSelectionInventory,
  type SelectionCandidate,
  type SelectionCustomer,
  type SelectionRow,
} from './selection.queries';
import './ExhibitionSelections.css';
function weight(n: number | null) {
  return n == null ? '—' : `${(n / 1000).toFixed(3)} g`;
}
function Thumbnail({ path, alt }: { path: string | null; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    if (!path) {
      setSrc(null);
      return;
    }
    void (async () => {
      try {
        const p = await join(await appDataDir(), path);
        await invoke('allow_image_preview', { path: p });
        if (!dead) setSrc(convertFileSrc(p));
      } catch (e) {
        console.error('Selection thumbnail failed', e);
      }
    })();
    return () => {
      dead = true;
    };
  }, [path]);
  return src ? (
    <img className='selection-thumbnail' src={src} alt={alt} />
  ) : (
    <span
      className='selection-thumbnail selection-thumbnail--empty'
      aria-hidden='true'
    >
      ◇
    </span>
  );
}
export default function ExhibitionSelections({
  exhibitionId,
  onRefreshExhibition,
  initialCustomerId = null,
}: {
  exhibitionId: number;
  onRefreshExhibition: () => Promise<void>;
  initialCustomerId?: number | null;
}) {
  const [customers, setCustomers] = useState<SelectionCustomer[]>([]),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [items, setItems] = useState<SelectionRow[]>([]),
    [results, setResults] = useState<SelectionCandidate[]>([]);
  const [customerSearch, setCustomerSearch] = useState(''),
    [search, setSearch] = useState(''),
    [barcode, setBarcode] = useState(''),
    [scanning, setScanning] = useState(false),
    [staged, setStaged] = useState<SelectionCandidate[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(
      null,
    );
  const scanRef = useRef<HTMLInputElement>(null),
    customer = customers.find((c) => c.id === selectedId) ?? null,
    active = useMemo(() => items.filter((i) => i.status === 'active'), [items]),
    removed = useMemo(
      () => items.filter((i) => i.status === 'removed'),
      [items],
    );
  async function reload() {
    const rows = await getSelectionCustomers(exhibitionId, customerSearch);
    setCustomers(rows);
    const selected = rows.find((c) => c.id === selectedId);
    setItems(
      selected?.selectionId
        ? await getSelectionItems(selected.selectionId)
        : [],
    );
    await onRefreshExhibition();
  }
  useEffect(() => {
    let dead = false;
    setLoading(true);
    void getSelectionCustomers(exhibitionId, customerSearch)
      .then((rows) => {
        if (!dead) {
          setCustomers(rows);
          if (
            initialCustomerId !== null &&
            initialCustomerId !== undefined &&
            rows.some((c) => c.id === initialCustomerId)
          )
            setSelectedId(initialCustomerId);
          else if (
            selectedId !== null &&
            !rows.some((c) => c.id === selectedId)
          )
            setSelectedId(null);
        }
      })
      .catch((e) => {
        if (!dead)
          setFeedback({
            error: true,
            text: e instanceof Error ? e.message : 'Unable to load customers.',
          });
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [exhibitionId, customerSearch, initialCustomerId]);
  useEffect(() => {
    setStaged([]);
    setFeedback(null);
    const c = customers.find((row) => row.id === selectedId);
    void (
      c?.selectionId ? getSelectionItems(c.selectionId) : Promise.resolve([])
    )
      .then(setItems)
      .catch((e) =>
        setFeedback({
          error: true,
          text: e instanceof Error ? e.message : 'Unable to load selection.',
        }),
      );
  }, [selectedId, customers]);
  useEffect(() => {
    let dead = false;
    void searchSelectionInventory(exhibitionId, search)
      .then((rows) => {
        if (!dead) setResults(rows);
      })
      .catch((e) => {
        if (!dead)
          setFeedback({
            error: true,
            text:
              e instanceof Error ? e.message : 'Unable to search inventory.',
          });
      });
    return () => {
      dead = true;
    };
  }, [exhibitionId, search]);
  useEffect(() => {
    if (scanning) scanRef.current?.focus();
  }, [scanning]);
  async function add(candidate: SelectionCandidate, stage = scanning) {
    if (!customer) {
      setFeedback({ error: false, text: 'Select a customer first.' });
      return;
    }
    if (
      active.some((i) => i.inventoryItemId === candidate.id) ||
      staged.some((i) => i.id === candidate.id)
    )
      return;
    if (stage) {
      setStaged((s) => [...s, candidate]);
      return;
    }
    setSaving(true);
    try {
      const added = await addSelectionItem(
        exhibitionId,
        customer.id,
        candidate.id,
      );
      if (added) {
        setFeedback({
          error: false,
          text: `${candidate.itemNumber} added to selection.`,
        });
        await reload();
      }
    } catch (e) {
      setFeedback({
        error: true,
        text: e instanceof Error ? e.message : 'Unable to add item.',
      });
    } finally {
      setSaving(false);
    }
  }
  async function scan() {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    const found =
      results.find((i) => i.itemNumber.toLowerCase() === code.toLowerCase()) ??
      (await searchSelectionInventory(exhibitionId, code)).find(
        (i) => i.itemNumber.toLowerCase() === code.toLowerCase(),
      );
    if (!found) {
      setFeedback({
        error: true,
        text: `Barcode ${code} was not found in this exhibition's registered inventory. No item was created.`,
      });
      return;
    }
    if (
      active.some((i) => i.inventoryItemId === found.id) ||
      staged.some((i) => i.id === found.id)
    )
      return;
    setStaged((s) => [...s, found]);
    setFeedback({ error: false, text: `${found.itemNumber} ready to add.` });
  }
  async function saveBatch() {
    if (!customer || !staged.length) return;

    setSaving(true);
    let count = 0;
    const operationId = crypto.randomUUID();

    try {
      for (const candidate of staged) {
        if (
          await addSelectionItem(
            exhibitionId,
            customer.id,
            candidate.id,
            operationId,
          )
        ) {
          count++;
        }
      }

      setStaged([]);
      setScanning(false);
      setFeedback({
        error: false,
        text: `${count} item${count === 1 ? '' : 's'} added to selection.`,
      });
      await reload();
    } catch (e) {
      setFeedback({
        error: true,
        text: e instanceof Error ? e.message : 'Unable to save scanned items.',
      });
    } finally {
      setSaving(false);
    }
  }
  async function remove(item: SelectionRow) {
    if (
      !window.confirm(
        `Remove ${item.itemNumber} from this customer's selection? The removal remains in history.`,
      )
    )
      return;
    try {
      await removeSelectionItem(item.id);
      setFeedback({
        error: false,
        text: `${item.itemNumber} removed from selection.`,
      });
      await reload();
    } catch (e) {
      setFeedback({
        error: true,
        text: e instanceof Error ? e.message : 'Unable to remove item.',
      });
    }
  }
  return (
    <section className='exhibition-selections'>
      <aside className='selection-customer-panel'>
        <header className='selection-panel-heading'>
          <h2>Customers</h2>
          <span>{customers.length} customers</span>
        </header>
        <label className='selection-search selection-customer-search'>
          <span>⌕</span>
          <input
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            placeholder='Search customers…'
          />
          <span className='sr-only'>Search customers</span>
        </label>
        {loading ? (
          <p className='selection-muted'>Loading customers…</p>
        ) : customers.length === 0 ? (
          <p className='selection-muted'>No customers found.</p>
        ) : (
          <div className='selection-customer-list'>
            {customers.map((c) => (
              <button
                key={c.id}
                type='button'
                className={`selection-customer ${selectedId === c.id ? 'is-selected' : ''}`}
                onClick={() => setSelectedId(c.id)}
              >
                <span className='selection-customer-avatar'>
                  {c.businessName.slice(0, 1).toUpperCase()}
                </span>
                <span className='selection-customer-copy'>
                  <strong>{c.businessName}</strong>
                  <small>
                    {c.contactName || c.phone || 'No contact details'}
                  </small>
                </span>
                <span className='selection-customer-count'>
                  {c.activeItemCount}
                </span>
              </button>
            ))}
          </div>
        )}
      </aside>
      <div className='selection-main-panel'>
        {!customer ? (
          <div className='selection-empty-state'>
            <span>♧</span>
            <h2>Select a customer</h2>
            <p>
              Choose a customer to view or update their selection for this
              exhibition.
            </p>
          </div>
        ) : (
          <>
            <header className='selection-detail-header'>
              <div>
                <span className='selection-eyebrow'>CUSTOMER SELECTION</span>
                <h2>{customer.businessName}</h2>
                <p>
                  {customer.contactName || 'Contact not specified'}
                  {customer.phone ? ` · ${customer.phone}` : ''}
                </p>
              </div>
              <span className='selection-item-count'>
                {active.length} selected
              </span>
            </header>
            {feedback && (
              <div
                className={`selection-feedback ${feedback.error ? 'selection-feedback--error' : 'selection-feedback--success'}`}
                role={feedback.error ? 'alert' : 'status'}
              >
                <span>{feedback.text}</span>
                <button
                  type='button'
                  onClick={() => setFeedback(null)}
                  aria-label='Dismiss'
                >
                  ×
                </button>
              </div>
            )}
            <section className='selection-scan-card'>
              <div className='selection-scan-heading'>
                <div>
                  <h3>Quick add</h3>
                  <p>
                    Scan a barcode or search registered exhibition inventory.
                  </p>
                </div>
                <button
                  type='button'
                  className={`selection-button ${scanning ? 'selection-button--muted' : 'selection-button--primary'}`}
                  onClick={() => {
                    setScanning((v) => !v);
                    setStaged([]);
                    setFeedback(null);
                  }}
                >
                  {scanning ? 'Stop scanning' : 'Start scanning'}
                </button>
              </div>
              {scanning && (
                <div className='selection-barcode-row'>
                  <input
                    ref={scanRef}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void scan();
                      }
                    }}
                    placeholder='Scan barcode…'
                    aria-label='Scan barcode'
                  />
                  <button
                    type='button'
                    className='selection-button'
                    onClick={() => void scan()}
                  >
                    Add scan
                  </button>
                </div>
              )}
              <label className='selection-search selection-inventory-search'>
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder='Search item number, name, category…'
                />
                <span className='sr-only'>Search inventory</span>
              </label>
              {search.trim() && (
                <div className='selection-search-results'>
                  {results.length === 0 ? (
                    <p className='selection-muted'>
                      No registered items match this search.
                    </p>
                  ) : (
                    results.slice(0, 8).map((i) => (
                      <div className='selection-candidate' key={i.id}>
                        <Thumbnail path={i.imagePath} alt={i.itemNumber} />
                        <div className='selection-candidate-copy'>
                          <strong>{i.itemNumber}</strong>
                          <span>
                            {i.categoryName}
                            {i.name ? ` · ${i.name}` : ''}
                          </span>
                          <small>
                            {weight(i.grossWeightMilli)}
                            {i.purityName ? ` · ${i.purityName}` : ''}
                          </small>
                        </div>
                        <button
                          type='button'
                          className='selection-button'
                          disabled={
                            saving ||
                            active.some((a) => a.inventoryItemId === i.id) ||
                            staged.some((a) => a.id === i.id)
                          }
                          onClick={() => void add(i)}
                        >
                          {active.some((a) => a.inventoryItemId === i.id)
                            ? 'Added'
                            : staged.some((a) => a.id === i.id)
                              ? 'Staged'
                              : 'Add'}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
              {scanning && staged.length > 0 && (
                <div className='selection-staged'>
                  <div className='selection-staged-header'>
                    <strong>{staged.length} scanned</strong>
                    <button
                      type='button'
                      className='selection-text-button'
                      onClick={() => setStaged([])}
                    >
                      Clear
                    </button>
                  </div>
                  {staged.map((i) => (
                    <div className='selection-staged-row' key={i.id}>
                      <span>{i.itemNumber}</span>
                      <span>{i.categoryName}</span>
                      <button
                        type='button'
                        onClick={() =>
                          setStaged((s) => s.filter((x) => x.id !== i.id))
                        }
                        aria-label={`Remove ${i.itemNumber} from batch`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type='button'
                    className='selection-button selection-button--primary'
                    disabled={saving}
                    onClick={() => void saveBatch()}
                  >
                    {saving
                      ? 'Saving…'
                      : `Add ${staged.length} scanned item${staged.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              )}
            </section>
            <section className='selection-items-section'>
              <div className='selection-items-heading'>
                <h3>Selected items</h3>
                <span>{active.length} active</span>
              </div>
              {active.length === 0 ? (
                <div className='selection-no-items'>
                  <p>No items selected yet.</p>
                  <span>
                    Search inventory above or start scanning to add jewelry.
                  </span>
                </div>
              ) : (
                <div className='selection-item-list'>
                  {active.map((i) => (
                    <article className='selection-item-card' key={i.id}>
                      <Thumbnail path={i.imagePath} alt={i.itemNumber} />
                      <div className='selection-item-copy'>
                        <strong>{i.itemNumber}</strong>
                        <span>
                          {i.categoryName}
                          {i.name ? ` · ${i.name}` : ''}
                        </span>
                        <small>
                          {weight(i.grossWeightMilli)}
                          {i.purityName ? ` · ${i.purityName}` : ''} · Added{' '}
                          {new Date(
                            i.addedAt.replace(' ', 'T'),
                          ).toLocaleDateString('en-IN')}
                        </small>
                      </div>
                      {i.locked ? (
                        <span className='selection-locked-badge'>
                          Ordered · locked
                        </span>
                      ) : (
                        <button
                          type='button'
                          className='selection-remove-button'
                          onClick={() => void remove(i)}
                        >
                          Remove
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {removed.length > 0 && (
                <details className='selection-history'>
                  <summary>Removed items ({removed.length})</summary>
                  {removed.map((i) => (
                    <div className='selection-history-row' key={i.id}>
                      <strong>{i.itemNumber}</strong>
                      <span>Removed from selection</span>
                    </div>
                  ))}
                </details>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
