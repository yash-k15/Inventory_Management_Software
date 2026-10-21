import { useEffect, useState } from 'react';
import {
  addCustomerToSelectionExhibition,
  searchAvailableSelectionCustomers,
  type AvailableSelectionCustomer,
} from './selection.queries';
import { createExhibitionCustomer, findDuplicateExhibitionCustomer } from './exhibition.customers.queries';
import './CustomerPickerModal.css';

type Props = {
  exhibitionId: number;
  onClose: () => void;
  onAdded: (customer: AvailableSelectionCustomer) => void | Promise<void>;
};

export default function CustomerPickerModal({ exhibitionId, onClose, onAdded }: Props) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<AvailableSelectionCustomer[]>([]);
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (mode !== 'existing') return;
    void searchAvailableSelectionCustomers(exhibitionId, search)
      .then((rows) => { if (alive) setCustomers(rows); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Unable to search customers.'); });
    return () => { alive = false; };
  }, [exhibitionId, mode, search]);

  async function addExisting(customer: AvailableSelectionCustomer) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await addCustomerToSelectionExhibition(exhibitionId, customer.id);
      await onAdded(customer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to add customer.');
    } finally {
      setSaving(false);
    }
  }

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessName.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const duplicate = await findDuplicateExhibitionCustomer({ businessName, phone });
      if (duplicate) {
        const sameName = duplicate.businessName.trim().toLocaleLowerCase() === businessName.trim().toLocaleLowerCase();
        const message = sameName
          ? `A customer named "${duplicate.businessName}" already exists. Switch to Existing customer and search for it instead.`
          : `This phone number is already associated with "${duplicate.businessName}". Switch to Existing customer and search for that customer instead.`;
        setError(message);
        return;
      }
      const id = await createExhibitionCustomer({ businessName, contactName, phone, city });
      await addCustomerToSelectionExhibition(exhibitionId, id);
      await onAdded({ id, businessName: businessName.trim(), contactName: contactName.trim() || null, phone: phone.trim() || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create and add customer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="customer-picker-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <section className="customer-picker-modal" role="dialog" aria-modal="true" aria-labelledby="customer-picker-title">
        <header className="customer-picker-header">
          <div><span className="customer-picker-eyebrow">EXHIBITION CUSTOMERS</span><h2 id="customer-picker-title">Add customer</h2><p>Choose an existing customer or create a new record.</p></div>
          <button type="button" className="customer-picker-close" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </header>
        <div className="customer-picker-tabs">
          <button type="button" className={mode === 'existing' ? 'is-active' : ''} onClick={() => { setMode('existing'); setError(null); }}>Existing customer</button>
          <button type="button" className={mode === 'new' ? 'is-active' : ''} onClick={() => { setMode('new'); setError(null); }}>New customer</button>
        </div>
        {error && <p className="customer-picker-error" role="alert">{error}</p>}
        {mode === 'existing' ? (
          <div className="customer-picker-existing">
            <label className="customer-picker-search"><span aria-hidden="true">⌕</span><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by business, contact, or phone…" /><span className="sr-only">Search customers</span></label>
            <div className="customer-picker-results">
              {customers.length === 0 ? <p className="customer-picker-muted">{search.trim() ? 'No matching customers available.' : 'All existing customers are already added to this exhibition.'}</p> :
                customers.map((customer) => <div className="customer-picker-row" key={customer.id}><span className="customer-picker-avatar">{customer.businessName.slice(0, 1).toUpperCase()}</span><span className="customer-picker-copy"><strong>{customer.businessName}</strong><small>{[customer.contactName, customer.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></span><button type="button" className="customer-picker-button" disabled={saving} onClick={() => void addExisting(customer)}>{saving ? 'Adding…' : 'Add'}</button></div>)}
            </div>
          </div>
        ) : (
          <form className="customer-picker-form" onSubmit={createCustomer}>
            <label>Business name <span>*</span><input autoFocus required value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></label>
            <label>Contact name<input value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
            <label>Phone number<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
            <footer><button type="button" className="customer-picker-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="customer-picker-button customer-picker-button--primary" disabled={!businessName.trim() || saving}>{saving ? 'Saving…' : 'Create & add customer'}</button></footer>
          </form>
        )}
      </section>
    </div>
  );
}
