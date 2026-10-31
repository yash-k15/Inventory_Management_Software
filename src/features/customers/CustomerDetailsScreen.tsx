import { useCallback, useEffect, useRef, useState } from 'react';
import ExportDialog from '../../components/export/ExportDialog';
import type { ExportConfiguration } from '../../components/export/export.types';
import {
  getCustomerDetailsSummary,
  getCustomerOrderHistory,
  getCustomerPaymentHistory,
  getCustomerContacts,
  getCustomers,
} from './customer.queries';
import type {
  Customer,
  CustomerContact,
  CustomerDetailsSummary,
  CustomerOrderHistoryRow,
  CustomerPaymentHistoryRow,
} from './customer.types';
import './CustomerDetailsScreen.css';

type Props = {
  customerId: number;
  onBack: () => void;
  onViewOrder: (orderId: number) => void;
};

type HistoryTab = 'orders' | 'payments';

type HistoryPaginationProps = {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

function HistoryPagination({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: HistoryPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className='customer-details-pagination'>
      <span className='customer-details-pagination-range'>
        Showing {firstItem}–{lastItem} of {totalItems}
      </span>
      <div className='customer-details-pagination-controls'>
        <label className='customer-details-page-size'>
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label='Rows per page'
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <button type='button' onClick={() => onPageChange(1)} disabled={currentPage === 1} aria-label='First page'>«</button>
        <button type='button' onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} aria-label='Previous page'>‹</button>
        <span className='customer-details-pagination-page'>Page {currentPage} of {totalPages}</span>
        <button type='button' onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} aria-label='Next page'>›</button>
        <button type='button' onClick={() => onPageChange(totalPages)} disabled={currentPage >= totalPages} aria-label='Last page'>»</button>
      </div>
    </div>
  );
}


const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function formatMoneyPaise(value: number) {
  return currency.format((Number(value) || 0) / 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatText(value: string | null | undefined) {
  return value?.trim() || '—';
}

interface HistoryDropdownOption {
  value: string;
  label: string;
}

function HistoryDropdown({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: string;
  options: HistoryDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[highlightedIndex]?.focus();
  }, [open, highlightedIndex]);

  const choose = (option: HistoryDropdownOption) => {
    onChange(option.value);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`customer-history-dropdown ${open ? 'is-open' : ''}`}>
      <span className='customer-history-dropdown-label'>{label}</span>
      <button
        type='button'
        className='customer-history-dropdown-trigger'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => {
          if (!open) setHighlightedIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            setHighlightedIndex(selectedIndex);
            setOpen(true);
          }
        }}
      >
        <span>{options[selectedIndex]?.label}</span>
        <svg viewBox='0 0 20 20' fill='none' aria-hidden='true'><path d='m5 7.5 5 5 5-5' /></svg>
      </button>
      {open && (
        <div className='customer-history-dropdown-menu' role='listbox' aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type='button'
              role='option'
              aria-selected={option.value === value}
              tabIndex={highlightedIndex === index ? 0 : -1}
              className={`customer-history-dropdown-option ${option.value === value ? 'is-selected' : ''} ${highlightedIndex === index ? 'is-highlighted' : ''}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => choose(option)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setHighlightedIndex((index + 1) % options.length); }
                else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlightedIndex((index - 1 + options.length) % options.length); }
                else if (event.key === 'Home') { event.preventDefault(); setHighlightedIndex(0); }
                else if (event.key === 'End') { event.preventDefault(); setHighlightedIndex(options.length - 1); }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); }
                else if (event.key === 'Tab') setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <svg viewBox='0 0 20 20' fill='none' aria-hidden='true'><path d='m4 10 4 4 8-8' /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function CustomerDetailsScreen({
  customerId,
  onBack,
  onViewOrder,
}: Props) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [summary, setSummary] = useState<CustomerDetailsSummary | null>(null);
  const [orders, setOrders] = useState<CustomerOrderHistoryRow[]>([]);
  const [payments, setPayments] = useState<CustomerPaymentHistoryRow[]>([]);
  const [activeTab, setActiveTab] = useState<HistoryTab>('orders');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [ordersPage, setOrdersPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderDateFilter, setOrderDateFilter] = useState('all');
  const [orderSort, setOrderSort] = useState<'newest' | 'oldest' | 'value-high' | 'value-low'>('newest');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allCustomers, customerContacts, customerSummary, orderHistory, paymentHistory] =
        await Promise.all([
          getCustomers({ search: '', archiveStatus: 'all' }),
          getCustomerContacts(customerId),
          getCustomerDetailsSummary(customerId),
          getCustomerOrderHistory(customerId),
          getCustomerPaymentHistory(customerId),
        ]);

      const foundCustomer = allCustomers.find((item) => item.id === customerId);
      if (!foundCustomer) {
        setCustomer(null);
        setError('This customer could not be found.');
        return;
      }

      setCustomer(foundCustomer);
      setContacts(customerContacts);
      setSummary(customerSummary);
      setOrders(orderHistory);
      setPayments(paymentHistory);
    } catch (loadError) {
      console.error('Failed to load customer details:', loadError);
      setError('Could not load customer details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const paymentsTotalPages = Math.max(1, Math.ceil(payments.length / pageSize));

  useEffect(() => {
    setPaymentsPage((page) => Math.min(page, paymentsTotalPages));
  }, [paymentsTotalPages]);

  const filteredOrders = orders
    .filter((order) => {
      const search = orderSearch.trim().toLocaleLowerCase();
      const matchesSearch = !search || [
        `ord-${String(order.id).padStart(4, '0')}`,
        String(order.id),
        order.exhibitionName ?? '',
        order.status,
      ].some((value) => value.toLocaleLowerCase().includes(search));
      const matchesStatus = orderStatusFilter === 'all' || order.status === orderStatusFilter;
      const orderTimestamp = new Date(order.orderDate.replace(' ', 'T')).getTime();
      const ageDays = (Date.now() - orderTimestamp) / 86400000;
      const matchesDate = orderDateFilter === 'all' ||
        (Number.isFinite(orderTimestamp) && ageDays <= Number(orderDateFilter) && ageDays >= 0);
      return matchesSearch && matchesStatus && matchesDate;
    })
    .sort((a, b) => {
      switch (orderSort) {
        case 'oldest':
          return new Date(a.orderDate.replace(' ', 'T')).getTime() - new Date(b.orderDate.replace(' ', 'T')).getTime();
        case 'value-high':
          return b.totalValuePaise - a.totalValuePaise;
        case 'value-low':
          return a.totalValuePaise - b.totalValuePaise;
        case 'newest':
        default:
          return new Date(b.orderDate.replace(' ', 'T')).getTime() - new Date(a.orderDate.replace(' ', 'T')).getTime();
      }
    });
  const filteredOrdersTotalPages = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const paginatedOrders = filteredOrders.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
  const paginatedPayments = payments.slice((paymentsPage - 1) * pageSize, paymentsPage * pageSize);

  useEffect(() => {
    setOrdersPage((page) => Math.min(page, filteredOrdersTotalPages));
  }, [filteredOrdersTotalPages]);

  useEffect(() => {
    setOrdersPage(1);
  }, [orderSearch, orderStatusFilter, orderDateFilter, orderSort]);

  const changePageSize = (size: number) => {
    setPageSize(size);
    setOrdersPage(1);
    setPaymentsPage(1);
  };

  if (loading) {
    return (
      <section className='customer-details-screen'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          ← Back to customers
        </button>
        <div className='customer-details-state'>Loading customer details…</div>
      </section>
    );
  }

  if (error || !customer) {
    return (
      <section className='customer-details-screen'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          ← Back to customers
        </button>
        <div className='customer-details-state customer-details-state--error'>
          {error || 'This customer could not be found.'}
          <button type='button' onClick={() => void loadDetails()}>Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className='customer-details-screen'>
      <div className='customer-details-topbar'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          <span aria-hidden='true'>←</span> Back to customers
        </button>
      </div>

      <header className='customer-details-header'>
        <div className='customer-details-avatar' aria-hidden='true'>
          {customer.businessName.trim().charAt(0).toUpperCase() || 'C'}
        </div>
        <div className='customer-details-heading'>
          <div className='customer-details-title-row'>
            <h1>{customer.businessName}</h1>
            <span className={`customer-details-status ${customer.isArchived ? 'is-archived' : ''}`}>
              {customer.isArchived ? 'Archived' : 'Active'}
            </span>
          </div>
          <p>
            {formatText(customer.primaryContactName)}
            {customer.city?.trim() ? ` · ${customer.city}` : ''}
          </p>
          <small>Customer since {formatDate(customer.createdAt)}</small>
        </div>
      </header>

      <div className='customer-details-metrics'>
        <article className='customer-details-metric'>
          <span>Lifetime order value</span>
          <strong>{formatMoneyPaise(summary?.lifetimeValuePaise ?? 0)}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Orders</span>
          <strong>{summary?.purchaseCount ?? 0}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Average order value</span>
          <strong>{formatMoneyPaise(summary?.averageOrderValuePaise ?? 0)}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Last purchase</span>
          <strong className='customer-details-date-value'>
            {formatDate(summary?.lastPurchaseDate)}
          </strong>
        </article>
      </div>

      <div className='customer-details-content'>
        <section className='customer-details-panel customer-details-history'>
          <div className='customer-details-panel-heading'>
            <div>
              <h2>History</h2>
              <p>Orders and payments recorded for this customer.</p>
            </div>
            <div className='customer-details-history-actions'>
              <div className='customer-details-tabs' role='tablist' aria-label='Customer history'>
                <button
                  type='button'
                  role='tab'
                  aria-selected={activeTab === 'orders'}
                  className={activeTab === 'orders' ? 'is-active' : ''}
                  onClick={() => { setActiveTab('orders'); setOrdersPage(1); }}
                >
                  Orders <span>{orders.length}</span>
                </button>
                <button
                  type='button'
                  role='tab'
                  aria-selected={activeTab === 'payments'}
                  className={activeTab === 'payments' ? 'is-active' : ''}
                  onClick={() => { setActiveTab('payments'); setPaymentsPage(1); }}
                >
                  Payments <span>{payments.length}</span>
                </button>
              </div>
              <button
                type='button'
                className='customer-details-export-button'
                onClick={() => setIsExportOpen(true)}
                disabled={activeTab === 'orders' ? filteredOrders.length === 0 : payments.length === 0}
              >
                <svg aria-hidden='true' width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                  <path d='M12 3v12' />
                  <path d='m7 10 5 5 5-5' />
                  <path d='M5 19h14' />
                </svg>
                Export
              </button>
            </div>
          </div>

          {activeTab === 'orders' ? (
            <>
              <div className='customer-details-order-filters'>
                <label className='customer-details-order-search'>
                  <span>Search orders</span>
                  <input
                    type='search'
                    value={orderSearch}
                    onChange={(event) => setOrderSearch(event.target.value)}
                    placeholder='Order no. or exhibition…'
                  />
                </label>
                <HistoryDropdown
                  label='Status'
                  ariaLabel='Filter orders by status'
                  value={orderStatusFilter}
                  onChange={setOrderStatusFilter}
                  options={[
                    { value: 'all', label: 'All statuses' },
                    ...[...new Set(orders.map((order) => order.status))].sort().map((status) => ({ value: status, label: status })),
                  ]}
                />
                <HistoryDropdown
                  label='Date'
                  ariaLabel='Filter orders by date'
                  value={orderDateFilter}
                  onChange={setOrderDateFilter}
                  options={[
                    { value: 'all', label: 'Any time' },
                    { value: '30', label: 'Last 30 days' },
                    { value: '90', label: 'Last 90 days' },
                    { value: '365', label: 'Last 12 months' },
                  ]}
                />
                {(orderSearch || orderStatusFilter !== 'all' || orderDateFilter !== 'all' || orderSort !== 'newest') && (
                  <button type='button' className='customer-details-reset-filters' onClick={() => {
                    setOrderSearch('');
                    setOrderStatusFilter('all');
                    setOrderDateFilter('all');
                    setOrderSort('newest');
                  }}>Reset</button>
                )}
              </div>
              {orders.length === 0 ? (
                <div className='customer-details-empty'>
                  <strong>No orders yet</strong>
                  <p>Orders associated with this customer will appear here.</p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className='customer-details-empty'>
                  <strong>No matching orders</strong>
                  <p>Try changing or clearing the filters.</p>
                </div>
              ) : (
                <>
                  <div className='customer-details-table-wrap'>
                    <table className='customer-details-table'>
                      <thead>
                        <tr>
                          <th className='customer-details-serial'>S.No.</th>
                          <th><button type='button' className={`customer-details-sort-heading ${orderSort === 'newest' || orderSort === 'oldest' ? 'is-active' : ''}`} onClick={() => setOrderSort((current) => current === 'newest' ? 'oldest' : 'newest')}>Order date <span>{orderSort === 'newest' ? '↓' : orderSort === 'oldest' ? '↑' : '↕'}</span></button></th>
                          <th>Order</th>
                          <th>Exhibition</th>
                          <th>Items</th>
                          <th>Status</th>
                          <th className='is-numeric'><button type='button' className={`customer-details-sort-heading ${orderSort === 'value-high' || orderSort === 'value-low' ? 'is-active' : ''}`} onClick={() => setOrderSort((current) => current === 'value-high' ? 'value-low' : 'value-high')}>Order value <span>{orderSort === 'value-high' ? '↓' : orderSort === 'value-low' ? '↑' : '↕'}</span></button></th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map((order, index) => (
                          <tr key={order.id}>
                            <td className='customer-details-serial'>{(ordersPage - 1) * pageSize + index + 1}</td>
                            <td>{formatDate(order.orderDate)}</td>
                            <td className='customer-details-order-id'>
                              <button type='button' className='customer-details-order-link' onClick={() => onViewOrder(order.id)}>
                                ORD-{String(order.id).padStart(4, '0')}
                              </button>
                            </td>
                            <td>{formatText(order.exhibitionName)}</td>
                            <td>{order.itemCount}</td>
                            <td>
                              <span className='customer-details-order-status'>
                                {order.status}
                              </span>
                            </td>
                            <td className='is-numeric'>{formatMoneyPaise(order.totalValuePaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <HistoryPagination
                    totalItems={filteredOrders.length}
                    currentPage={ordersPage}
                    pageSize={pageSize}
                    onPageChange={setOrdersPage}
                    onPageSizeChange={changePageSize}
                  />
                </>
              )}
            </>
          ) : payments.length ? (
            <>
            <div className='customer-details-table-wrap'>
              <table className='customer-details-table'>
                <thead>
                  <tr>
                    <th className='customer-details-serial'>S.No.</th>
                    <th>Payment date</th>
                    <th>Exhibition</th>
                    <th>Method</th>
                    <th>Notes</th>
                    <th className='is-numeric'>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayments.map((payment, index) => (
                    <tr key={payment.id}>
                      <td className='customer-details-serial'>{(paymentsPage - 1) * pageSize + index + 1}</td>
                      <td>{formatDate(payment.paymentDate)}</td>
                      <td>{formatText(payment.exhibitionName)}</td>
                      <td>{formatText(payment.paymentMethod)}</td>
                      <td>{formatText(payment.notes)}</td>
                      <td className='is-numeric'>{formatMoneyPaise(payment.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <HistoryPagination
              totalItems={payments.length}
              currentPage={paymentsPage}
              pageSize={pageSize}
              onPageChange={setPaymentsPage}
              onPageSizeChange={changePageSize}
            />
            </>
          ) : (
            <div className='customer-details-empty'>
              <strong>No payments recorded</strong>
              <p>Payments recorded for this customer will appear here.</p>
            </div>
          )}
        </section>

        <aside className='customer-details-side'>
          <section className='customer-details-panel'>
            <h2>Contact information</h2>
            <dl className='customer-details-contact-list'>
              <div>
                <dt>Business email</dt>
                <dd>{formatText(customer.email)}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{formatText(customer.primaryContactPhone1)}</dd>
              </div>
              {customer.primaryContactPhone2?.trim() && (
                <div>
                  <dt>Alternate phone</dt>
                  <dd>{customer.primaryContactPhone2}</dd>
                </div>
              )}
              <div>
                <dt>City</dt>
                <dd>{formatText(customer.city)}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{formatText(customer.address)}</dd>
              </div>
            </dl>
            {contacts.length > 1 && (
              <div className='customer-details-other-contacts'>
                <h3>Other contacts</h3>
                {contacts.filter((contact) => !contact.isPrimary).map((contact) => (
                  <div className='customer-details-contact-person' key={contact.id}>
                    <strong>{contact.name}</strong>
                    <span>{formatText(contact.phone1)}</span>
                    {contact.phone2?.trim() && <span>{contact.phone2}</span>}
                    {contact.notes?.trim() && <small>{contact.notes}</small>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className='customer-details-panel'>
            <h2>Notes</h2>
            <p className='customer-details-notes'>
              {customer.notes?.trim() || 'No notes added for this customer.'}
            </p>
          </section>
        </aside>
      </div>
      {isExportOpen && activeTab === 'orders' && (
        <ExportDialog<CustomerOrderHistoryRow>
          configuration={{
            title: `${customer.businessName} — Orders History`,
            filename: `${customer.businessName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-')}-order-history.xlsx`,
            columns: [
              { key: 'orderDate', label: 'Order Date', value: (order) => formatDate(order.orderDate) },
              { key: 'orderNumber', label: 'Order', value: (order) => `#${order.id}` },
              { key: 'exhibition', label: 'Exhibition', value: (order) => formatText(order.exhibitionName) },
              {
                key: 'items',
                label: 'Items',
                value: (order) => order.itemCount,
                total: (rows) => rows.reduce((sum, order) => sum + order.itemCount, 0),
              },
              { key: 'status', label: 'Status', value: (order) => order.status },
              {
                key: 'orderValue',
                label: 'Order Value',
                value: (order) => formatMoneyPaise(order.totalValuePaise),
                total: (rows) => formatMoneyPaise(
                  rows.reduce((sum, order) => sum + order.totalValuePaise, 0),
                ),
              },
            ],
            filteredRows: filteredOrders,
            getAllRows: async () => filteredOrders,
          } satisfies ExportConfiguration<CustomerOrderHistoryRow>}
          onClose={() => setIsExportOpen(false)}
        />
      )}
      {isExportOpen && activeTab === 'payments' && (
        <ExportDialog<CustomerPaymentHistoryRow>
          configuration={{
            title: `${customer.businessName} — Payments History`,
            filename: `${customer.businessName.trim().replace(/[^a-zA-Z0-9_-]+/g, '-')}-payment-history.xlsx`,
            columns: [
              { key: 'paymentDate', label: 'Payment Date', value: (payment) => formatDate(payment.paymentDate) },
              { key: 'exhibition', label: 'Exhibition', value: (payment) => formatText(payment.exhibitionName) },
              { key: 'paymentMethod', label: 'Method', value: (payment) => formatText(payment.paymentMethod) },
              { key: 'notes', label: 'Notes', value: (payment) => formatText(payment.notes) },
              { key: 'amount', label: 'Amount', value: (payment) => formatMoneyPaise(payment.amountPaise) },
            ],
            filteredRows: payments,
            getAllRows: async () => payments,
          } satisfies ExportConfiguration<CustomerPaymentHistoryRow>}
          onClose={() => setIsExportOpen(false)}
        />
      )}
    </section>
  );
}
