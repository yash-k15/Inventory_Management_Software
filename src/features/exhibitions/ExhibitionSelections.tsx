import { useEffect, useMemo, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  addSelectionItem,
  getSelectionCustomers,
  getSelectionItems,
  getSelectionOrders,
  getSelectionOrderDetail,
  type SelectionOrderDetail,
  type SelectionOrderSummary,
  removeSelectionItem,
  searchSelectionInventory,
  type SelectionCandidate,
  type SelectionCustomer,
  type SelectionRow,
} from './selection.queries';
import CustomerPickerModal from './CustomerPickerModal';
import CreateOrderModal from '../orders/CreateOrderModal';
import './ExhibitionSelections.css';
function weight(n: number | null) {
  return n == null ? '—' : `${(n / 1000).toFixed(3)}`;
}

function detailLines(details: SelectionRow['diamonds']) {
  return details.map(
    (detail) =>
      `${detail.label}: ${weight(detail.weight_milli)}${detail.pieces == null ? '' : ` (${detail.pieces} pcs)`}`,
  );
}

function detailTotals(items: SelectionRow[], key: 'diamonds' | 'stones') {
  const total = items
    .flatMap((item) => item[key])
    .reduce(
      (sum, detail) => ({
        weight: sum.weight + (detail.weight_milli ?? 0),
        pieces: sum.pieces + (detail.pieces ?? 0),
        hasPieces: sum.hasPieces || detail.pieces != null,
      }),
      { weight: 0, pieces: 0, hasPieces: false },
    );
  return total.weight || total.pieces
    ? `${weight(total.weight)}${total.hasPieces ? ` (${total.pieces} pcs)` : ''}`
    : '—';
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
  return (
    <span className='selection-thumbnail-preview'>
      {src ? (
        <img className='selection-thumbnail' src={src} alt={alt} />
      ) : (
        <span className='selection-thumbnail selection-thumbnail--empty' aria-hidden='true'>◇</span>
      )}
      {src && <span className='selection-thumbnail-preview-popover' aria-hidden='true'><img src={src} alt='' /></span>}
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
  const [activeTab, setActiveTab] = useState<'items' | 'orders'>('items');
  const [selectedForOrder, setSelectedForOrder] = useState<number[]>([]);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [orders, setOrders] = useState<SelectionOrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [orderDetails, setOrderDetails] = useState<
    Record<number, SelectionOrderDetail>
  >({});
  const [orderDetailLoading, setOrderDetailLoading] = useState<number | null>(
    null,
  );
  const [selectionPage, setSelectionPage] = useState(1);
  const [ordersPage, setOrdersPage] = useState(1);
  const [orderDetailPages, setOrderDetailPages] = useState<Record<number, number>>({});
  const [pageSize, setPageSize] = useState(25);
  const [customers, setCustomers] = useState<SelectionCustomer[]>([]),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [items, setItems] = useState<SelectionRow[]>([]),
    [results, setResults] = useState<SelectionCandidate[]>([]);
  const [customerSearch, setCustomerSearch] = useState(''),
    [addCustomerOpen, setAddCustomerOpen] = useState(false),
    [search, setSearch] = useState(''),
    [barcode, setBarcode] = useState(''),
    [scanning, setScanning] = useState(false),
    [staged, setStaged] = useState<SelectionCandidate[]>([]),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(
      null,
    );
  const [sort, setSort] = useState<{
    key: 'item' | 'gross' | 'net' | 'diamonds' | 'stones' | 'added';
    direction: 'asc' | 'desc';
  }>({ key: 'added', direction: 'desc' });
  const scanRef = useRef<HTMLInputElement>(null),
    customer = customers.find((c) => c.id === selectedId) ?? null,
    active = useMemo(() => items.filter((i) => i.status === 'active'), [items]),
    removed = useMemo(
      () => items.filter((i) => i.status === 'removed'),
      [items],
    ),
    sortedActive = useMemo(
      () =>
        [...active].sort((a, b) => {
          const dir = sort.direction === 'asc' ? 1 : -1;
          const val = (item: SelectionRow) => {
            switch (sort.key) {
              case 'item':
                return `${item.itemNumber} ${item.categoryName} ${item.name ?? ''}`.toLowerCase();
              case 'gross':
                return item.grossWeightMilli ?? -1;
              case 'net':
                return item.netWeightMilli ?? -1;
              case 'diamonds':
                return item.diamonds.reduce(
                  (n, d) => n + (d.weight_milli ?? 0),
                  0,
                );
              case 'stones':
                return item.stones.reduce(
                  (n, d) => n + (d.weight_milli ?? 0),
                  0,
                );
              case 'added':
                return item.addedAt;
            }
          };
          const av = val(a),
            bv = val(b);
          return (
            (typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv), 'en', { numeric: true })) *
            dir
          );
        }),
      [active, sort],
    ),
    totals = useMemo(
      () =>
        active.reduce(
          (sum, item) => ({
            gross: sum.gross + (item.grossWeightMilli ?? 0),
            net: sum.net + (item.netWeightMilli ?? 0),
          }),
          { gross: 0, net: 0 },
        ),
      [active],
    );
  const selectionPageCount = Math.max(1, Math.ceil(sortedActive.length / pageSize));
  const visibleSelectionItems = sortedActive.slice((selectionPage - 1) * pageSize, selectionPage * pageSize);
  const ordersPageCount = Math.max(1, Math.ceil(orders.length / pageSize));
  const visibleOrders = orders.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
  function renderPagination(page: number, pageCount: number, setPage: (page: number) => void, total: number) {
    const start = total ? (page - 1) * pageSize + 1 : 0;
    const end = Math.min(page * pageSize, total);
    return <div className='selection-pagination'>
      <span>Showing {start}–{end} of {total}</span>
      <label>Rows <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
        {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <div className='selection-pagination-buttons'>
        <button type='button' disabled={page <= 1} onClick={() => setPage(1)} aria-label='First page'>«</button>
        <button type='button' disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label='Previous page'>‹</button>
        <span>Page {page} of {pageCount}</span>
        <button type='button' disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label='Next page'>›</button>
        <button type='button' disabled={page >= pageCount} onClick={() => setPage(pageCount)} aria-label='Last page'>»</button>
      </div>
    </div>;
  }
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
    const c = customers.find((row) => row.id === selectedId);
    if (!c) {
      setOrders([]);
      return () => {
        dead = true;
      };
    }
    setOrdersLoading(true);
    void getSelectionOrders(exhibitionId, c.id)
      .then((rows) => {
        if (!dead) setOrders(rows);
      })
      .catch((e) => {
        if (!dead)
          setFeedback({
            error: true,
            text: e instanceof Error ? e.message : 'Unable to load orders.',
          });
      })
      .finally(() => {
        if (!dead) setOrdersLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [exhibitionId, selectedId, customers, items]);

  useEffect(() => {
    setSelectedForOrder([]);
    setActiveTab('items');
    setSelectionPage(1);
    setOrdersPage(1);
    setOrderDetailPages({});
  }, [selectedId, exhibitionId]);

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
  async function handleCustomerAdded(c: {
    id: number;
    businessName: string;
    contactName: string | null;
    phone: string | null;
  }) {
    setAddCustomerOpen(false);
    setCustomerSearch('');
    setSelectedId(c.id);
    setCustomers(await getSelectionCustomers(exhibitionId, ''));
    setFeedback({
      error: false,
      text: `${c.businessName} added to this exhibition.`,
    });
    await onRefreshExhibition();
  }

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
  const formatMoney = (paise: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(paise / 100);
  const formatReviewWeight = (milli: number | null) =>
    milli == null ? '—' : `${(milli / 1000).toFixed(3)} g`;
  const formatOrderDetails = (details: SelectionRow['diamonds']) =>
    details.length
      ? details
          .map(
            (d) =>
              `${d.label}: ${((d.weight_milli ?? 0) / 1000).toFixed(3)} ct${d.pieces == null ? '' : ` (${d.pieces} pcs)`}`,
          )
          .join('\n')
      : '—';
  const formatOrderDetailTotals = (details: SelectionRow['diamonds']) => {
    const weightMilli = details.reduce(
      (sum, detail) => sum + (detail.weight_milli ?? 0),
      0,
    );
    const pieces = details.reduce(
      (sum, detail) => sum + (detail.pieces ?? 0),
      0,
    );
    const hasPieces = details.some((detail) => detail.pieces != null);
    return weightMilli || pieces
      ? `${(weightMilli / 1000).toFixed(3)} ct${hasPieces ? ` (${pieces} pcs)` : ''}`
      : '—';
  };
  async function toggleOrder(orderId: number) {
    if (expandedOrderId === orderId) {
      setExpandedOrderId(null);
      return;
    }
    setExpandedOrderId(orderId);
    if (orderDetails[orderId]) return;
    setOrderDetailLoading(orderId);
    try {
      const detail = await getSelectionOrderDetail(orderId);
      if (detail)
        setOrderDetails((current) => ({ ...current, [orderId]: detail }));
    } catch (e) {
      setFeedback({
        error: true,
        text: e instanceof Error ? e.message : 'Unable to load order details.',
      });
    } finally {
      setOrderDetailLoading(null);
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
        <footer className='selection-customer-footer'>
          <button
            type='button'
            className='selection-button selection-button--primary selection-add-customer'
            onClick={() => setAddCustomerOpen(true)}
          >
            + Add Customer
          </button>
        </footer>
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
            <section className='selection-scan-card selection-section-card'>
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
            <section className='selection-items-section selection-section-card'>
              <div className='selection-items-heading'>
                <div
                  className='selection-tabs'
                  role='tablist'
                  aria-label='Customer exhibition records'
                >
                  <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'items'}
                    className={activeTab === 'items' ? 'is-active' : ''}
                    onClick={() => setActiveTab('items')}
                  >
                    Selected items <span>{active.length}</span>
                  </button>
                  <button
                    type='button'
                    role='tab'
                    aria-selected={activeTab === 'orders'}
                    className={activeTab === 'orders' ? 'is-active' : ''}
                    onClick={() => setActiveTab('orders')}
                  >
                    Orders <span>{orders.length}</span>
                  </button>
                </div>
                {activeTab === 'items' && (
                  <div className='selection-order-actions'>
                    <span>{selectedForOrder.length} selected for order</span>
                    <button
                      type='button'
                      className='selection-button selection-button--primary'
                      disabled={
                        !selectedForOrder.length ||
                        selectedForOrder.some(
                          (id) =>
                            active.find((item) => item.id === id)?.locked === 1,
                        )
                      }
                      onClick={() => setCreateOrderOpen(true)}
                    >
                      Create order
                    </button>
                  </div>
                )}
              </div>
              {activeTab === 'orders' ? (
                ordersLoading ? (
                  <p className='selection-muted'>Loading orders…</p>
                ) : orders.length === 0 ? (
                  <div className='selection-no-items'>
                    <p>No orders for this customer in this exhibition.</p>
                    <span>
                      Orders created from this selection will appear here.
                    </span>
                  </div>
                ) : (
                  <div className='selection-orders-list'>
                    {visibleOrders.map((order) => {
                      const expanded = expandedOrderId === order.id;
                      const detail = orderDetails[order.id];
                      return (
                        <article
                          className={`selection-order-entry ${expanded ? 'is-expanded' : ''}`}
                          key={order.id}
                        >
                          <button
                            type='button'
                            className='selection-order-card'
                            aria-expanded={expanded}
                            onClick={() => void toggleOrder(order.id)}
                          >
                            <span className='selection-order-number'>
                              <strong>{order.orderNumber}</strong>
                              <small>
                                {order.itemCount} item
                                {order.itemCount === 1 ? '' : 's'}
                              </small>
                            </span>
                            <span className='selection-order-date'>
                              {new Date(
                                order.createdAt.replace(' ', 'T'),
                              ).toLocaleDateString('en-IN')}
                            </span>
                            <strong className='selection-order-value'>
                              {formatMoney(order.totalPaise)}
                            </strong>
                            <span
                              className='selection-order-chevron'
                              aria-hidden='true'
                            >
                              {expanded ? '⌃' : '⌄'}
                            </span>
                          </button>
                          {expanded && (
                            <div className='selection-order-expanded'>
                              {orderDetailLoading === order.id ? (
                                <p className='selection-muted'>
                                  Loading order details…
                                </p>
                              ) : detail ? (
                                <>
                                  <div className='selection-order-review-table'>
                                    <div className='selection-order-review-heading'>
                                      <span>S.No.</span>
                                      <span>Item</span>
                                      <span>Gross wt.</span>
                                      <span>Net wt.</span>
                                      <span>Diamonds</span>
                                      <span>Stones</span>
                                      <span>Final price</span>
                                    </div>
                                    {detail.items.slice(((orderDetailPages[order.id] ?? 1) - 1) * pageSize, (orderDetailPages[order.id] ?? 1) * pageSize).map((item, index) => (
                                      <div
                                        className='selection-order-review-row'
                                        key={`${order.id}-${((orderDetailPages[order.id] ?? 1) - 1) * pageSize + index}`}
                                      >
                                        <span>{((orderDetailPages[order.id] ?? 1) - 1) * pageSize + index + 1}</span>
                                        <div className='selection-order-review-item'>
                                          <Thumbnail
                                            path={item.imagePath}
                                            alt={item.itemNumber}
                                          />
                                          <span>
                                            <strong>{item.itemNumber}</strong>
                                            <small>{item.categoryName}</small>
                                          </span>
                                        </div>
                                        <span>
                                          {formatReviewWeight(
                                            item.grossWeightMilli,
                                          )}
                                        </span>
                                        <span>
                                          {formatReviewWeight(
                                            item.netWeightMilli,
                                          )}
                                        </span>
                                        <span className='selection-order-review-detail'>
                                          {formatOrderDetails(item.diamonds)}
                                        </span>
                                        <span className='selection-order-review-detail'>
                                          {formatOrderDetails(item.stones)}
                                        </span>
                                        <strong>
                                          {formatMoney(item.pricePaise)}
                                        </strong>
                                      </div>
                                    ))}
                                    <div className='selection-order-review-row selection-order-review-total-row'>
                                      <span />
                                      <strong>Totals</strong>
                                      <strong>
                                        {formatReviewWeight(
                                          detail.items.some(
                                            (i) => i.grossWeightMilli != null,
                                          )
                                            ? detail.items.reduce(
                                                (sum, i) =>
                                                  sum +
                                                  (i.grossWeightMilli ?? 0),
                                                0,
                                              )
                                            : null,
                                        )}
                                      </strong>
                                      <strong>
                                        {formatReviewWeight(
                                          detail.items.some(
                                            (i) => i.netWeightMilli != null,
                                          )
                                            ? detail.items.reduce(
                                                (sum, i) =>
                                                  sum + (i.netWeightMilli ?? 0),
                                                0,
                                              )
                                            : null,
                                        )}
                                      </strong>
                                      <strong>
                                        {formatOrderDetailTotals(
                                          detail.items.flatMap(
                                            (i) => i.diamonds,
                                          ),
                                        )}
                                      </strong>
                                      <strong>
                                        {formatOrderDetailTotals(
                                          detail.items.flatMap((i) => i.stones),
                                        )}
                                      </strong>
                                      <strong>
                                        {formatMoney(
                                          detail.calculatedTotalPaise,
                                        )}
                                      </strong>
                                    </div>
                                  </div>
                                  {detail.items.length > 0 && renderPagination(
                                    orderDetailPages[order.id] ?? 1,
                                    Math.max(1, Math.ceil(detail.items.length / pageSize)),
                                    (page) => setOrderDetailPages((current) => ({ ...current, [order.id]: page })),
                                    detail.items.length,
                                  )}
                                  <div className='selection-order-final-total'>
                                    <span>Final order total</span>
                                    <strong>
                                      {formatMoney(detail.totalPaise)}
                                    </strong>
                                  </div>
                                  <div className='selection-order-notes'>
                                    <strong>Notes</strong>
                                    <p>
                                      {detail.notes?.trim() ||
                                        'No notes added for this order.'}
                                    </p>
                                  </div>
                                </>
                              ) : (
                                <p className='selection-muted'>
                                  Unable to load order details.
                                </p>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )
              ) : active.length === 0 ? (
                <div className='selection-no-items'>
                  <p>No items selected yet.</p>
                  <span>
                    Search inventory above or start scanning to add jewelry.
                  </span>
                </div>
              ) : (
                <div className='selection-table-wrap'>
                  <table className='selection-items-table'>
                    <thead>
                      <tr>
                        <th>S.No.</th>
                        <th aria-label='Select for order' />
                        {(
                          [
                            ['item', 'Item'],
                            ['gross', 'Gross wt'],
                            ['net', 'Net wt'],
                            ['diamonds', 'Diamond details'],
                            ['stones', 'Stone details'],
                          ] as const
                        ).map(([key, label]) => (
                          <th
                            key={key}
                            aria-sort={
                              sort.key === key
                                ? sort.direction === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                          >
                            <button
                              type='button'
                              className='selection-sort-button'
                              onClick={() => {
                                setSelectionPage(1);
                                setSort((current) => ({
                                  key,
                                  direction:
                                    current.key === key &&
                                    current.direction === 'asc'
                                      ? 'desc'
                                      : 'asc',
                                }));
                              }}
                            >
                              {label}
                              {sort.key === key
                                ? sort.direction === 'asc'
                                  ? ' ↑'
                                  : ' ↓'
                                : ' ↕'}
                            </button>
                          </th>
                        ))}
                        <th>Order status</th>
                        <th aria-label='Actions' />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSelectionItems.map((i, index) => (
                        <tr key={i.id}>
                          <td className='selection-serial-cell'>{(selectionPage - 1) * pageSize + index + 1}</td>
                          <td className='selection-order-checkbox-cell'>
                            <input
                              type='checkbox'
                              aria-label={`Include ${i.itemNumber} in order`}
                              checked={selectedForOrder.includes(i.id)}
                              disabled={
                                i.locked === 1 || i.inventoryItemId == null
                              }
                              onChange={(event) =>
                                setSelectedForOrder((current) =>
                                  event.target.checked
                                    ? [...current, i.id]
                                    : current.filter((id) => id !== i.id),
                                )
                              }
                            />
                          </td>
                          <td>
                            <div className='selection-table-item'>
                              <Thumbnail
                                path={i.imagePath}
                                alt={i.itemNumber}
                              />
                              <div className='selection-item-copy'>
                                <strong>{i.itemNumber}</strong>
                                <span>
                                  {i.categoryName}
                                  {i.name ? ` · ${i.name}` : ''}
                                </span>
                                <small>
                                  Added{' '}
                                  {new Date(
                                    i.addedAt.replace(' ', 'T'),
                                  ).toLocaleDateString('en-IN')}
                                </small>
                              </div>
                            </div>
                          </td>
                          <td className='selection-weight-cell'>
                            {i.grossWeightMilli == null
                              ? '—'
                              : `${weight(i.grossWeightMilli)} g`}
                          </td>
                          <td className='selection-weight-cell'>
                            {i.netWeightMilli == null
                              ? '—'
                              : `${weight(i.netWeightMilli)} g`}
                          </td>
                          <td className='selection-details-cell'>
                            {detailLines(i.diamonds).length
                              ? detailLines(i.diamonds).map((line, index) => (
                                  <div key={`${i.id}-diamond-${index}`}>
                                    {line}
                                  </div>
                                ))
                              : '—'}
                          </td>
                          <td className='selection-details-cell'>
                            {detailLines(i.stones).length
                              ? detailLines(i.stones).map((line, index) => (
                                  <div key={`${i.id}-stone-${index}`}>
                                    {line}
                                  </div>
                                ))
                              : '—'}
                          </td>
                          <td className='selection-order-status-cell'>
                            {i.locked ? (
                              <span className='selection-locked-badge'>
                                Ordered
                              </span>
                            ) : (
                              <span className='selection-not-ordered-badge'>
                                Not ordered
                              </span>
                            )}
                          </td>
                          <td className='selection-action-cell'>
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
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={3}>Totals ({active.length} items)</th>
                        <th>{weight(totals.gross)} g</th>
                        <th>{totals.net ? `${weight(totals.net)} g` : '—'}</th>
                        <th>{detailTotals(active, 'diamonds')}</th>
                        <th>{detailTotals(active, 'stones')}</th>
                        <th />
                        <th />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {activeTab === 'orders' && !ordersLoading && orders.length > 0 &&
                renderPagination(ordersPage, ordersPageCount, setOrdersPage, orders.length)}
              {activeTab === 'items' && active.length > 0 &&
                renderPagination(selectionPage, selectionPageCount, setSelectionPage, sortedActive.length)}
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
      {createOrderOpen && customer && (
        <CreateOrderModal
          initialCustomerId={customer.id}
          initialExhibitionId={exhibitionId}
          initialItems={active
            .filter(
              (item) =>
                selectedForOrder.includes(item.id) &&
                item.inventoryItemId != null,
            )
            .map((item) => ({
              inventoryItemId: item.inventoryItemId as number,
              selectionItemId: item.id,
              itemNumber: item.itemNumber,
            }))}
          onClose={() => setCreateOrderOpen(false)}
          onCreated={async () => {
            setCreateOrderOpen(false);
            setSelectedForOrder([]);
            setActiveTab('orders');
            await reload();
            setOrders(await getSelectionOrders(exhibitionId, customer.id));
            setFeedback({ error: false, text: 'Order created successfully.' });
          }}
        />
      )}
      {addCustomerOpen && (
        <CustomerPickerModal
          exhibitionId={exhibitionId}
          onClose={() => setAddCustomerOpen(false)}
          onAdded={handleCustomerAdded}
        />
      )}
    </section>
  );
}
