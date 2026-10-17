import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getOrderFilterOptions,
  getOrders,
  getOrdersSummary,
  type OrdersFilters,
  type OrderFilterOptions,
} from './orders.queries';
import type { OrderRow, OrderStatus, OrdersSummary } from './orders.types';
import './OrdersScreen.css';
import CreateOrderModal from './CreateOrderModal';

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

function OrdersScreen() {
  const [filters, setFilters] = useState<OrdersFilters>(initialFilters);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<OrdersSummary>(emptySummary);
  const [options, setOptions] = useState<OrderFilterOptions>(emptyOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);

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

  const sortDropdownOptions: DropdownOption[] = [
    { value: 'newest', label: 'Newest first' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'value-high', label: 'Highest value' },
    { value: 'value-low', label: 'Lowest value' },
  ];

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

        <button
          type='button'
          className='orders-summary-card orders-provisional-card'
          onClick={() => {
            // Exhibition navigation will be connected to the selection review flow.
          }}
          title='Review provisional selections in Exhibitions'
        >
          <span className='orders-summary-label'>Provisional selections</span>
          <strong className='orders-summary-value'>
            {summary.provisionalItemCount}
            <span className='orders-summary-inline-note'> items</span>
            <span className='orders-summary-separator'>·</span>
            {summary.provisionalCustomerCount}
            <span className='orders-summary-inline-note'> customers</span>
          </strong>
          <span className='orders-summary-note'>
            Not orders until confirmed · <u>Review in Exhibitions</u>
          </span>
        </button>
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
          value={filters.sort}
          options={sortDropdownOptions}
          className='orders-sort-filter'
          onChange={(value) =>
            updateFilter('sort', value as OrdersFilters['sort'])
          }
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
                <th>Order</th>
                <th>Customer</th>
                <th>Exhibition / source</th>
                <th className='orders-number-cell'>Items</th>
                <th>Order date</th>
                <th className='orders-number-cell'>Order value</th>
                <th>Status</th>
                <th aria-label='Open order' />
              </tr>
            </thead>

            <tbody>
              {!loading &&
                !error &&
                orders.map((order) => (
                  <tr key={order.id}>
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
                    <td>
                      <span
                        className={`orders-status-badge orders-status-badge--${order.status
                          .toLowerCase()
                          .replace(/ /g, '-')}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td>
                      <button
                        type='button'
                        className='orders-row-open'
                        aria-label={`Open order ${formatOrderNumber(order.id)}`}
                        title='Order details will be added next'
                        onClick={() => {
                          // Connected in the Order Details implementation step.
                        }}
                      >
                        ›
                      </button>
                    </td>
                  </tr>
                ))}

              {loading && (
                <tr>
                  <td colSpan={8} className='orders-table-message'>
                    Loading orders…
                  </td>
                </tr>
              )}

              {!loading && !error && orders.length === 0 && (
                <tr>
                  <td colSpan={8} className='orders-table-message'>
                    No orders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className='orders-table-footer'>
          Showing {orders.length} of {orders.length} matching orders. Order
          value is the total of its jewelry items. Payments are tracked per
          customer and exhibition, not per order.
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
    </section>
  );
}

export default OrdersScreen;
