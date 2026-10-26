import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOrderFilterOptions,
  getOrders,
  getOrdersSummary,
  updateOrderStatus,
  type OrdersFilters,
  type OrderFilterOptions,
} from './orders.queries';
import type { OrderRow, OrderStatus, OrdersSummary } from './orders.types';
import { createPayment } from '../payments/payments.queries';
import type { PaymentMethod } from '../payments/payments.types';
import './OrdersScreen.css';
import CreateOrderModal from './CreateOrderModal';
import OrderDetailsScreen from './OrderDetailsScreen';

const initialFilters: OrdersFilters = {
  search: '',
  customerId: 'all',
  exhibitionId: 'all',
  dateRange: 'all',
  status: 'Confirmed',
  sort: 'newest',
};

const emptySummary: OrdersSummary = {
  confirmedCount: 0,
  confirmedValuePaise: 0,
  exhibitionOrderCount: 0,
  directOrderCount: 0,
  provisionalItemCount: 0,
  provisionalCustomerCount: 0,
};

const emptyOptions: OrderFilterOptions = {
  customers: [],
  exhibitions: [],
};

const statusOptions: OrderStatus[] = [
  'Confirmed',
  'On Hold',
  'Manufacturing',
  'Ready',
  'Sent',
  'Completed',
  'Cancelled',
];

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface DropdownOption {
  value: string;
  label: string;
}

interface CustomDropdownProps {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel: string;
}

function CustomDropdown({
  label,
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
}: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      optionRefs.current[highlightedIndex]?.focus();
    }
  }, [open, highlightedIndex]);

  function selectOption(option: DropdownOption) {
    onChange(option.value);
    setOpen(false);
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Enter' ||
      event.key === ' '
    ) {
      event.preventDefault();
      setHighlightedIndex(selectedIndex);
      setOpen(true);
    }
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(options[index]);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`orders-filter-control ${className} ${
        open ? 'orders-dropdown--open' : ''
      }`}
    >
      <span className='orders-filter-label'>{label}</span>

      <button
        type='button'
        className='orders-dropdown-trigger'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => {
          if (!open) setHighlightedIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className='orders-dropdown-value'>{selectedOption?.label}</span>
        <svg
          className='orders-dropdown-chevron'
          viewBox='0 0 20 20'
          fill='none'
          aria-hidden='true'
        >
          <path d='m5 7.5 5 5 5-5' />
        </svg>
      </button>

      {open && (
        <div
          className='orders-dropdown-menu'
          role='listbox'
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type='button'
              role='option'
              aria-selected={option.value === value}
              tabIndex={highlightedIndex === index ? 0 : -1}
              className={`orders-dropdown-option ${
                option.value === value ? 'orders-dropdown-option--selected' : ''
              } ${
                highlightedIndex === index
                  ? 'orders-dropdown-option--highlighted'
                  : ''
              }`}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectOption(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <svg viewBox='0 0 20 20' fill='none' aria-hidden='true'>
                  <path d='m4 10 4 4 8-8' />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatMoney(paise: number) {
  return currency.format(paise / 100);
}

function formatDate(value: string | null) {
  if (!value) return '—';

  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatOrderNumber(id: number) {
  return `ORD-${String(id).padStart(4, '0')}`;
}

type OrderSortColumn =
  | 'order'
  | 'customer'
  | 'source'
  | 'items'
  | 'date'
  | 'value'
  | 'received'
  | 'pending';

function OrdersScreen() {
  const [tableSort, setTableSort] = useState<{
    column: OrderSortColumn;
    direction: 'asc' | 'desc';
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState<OrdersFilters>(initialFilters);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<OrdersSummary>(emptySummary);
  const [options, setOptions] = useState<OrderFilterOptions>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [paymentOrder, setPaymentOrder] = useState<OrderRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [nextOrders, nextSummary, nextOptions] = await Promise.all([
        getOrders(filters),
        getOrdersSummary(),
        getOrderFilterOptions(),
      ]);

      setOrders(nextOrders);
      setSummary(nextSummary);
      setOptions(nextOptions);
    } catch (err) {
      console.error('Failed to load orders:', err);
      setError('Could not load orders. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const headingDescription = useMemo(
    () => 'Confirmed orders from exhibitions and direct sales.',
    [],
  );

  const sortedOrders = useMemo(() => {
    if (!tableSort) return orders;

    const valueFor = (order: OrderRow): string | number => {
      switch (tableSort.column) {
        case 'order':
          return order.id;
        case 'customer':
          return order.customerName.toLocaleLowerCase();
        case 'source':
          return (order.exhibitionName ?? 'Direct order').toLocaleLowerCase();
        case 'items':
          return order.itemCount;
        case 'date':
          return new Date(order.orderDate.replace(' ', 'T')).getTime() || 0;
        case 'value':
          return order.totalValuePaise;
        case 'received':
          return order.paymentReceivedPaise;
        case 'pending':
          return order.paymentPendingPaise;
      }
    };

    return [...orders].sort((a, b) => {
      const left = valueFor(a);
      const right = valueFor(b);
      const comparison =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), 'en', {
              numeric: true,
              sensitivity: 'base',
            });
      return tableSort.direction === 'asc' ? comparison : -comparison;
    });
  }, [orders, tableSort]);

  const totalPages = Math.max(1, Math.ceil(sortedOrders.length / pageSize));
  const paginatedOrders = useMemo(
    () => sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sortedOrders, currentPage, pageSize],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, tableSort, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  function toggleTableSort(column: OrderSortColumn) {
    if (tableSort?.column === column && tableSort.direction === 'desc') {
      setTableSort(null);
      setFilters((current) => ({ ...current, sort: 'newest' }));
      return;
    }

    setTableSort({
      column,
      direction:
        tableSort?.column === column && tableSort.direction === 'asc'
          ? 'desc'
          : 'asc',
    });
  }

  function sortableHeader(
    label: string,
    column: OrderSortColumn,
    numeric = false,
  ) {
    const active = tableSort?.column === column;
    return (
      <button
        type='button'
        className={`orders-sort-header-button ${
          numeric ? 'orders-sort-header-button--numeric' : ''
        }`}
        onClick={() => toggleTableSort(column)}
        aria-label={`Sort by ${label}`}
        aria-pressed={active}
      >
        <span>{label}</span>
        <span
          className={`orders-sort-indicator ${
            active ? 'orders-sort-indicator--active' : ''
          }`}
          aria-hidden='true'
        >
          {active ? (tableSort!.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    );
  }

  function updateFilter<K extends keyof OrdersFilters>(
    key: K,
    value: OrdersFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(initialFilters);
  }

  const customerDropdownOptions: DropdownOption[] = [
    { value: 'all', label: 'All' },
    ...options.customers.map((customer) => ({
      value: String(customer.id),
      label: customer.name,
    })),
  ];

  const exhibitionDropdownOptions: DropdownOption[] = [
    { value: 'all', label: 'All, incl. direct' },
    { value: 'direct', label: 'Direct order' },
    ...options.exhibitions.map((exhibition) => ({
      value: String(exhibition.id),
      label: exhibition.name,
    })),
  ];

  const dateDropdownOptions: DropdownOption[] = [
    { value: 'all', label: 'Any time' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
    { value: '365', label: 'Last 12 months' },
  ];

  const statusDropdownOptions: DropdownOption[] = [
    { value: 'All', label: 'All statuses' },
    ...statusOptions.map((status) => ({
      value: status,
      label: status,
    })),
  ];

  const columnSortLabels: Record<
    OrderSortColumn,
    { asc: string; desc: string }
  > = {
    order: { asc: 'Order (low to high)', desc: 'Order (high to low)' },
    customer: { asc: 'Customer (A–Z)', desc: 'Customer (Z–A)' },
    source: {
      asc: 'Exhibition / source (A–Z)',
      desc: 'Exhibition / source (Z–A)',
    },
    items: { asc: 'Items (low to high)', desc: 'Items (high to low)' },
    date: {
      asc: 'Order date (oldest first)',
      desc: 'Order date (newest first)',
    },
    value: {
      asc: 'Order value (low to high)',
      desc: 'Order value (high to low)',
    },
    received: {
      asc: 'Payment received (low to high)',
      desc: 'Payment received (high to low)',
    },
    pending: {
      asc: 'Payment pending (low to high)',
      desc: 'Payment pending (high to low)',
    },
  };

  const sortDropdownOptions: DropdownOption[] = [
    { value: 'default', label: 'Default (Newest first)' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'value-high', label: 'Highest value' },
    { value: 'value-low', label: 'Lowest value' },
    ...(tableSort
      ? [
          {
            value: 'column-sort',
            label: columnSortLabels[tableSort.column][tableSort.direction],
          },
        ]
      : []),
  ];

  const sortDropdownValue = tableSort
    ? 'column-sort'
    : filters.sort === 'newest'
      ? 'default'
      : filters.sort;

  async function handleStatusChange(order: OrderRow, value: string) {
    try {
      setError(null);
      await updateOrderStatus(order.id, value as OrderStatus);
      await loadOrders();
    } catch (err) {
      console.error('Failed to update order status:', err);
      setError(
        err instanceof Error ? err.message : 'Could not update order status.',
      );
    }
  }

  function openPayment(order: OrderRow) {
    setPaymentOrder(order);
    setPaymentAmount('');
    setPaymentDate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    setPaymentMethod('Cash');
    setPaymentNotes('');
    setPaymentError(null);
  }

  async function submitOrderPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!paymentOrder) return;
    const amountPaise = Math.round(Number(paymentAmount) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      setPaymentError('Enter a payment amount greater than zero.');
      return;
    }
    if (amountPaise > paymentOrder.paymentPendingPaise) {
      setPaymentError('Payment cannot exceed this order’s pending balance.');
      return;
    }
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      await createPayment({
        orderId: paymentOrder.id,
        amountPaise,
        paymentDate,
        paymentMethod,
        notes: paymentNotes,
      });
      setPaymentOrder(null);
      await loadOrders();
    } catch (err) {
      console.error('Failed to record order payment:', err);
      setPaymentError(
        err instanceof Error ? err.message : 'Could not record payment.',
      );
    } finally {
      setPaymentSaving(false);
    }
  }

  if (selectedOrderId !== null) {
    return (
      <OrderDetailsScreen
        orderId={selectedOrderId}
        onBack={() => {
          setSelectedOrderId(null);
          void loadOrders();
        }}
      />
    );
  }

  return (
    <section className='orders-screen'>
      <header className='orders-page-heading'>
        <div>
          <h1 className='orders-page-title'>Orders</h1>
          <p className='orders-page-description'>{headingDescription}</p>
        </div>

        <button
          type='button'
          className='orders-create-button'
          onClick={() => setCreateOrderOpen(true)}
          title='Create order — coming in the next implementation step'
        >
          <span aria-hidden='true'>+</span> Create order
        </button>
      </header>

      <section className='orders-summary' aria-label='Order summary'>
        <div className='orders-summary-card'>
          <span className='orders-summary-label'>Confirmed orders</span>
          <strong className='orders-summary-value'>
            {summary.confirmedCount}
          </strong>
          <span className='orders-summary-note'>All confirmed orders</span>
        </div>

        <div className='orders-summary-card'>
          <span className='orders-summary-label'>Total order value</span>
          <strong className='orders-summary-value'>
            {formatMoney(summary.confirmedValuePaise)}
          </strong>
          <span className='orders-summary-note'>
            Sum of item values, not payments
          </span>
        </div>

        <div className='orders-summary-card'>
          <span className='orders-summary-label'>By source</span>
          <strong className='orders-summary-value orders-source-value'>
            {summary.exhibitionOrderCount}
            <span>exhibition</span>
            <i aria-hidden='true'>·</i>
            {summary.directOrderCount}
            <span>direct</span>
          </strong>
          <span className='orders-summary-note'>Non-cancelled orders</span>
        </div>

        <div className='orders-summary-card orders-provisional-card'>
          <span className='orders-summary-label'>Provisional selections</span>
          <strong className='orders-summary-value'>
            {summary.provisionalItemCount}
            <span className='orders-summary-inline-note'> items</span>
            <span className='orders-summary-separator'>·</span>
            {summary.provisionalCustomerCount}
            <span className='orders-summary-inline-note'> customers</span>
          </strong>
          <span className='orders-summary-note'>
            Not orders until confirmed
          </span>
        </div>
      </section>

      <section className='orders-filters' aria-label='Filter orders'>
        <label className='orders-search'>
          <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            <circle cx='10.8' cy='10.8' r='6.8' />
            <path d='m16 16 4.5 4.5' />
          </svg>
          <input
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder='Order number or customer...'
            aria-label='Search order number or customer'
          />
        </label>

        <CustomDropdown
          label='Customer'
          ariaLabel='Filter by customer'
          value={filters.customerId}
          options={customerDropdownOptions}
          onChange={(value) => updateFilter('customerId', value)}
        />

        <CustomDropdown
          label='Exhibition'
          ariaLabel='Filter by exhibition'
          value={filters.exhibitionId}
          options={exhibitionDropdownOptions}
          onChange={(value) => updateFilter('exhibitionId', value)}
        />

        <CustomDropdown
          label='Date'
          ariaLabel='Filter by date'
          value={filters.dateRange}
          options={dateDropdownOptions}
          onChange={(value) =>
            updateFilter('dateRange', value as OrdersFilters['dateRange'])
          }
        />

        <CustomDropdown
          label='Status'
          ariaLabel='Filter by status'
          value={filters.status}
          options={statusDropdownOptions}
          className='orders-status-filter'
          onChange={(value) =>
            updateFilter('status', value as OrdersFilters['status'])
          }
        />

        <CustomDropdown
          label='Sort'
          ariaLabel='Sort orders'
          value={sortDropdownValue}
          options={sortDropdownOptions}
          className='orders-sort-filter'
          onChange={(value) => {
            setTableSort(null);
            updateFilter(
              'sort',
              (value === 'default' || value === 'column-sort'
                ? 'newest'
                : value) as OrdersFilters['sort'],
            );
          }}
        />

        <button
          type='button'
          className='orders-reset-button'
          onClick={resetFilters}
        >
          Reset filters
        </button>
      </section>

      {error && (
        <div className='orders-error' role='alert'>
          <span>{error}</span>
          <button type='button' onClick={() => void loadOrders()}>
            Retry
          </button>
        </div>
      )}

      <section className='orders-table-card' aria-label='Orders list'>
        <div className='orders-table-scroll'>
          <table className='orders-table'>
            <thead>
              <tr>
                <th className='orders-serial-heading'>S.No.</th>
                <th>{sortableHeader('Order', 'order')}</th>
                <th>{sortableHeader('Customer', 'customer')}</th>
                <th>{sortableHeader('Exhibition / source', 'source')}</th>
                <th className='orders-number-cell'>
                  {sortableHeader('Items', 'items', true)}
                </th>
                <th>{sortableHeader('Order date', 'date')}</th>
                <th className='orders-number-cell'>
                  {sortableHeader('Order value', 'value', true)}
                </th>
                <th className='orders-number-cell'>
                  {sortableHeader('Payment received', 'received', true)}
                </th>
                <th className='orders-number-cell'>
                  {sortableHeader('Payment pending', 'pending', true)}
                </th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {!loading &&
                !error &&
                paginatedOrders.map((order, index) => (
                  <tr key={order.id}>
                    <td className='orders-serial-cell'>
                      {(currentPage - 1) * pageSize + index + 1}
                    </td>
                    <td className='orders-number'>
                      {formatOrderNumber(order.id)}
                    </td>
                    <td>
                      <div className='orders-customer-name'>
                        {order.customerName}
                      </div>
                      <div className='orders-secondary'>
                        {[order.contactName, order.city]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </div>
                    </td>
                    <td>
                      {order.exhibitionName ? (
                        <>
                          <div className='orders-exhibition-name'>
                            {order.exhibitionName}
                          </div>
                          <div className='orders-secondary'>
                            {formatDate(order.exhibitionStartDate)}
                          </div>
                        </>
                      ) : (
                        <span className='orders-direct-badge'>
                          Direct order
                        </span>
                      )}
                    </td>
                    <td className='orders-number-cell'>{order.itemCount}</td>
                    <td>{formatDate(order.orderDate)}</td>
                    <td className='orders-number-cell orders-value'>
                      {formatMoney(order.totalValuePaise)}
                    </td>
                    <td className='orders-number-cell orders-payment-received'>
                      {formatMoney(order.paymentReceivedPaise)}
                    </td>
                    <td className='orders-number-cell orders-payment-pending'>
                      {formatMoney(order.paymentPendingPaise)}
                    </td>
                    <td>
                      <CustomDropdown
                        label=''
                        ariaLabel={`Change status for ${formatOrderNumber(order.id)}`}
                        value={order.status}
                        options={statusOptions.map((status) => ({
                          value: status,
                          label: status,
                        }))}
                        className={`orders-row-status-dropdown orders-row-status-dropdown--${order.status.toLowerCase().replace(/ /g, '-')}`}
                        onChange={(value) =>
                          void handleStatusChange(order, value)
                        }
                      />
                    </td>
                    <td className='orders-actions-cell'>
                      {order.status !== 'Cancelled' &&
                        order.paymentPendingPaise > 0 && (
                          <button
                            type='button'
                            className='orders-record-payment'
                            onClick={() => openPayment(order)}
                          >
                            Record payment
                          </button>
                        )}
                      <button
                        type='button'
                        className='orders-row-open'
                        aria-label={`Open order ${formatOrderNumber(order.id)}`}
                        title={`Open ${formatOrderNumber(order.id)}`}
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        ›
                      </button>
                    </td>
                  </tr>
                ))}

              {loading && (
                <tr>
                  <td colSpan={11} className='orders-table-message'>
                    Loading orders…
                  </td>
                </tr>
              )}

              {!loading && !error && orders.length === 0 && (
                <tr>
                  <td colSpan={11} className='orders-table-message'>
                    No orders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className='orders-table-footer orders-table-pagination'>
          <span className='orders-pagination-range'>
            Showing {sortedOrders.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–
            {Math.min(currentPage * pageSize, sortedOrders.length)} of {sortedOrders.length} orders
          </span>
          <div className='orders-pagination-controls'>
            <label className='orders-page-size-control'>
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
            <span className='orders-pagination-page'>Page {currentPage} of {totalPages}</span>
            <button type='button' aria-label='First page' title='First page' disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>«</button>
            <button type='button' aria-label='Previous page' title='Previous page' disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}>‹</button>
            <button type='button' aria-label='Next page' title='Next page' disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}>›</button>
            <button type='button' aria-label='Last page' title='Last page' disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>»</button>
          </div>
          <span className='orders-table-footer-note'>Order value is the final order total. Payments and pending balances are tracked per order.</span>
        </footer>
      </section>
      {createOrderOpen && (
        <CreateOrderModal
          onClose={() => setCreateOrderOpen(false)}
          onCreated={() => {
            setCreateOrderOpen(false);
            void loadOrders();
          }}
        />
      )}
      {paymentOrder && (
        <div
          className='orders-payment-backdrop'
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !paymentSaving)
              setPaymentOrder(null);
          }}
        >
          <section
            className='orders-payment-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='orders-payment-title'
          >
            <header className='orders-payment-modal-header'>
              <div>
                <h2 id='orders-payment-title'>Record payment</h2>
                <p>
                  {formatOrderNumber(paymentOrder.id)} ·{' '}
                  {paymentOrder.customerName}
                </p>
              </div>
              <button
                type='button'
                onClick={() => setPaymentOrder(null)}
                disabled={paymentSaving}
                aria-label='Close modal'
              >
                ×
              </button>
            </header>
            <div className='orders-payment-balance'>
              <span>Pending balance</span>
              <strong>{formatMoney(paymentOrder.paymentPendingPaise)}</strong>
            </div>
            {paymentError && (
              <div
                className='orders-error orders-payment-form-error'
                role='alert'
              >
                {paymentError}
              </div>
            )}
            <form
              className='orders-payment-form'
              onSubmit={(event) => void submitOrderPayment(event)}
            >
              <label>
                <span>Amount (₹) *</span>
                <input
                  required
                  type='number'
                  min='0.01'
                  max={(paymentOrder.paymentPendingPaise / 100).toFixed(2)}
                  step='0.01'
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  placeholder='0.00'
                />
              </label>
              <label>
                <span>Payment date *</span>
                <input
                  required
                  type='date'
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </label>
              <label>
                <span>Payment method *</span>
                <select
                  value={paymentMethod}
                  onChange={(event) =>
                    setPaymentMethod(event.target.value as PaymentMethod)
                  }
                >
                  {(
                    [
                      'Cash',
                      'Bank Transfer',
                      'UPI',
                      'Cheque',
                      'Other',
                    ] as PaymentMethod[]
                  ).map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>
              <label className='orders-payment-notes'>
                <span>Notes (optional)</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={paymentNotes}
                  onChange={(event) => setPaymentNotes(event.target.value)}
                  placeholder='Add a reference or details…'
                />
              </label>
              <footer>
                <button
                  type='button'
                  className='orders-payment-cancel'
                  onClick={() => setPaymentOrder(null)}
                  disabled={paymentSaving}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  className='orders-payment-submit'
                  disabled={paymentSaving}
                >
                  {paymentSaving ? 'Saving…' : 'Record payment'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export default OrdersScreen;
