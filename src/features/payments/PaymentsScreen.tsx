import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPayments, getPaymentSummary } from './payments.queries';
import type { PaymentRow, PaymentSummary } from './payments.types';
import './PaymentsScreen.css';

interface PaymentsScreenProps { onViewOrder?: (orderId: number) => void }
interface DropdownOption { value: string; label: string }
interface CustomDropdownProps {
  label: string; value: string; options: DropdownOption[];
  onChange: (value: string) => void; ariaLabel: string;
}

function CustomDropdown({ label, value, options, onChange, ariaLabel }: CustomDropdownProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => { if (open) optionRefs.current[highlightedIndex]?.focus(); }, [open, highlightedIndex]);
  function choose(option: DropdownOption) { onChange(option.value); setOpen(false); }
  function triggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); setHighlightedIndex(selectedIndex); setOpen(true);
    }
  }
  function optionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setHighlightedIndex((index + 1) % options.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlightedIndex((index - 1 + options.length) % options.length); }
    else if (event.key === 'Home') { event.preventDefault(); setHighlightedIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setHighlightedIndex(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[index]); }
    else if (event.key === 'Tab') setOpen(false);
  }

  return <div ref={rootRef} className={`payments-filter-control ${open ? 'payments-dropdown--open' : ''}`}>
    <span className="payments-filter-label">{label}</span>
    <button type="button" className="payments-dropdown-trigger" aria-label={ariaLabel}
      aria-haspopup="listbox" aria-expanded={open}
      onClick={() => { if (!open) setHighlightedIndex(selectedIndex); setOpen((current) => !current); }}
      onKeyDown={triggerKeyDown}>
      <span className="payments-dropdown-value">{selectedOption?.label}</span>
      <svg className="payments-dropdown-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
    </button>
    {open && <div className="payments-dropdown-menu" role="listbox" aria-label={ariaLabel}>
      {options.map((option, index) => <button key={option.value}
        ref={(element) => { optionRefs.current[index] = element; }} type="button" role="option"
        aria-selected={option.value === value} tabIndex={highlightedIndex === index ? 0 : -1}
        className={`payments-dropdown-option ${option.value === value ? 'payments-dropdown-option--selected' : ''} ${highlightedIndex === index ? 'payments-dropdown-option--highlighted' : ''}`}
        onMouseEnter={() => setHighlightedIndex(index)} onClick={() => choose(option)}
        onKeyDown={(event) => optionKeyDown(event, index)}>
        <span>{option.label}</span>
        {option.value === value && <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg>}
      </button>)}
    </div>}
  </div>;
}

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptySummary: PaymentSummary = { totalReceivedPaise: 0, totalOutstandingPaise: 0, transactionCount: 0 };
function formatMoney(paise: number) { return currency.format(paise / 100); }
function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function PaymentsScreen({ onViewOrder }: PaymentsScreenProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [exhibitionFilter, setExhibitionFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  const loadPayments = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rows, totals] = await Promise.all([getPayments(), getPaymentSummary()]);
      setPayments(rows); setSummary(totals);
    } catch (err) {
      console.error('Failed to load payments:', err);
      setError('Could not load payments. Please try again.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadPayments(); }, [loadPayments]);

  const customerOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All customers' },
    ...Array.from(new Map(payments.filter((p) => p.customerId != null).map((p) => [String(p.customerId), p.customerName])).entries())
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [payments]);
  const exhibitionOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All exhibitions' },
    ...Array.from(new Map(payments.filter((p) => p.exhibitionId != null && p.exhibitionName != null).map((p) => [String(p.exhibitionId), p.exhibitionName as string])).entries())
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [payments]);
  const methodOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All methods' },
    ...Array.from(new Set(payments.map((p) => p.paymentMethod || 'Not specified'))).sort()
      .map((method) => ({ value: method, label: method })),
  ], [payments]);
  const dateOptions: DropdownOption[] = [
    { value: 'all', label: 'Any time' }, { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' }, { value: '365', label: 'Last 12 months' },
  ];

  const filteredPayments = useMemo(() => {
    const cutoff = dateFilter === 'all' ? null : new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - Number(dateFilter));
    const term = search.trim().toLocaleLowerCase();
    return payments.filter((payment) => {
      const searchable = [payment.orderNumber ?? '', payment.customerName, payment.exhibitionName ?? '', payment.paymentMethod ?? '', payment.notes ?? '', String(payment.id)].join(' ').toLocaleLowerCase();
      const date = new Date(`${payment.paymentDate.slice(0, 10)}T00:00:00`);
      if (term && !searchable.includes(term)) return false;
      if (customerFilter !== 'all' && String(payment.customerId ?? '') !== customerFilter) return false;
      if (exhibitionFilter !== 'all' && String(payment.exhibitionId ?? '') !== exhibitionFilter) return false;
      if (methodFilter !== 'all' && (payment.paymentMethod || 'Not specified') !== methodFilter) return false;
      if (cutoff && (Number.isNaN(date.getTime()) || date < cutoff)) return false;
      return true;
    });
  }, [payments, search, customerFilter, exhibitionFilter, methodFilter, dateFilter]);

  function resetFilters() {
    setSearch(''); setCustomerFilter('all'); setExhibitionFilter('all'); setMethodFilter('all'); setDateFilter('all');
  }

  return <section className="payments-screen">
    <header className="payments-page-heading"><div>
      <h1 className="payments-page-title">Payments</h1>
      <p className="payments-page-description">A history of payments recorded against orders.</p>
    </div></header>

    <section className="payments-summary" aria-label="Payment summary">
      <div className="payments-summary-card"><span className="payments-summary-label">Total received</span><strong className="payments-summary-value">{formatMoney(summary.totalReceivedPaise)}</strong><span className="payments-summary-note">All recorded payment transactions</span></div>
      <div className="payments-summary-card"><span className="payments-summary-label">Transactions</span><strong className="payments-summary-value">{summary.transactionCount}</strong><span className="payments-summary-note">Historical payment entries</span></div>
    </section>

    <section className="payments-filters" aria-label="Filter payments">
      <label className="payments-search"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, exhibition, method or notes..." aria-label="Search payments" /></label>
      <CustomDropdown label="Customer" ariaLabel="Filter by customer" value={customerFilter} options={customerOptions} onChange={setCustomerFilter} />
      <CustomDropdown label="Exhibition" ariaLabel="Filter by exhibition" value={exhibitionFilter} options={exhibitionOptions} onChange={setExhibitionFilter} />
      <CustomDropdown label="Method" ariaLabel="Filter by payment method" value={methodFilter} options={methodOptions} onChange={setMethodFilter} />
      <CustomDropdown label="Date" ariaLabel="Filter by date" value={dateFilter} options={dateOptions} onChange={setDateFilter} />
      <button type="button" className="payments-reset-button" onClick={resetFilters}>Reset filters</button>
    </section>

    {error && <div className="payments-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadPayments()}>Retry</button></div>}
    <section className="payments-table-card" aria-label="Payment transactions"><div className="payments-table-scroll"><table className="payments-table"><thead><tr><th>Payment date</th><th>Order</th><th>Customer</th><th>Exhibition / source</th><th>Payment method</th><th>Notes</th><th className="payments-number-cell">Amount received</th></tr></thead><tbody>
      {!loading && !error && filteredPayments.map((payment) => <tr key={payment.id}><td className="payments-date">{formatDate(payment.paymentDate)}</td><td><div className="payments-primary-cell">{payment.orderId !== null && payment.orderId !== undefined && onViewOrder ? <button type="button" className="payments-order-link" onClick={() => onViewOrder(payment.orderId as number)}>{payment.orderNumber || `Order ${payment.orderId}`}<span aria-hidden="true"> ↗</span></button> : payment.orderNumber || 'Legacy payment'}</div></td><td><div className="payments-primary-cell">{payment.customerName || '—'}</div></td><td><div className="payments-primary-cell">{payment.exhibitionName || (payment.orderId ? 'Direct order' : 'Unallocated legacy payment')}</div></td><td><span className="payments-method-badge">{payment.paymentMethod || 'Not specified'}</span></td><td className="payments-notes" title={payment.notes || undefined}>{payment.notes || '—'}</td><td className="payments-number-cell payments-amount">{formatMoney(payment.amountPaise)}</td></tr>)}
      {loading && <tr><td colSpan={7} className="payments-table-message">Loading payments…</td></tr>}
      {!loading && !error && filteredPayments.length === 0 && <tr><td colSpan={7} className="payments-table-message">{payments.length ? 'No payments match these filters.' : 'No payments recorded yet.'}</td></tr>}
    </tbody></table></div><footer className="payments-table-footer">Showing {filteredPayments.length} of {payments.length} payment transactions.</footer></section>

  </section>;
}

export default PaymentsScreen;
