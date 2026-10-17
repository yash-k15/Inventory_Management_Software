import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPayment, getPaymentFormOptions, getPayments, getPaymentSummary } from './payments.queries';
import type { CreatePaymentInput, PaymentFormOptions, PaymentMethod, PaymentRow, PaymentSummary } from './payments.types';
import './PaymentsScreen.css';

interface PaymentsScreenProps { onAddPayment: () => void }
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
const paymentMethods: PaymentMethod[] = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Other'];
function localToday() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
function formatMoney(paise: number) { return currency.format(paise / 100); }
function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function PaymentsScreen({ onAddPayment }: PaymentsScreenProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [summary, setSummary] = useState<PaymentSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [exhibitionFilter, setExhibitionFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [formOptions, setFormOptions] = useState<PaymentFormOptions>({ customers: [], exhibitions: [] });
  const [formLoading, setFormLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({ customerId: '', exhibitionId: '', amount: '', paymentDate: localToday(), paymentMethod: 'Cash' as PaymentMethod, notes: '' });

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

  const openPaymentModal = useCallback(async () => {
    onAddPayment();
    setModalOpen(true); setFormError(null); setFormSuccess(null); setFormLoading(true);
    try {
      const options = await getPaymentFormOptions();
      setFormOptions(options);
      setForm((current) => ({ ...current, customerId: current.customerId || (options.customers[0] ? String(options.customers[0].id) : ''), exhibitionId: current.exhibitionId || (options.exhibitions[0] ? String(options.exhibitions[0].id) : '') }));
    } catch (err) { console.error('Failed to load payment form options:', err); setFormError('Could not load customers and exhibitions. Please close and try again.'); }
    finally { setFormLoading(false); }
  }, [onAddPayment]);

  function closePaymentModal() { if (saving) return; setModalOpen(false); setFormError(null); }

  async function submitPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFormError(null); setFormSuccess(null);
    const amount = Number(form.amount);
    if (!form.customerId || !form.exhibitionId) { setFormError('Please select both a customer and an exhibition.'); return; }
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) { setFormError('Enter an amount greater than ₹0.'); return; }
    if (Math.round(amount * 100) > Number.MAX_SAFE_INTEGER) { setFormError('The payment amount is too large.'); return; }
    const input: CreatePaymentInput = { customerId: Number(form.customerId), exhibitionId: Number(form.exhibitionId), amountPaise: Math.round(amount * 100), paymentDate: form.paymentDate, paymentMethod: form.paymentMethod, notes: form.notes };
    setSaving(true);
    try {
      await createPayment(input);
      setFormSuccess('Payment recorded successfully.');
      setModalOpen(false);
      setForm({ customerId: form.customerId, exhibitionId: form.exhibitionId, amount: '', paymentDate: localToday(), paymentMethod: 'Cash', notes: '' });
      await loadPayments();
    } catch (err) { console.error('Failed to record payment:', err); setFormError(err instanceof Error ? err.message : 'Could not record payment. Please try again.'); }
    finally { setSaving(false); }
  }

  const customerOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All customers' },
    ...Array.from(new Map(payments.filter((p) => p.customerId != null).map((p) => [String(p.customerId), p.customerName])).entries())
      .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
  ], [payments]);
  const exhibitionOptions = useMemo<DropdownOption[]>(() => [
    { value: 'all', label: 'All exhibitions' },
    ...Array.from(new Map(payments.map((p) => [String(p.exhibitionId), p.exhibitionName])).entries())
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
      const searchable = [payment.customerName, payment.exhibitionName, payment.paymentMethod ?? '', payment.notes ?? '', String(payment.id)].join(' ').toLocaleLowerCase();
      const date = new Date(`${payment.paymentDate.slice(0, 10)}T00:00:00`);
      if (term && !searchable.includes(term)) return false;
      if (customerFilter !== 'all' && String(payment.customerId ?? '') !== customerFilter) return false;
      if (exhibitionFilter !== 'all' && String(payment.exhibitionId) !== exhibitionFilter) return false;
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
      <p className="payments-page-description">Record and review payments received from customers for exhibitions.</p>
    </div><button type="button" className="payments-create-button" onClick={() => void openPaymentModal()}><span aria-hidden="true">+</span> Record payment</button></header>

    <section className="payments-summary" aria-label="Payment summary">
      <div className="payments-summary-card"><span className="payments-summary-label">Total received</span><strong className="payments-summary-value">{formatMoney(summary.totalReceivedPaise)}</strong><span className="payments-summary-note">All recorded payment transactions</span></div>
      <div className="payments-summary-card"><span className="payments-summary-label">Outstanding balance</span><strong className="payments-summary-value">{formatMoney(summary.totalOutstandingPaise)}</strong><span className="payments-summary-note">Across customer and exhibition balances</span></div>
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

    {formSuccess && <div className="payments-success" role="status"><span>{formSuccess}</span><button type="button" aria-label="Dismiss message" onClick={() => setFormSuccess(null)}>×</button></div>}
    {error && <div className="payments-error" role="alert"><span>{error}</span><button type="button" onClick={() => void loadPayments()}>Retry</button></div>}
    <section className="payments-table-card" aria-label="Payment transactions"><div className="payments-table-scroll"><table className="payments-table"><thead><tr><th>Payment date</th><th>Customer</th><th>Exhibition</th><th>Payment method</th><th>Notes</th><th className="payments-number-cell">Amount received</th></tr></thead><tbody>
      {!loading && !error && filteredPayments.map((payment) => <tr key={payment.id}><td className="payments-date">{formatDate(payment.paymentDate)}</td><td><div className="payments-primary-cell">{payment.customerName || '—'}</div></td><td><div className="payments-primary-cell">{payment.exhibitionName || '—'}</div></td><td><span className="payments-method-badge">{payment.paymentMethod || 'Not specified'}</span></td><td className="payments-notes" title={payment.notes || undefined}>{payment.notes || '—'}</td><td className="payments-number-cell payments-amount">{formatMoney(payment.amountPaise)}</td></tr>)}
      {loading && <tr><td colSpan={6} className="payments-table-message">Loading payments…</td></tr>}
      {!loading && !error && filteredPayments.length === 0 && <tr><td colSpan={6} className="payments-table-message">{payments.length ? 'No payments match these filters.' : 'No payments recorded yet.'}</td></tr>}
    </tbody></table></div><footer className="payments-table-footer">Showing {filteredPayments.length} of {payments.length} payment transactions. Payments are recorded against a customer and exhibition, not individual orders.</footer></section>
    {modalOpen && <div className="payment-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePaymentModal(); }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
        <header className="payment-modal-header"><div><h2 id="payment-modal-title">Record payment</h2><p>Add a payment received from a customer for an exhibition.</p></div><button type="button" className="payment-modal-close" onClick={closePaymentModal} aria-label="Close modal" disabled={saving}>×</button></header>
        {formError && <div className="payments-error payment-form-error" role="alert">{formError}</div>}
        {formLoading ? <div className="payment-form-loading">Loading customers and exhibitions…</div> : <form className="payment-form" onSubmit={(event) => void submitPayment(event)}>
          <div className="payment-form-field payment-form-field--wide"><span className="payment-form-label">Customer <span>*</span></span><CustomDropdown label="" ariaLabel="Select customer" value={form.customerId} options={formOptions.customers.map((customer) => ({ value: String(customer.id), label: customer.name }))} onChange={(value) => setForm((current) => ({ ...current, customerId: value }))} /></div>
          <div className="payment-form-field payment-form-field--wide"><span className="payment-form-label">Exhibition <span>*</span></span><CustomDropdown label="" ariaLabel="Select exhibition" value={form.exhibitionId} options={formOptions.exhibitions.map((exhibition) => ({ value: String(exhibition.id), label: exhibition.name }))} onChange={(value) => setForm((current) => ({ ...current, exhibitionId: value }))} /></div>
          {(!formOptions.customers.length || !formOptions.exhibitions.length) && <p className="payment-form-hint payment-form-field--wide">{!formOptions.customers.length ? 'Add a customer before recording a payment. ' : ''}{!formOptions.exhibitions.length ? 'Create an exhibition before recording a payment.' : ''}</p>}
          <label className="payment-form-field"><span className="payment-form-label">Amount (₹) <span>*</span></span><div className="payment-amount-input"><span>₹</span><input required type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></div></label>
          <label className="payment-form-field"><span className="payment-form-label">Payment date <span>*</span></span><input required className="payment-form-input" type="date" value={form.paymentDate} onChange={(event) => setForm((current) => ({ ...current, paymentDate: event.target.value }))} /></label>
          <div className="payment-form-field payment-form-field--wide"><span className="payment-form-label">Payment method <span>*</span></span><CustomDropdown label="" ariaLabel="Select payment method" value={form.paymentMethod} options={paymentMethods.map((method) => ({ value: method, label: method }))} onChange={(value) => setForm((current) => ({ ...current, paymentMethod: value as PaymentMethod }))} /></div>
          <label className="payment-form-field payment-form-field--wide"><span className="payment-form-label">Notes <span className="payment-form-optional">Optional</span></span><textarea className="payment-form-input payment-form-notes" rows={3} maxLength={1000} placeholder="Add any reference or additional details…" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
          <footer className="payment-form-actions"><button type="button" className="payment-cancel-button" onClick={closePaymentModal} disabled={saving}>Cancel</button><button type="submit" className="payments-create-button" disabled={saving || !formOptions.customers.length || !formOptions.exhibitions.length}>{saving ? 'Saving…' : 'Record payment'}</button></footer>
        </form>}
      </section>
    </div>}
  </section>;
}

export default PaymentsScreen;
