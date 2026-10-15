import { useEffect, useMemo, useState } from 'react';
import { createExhibitionCustomer, getExhibitionCustomers, type ExhibitionCustomerRow } from './exhibition.customers.queries';
import './ExhibitionCustomers.css';

type Filter = 'all' | 'with' | 'without';
type Notice = { error: boolean; text: string } | null;

export default function ExhibitionCustomers({ exhibitionId, onOpenSelection }: { exhibitionId: number; onOpenSelection: (customerId: number) => void }) {
  const [customers, setCustomers] = useState<ExhibitionCustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');

  async function load() {
    setLoading(true);
    try { setCustomers(await getExhibitionCustomers(exhibitionId, search)); }
    catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load exhibition customers.' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { let alive = true; setLoading(true); void getExhibitionCustomers(exhibitionId, search).then((rows) => { if (alive) setCustomers(rows); }).catch((error) => { if (alive) setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load exhibition customers.' }); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [exhibitionId, search]);

  const counts = useMemo(() => ({ all: customers.length, with: customers.filter(c => c.activeItemCount > 0).length, without: customers.filter(c => c.activeItemCount === 0).length }), [customers]);
  const visible = customers.filter(c => filter === 'all' || (filter === 'with' ? c.activeItemCount > 0 : c.activeItemCount === 0));

  async function saveCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessName.trim() || saving) return;
    setSaving(true);
    try {
      await createExhibitionCustomer({ businessName, contactName, phone, city });
      setAddOpen(false); setBusinessName(''); setContactName(''); setPhone(''); setCity('');
      setNotice({ error: false, text: 'Customer added.' });
      await load();
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to add customer.' }); }
    finally { setSaving(false); }
  }

  return <section className='exhibition-customers'>
    <div className='exhibition-customers-toolbar'>
      <label className='exhibition-customers-search'><span aria-hidden='true'>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search attendees by name or phone…' aria-label='Search attendees by name or phone' /></label>
      <div className='exhibition-customers-filters' aria-label='Filter attendees'>
        {([['all','All'],['with','With selections'],['without','No selections']] as [Filter,string][]).map(([key,label]) => <button type='button' key={key} className={`exhibition-customers-filter ${filter===key?'is-active':''}`} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>)}
      </div>
      <button type='button' className='exhibition-overview-primary exhibition-customers-add' onClick={() => setAddOpen(true)}>＋ Add customer</button>
    </div>
    {notice && <div className={`exhibition-customers-notice ${notice.error?'is-error':'is-success'}`} role={notice.error?'alert':'status'}><span>{notice.text}</span><button type='button' onClick={() => setNotice(null)} aria-label='Dismiss message'>×</button></div>}
    <div className='exhibition-customers-table-card'>
      <div className='exhibition-customers-table-scroll'><table className='exhibition-customers-table'>
        <thead><tr><th>Customer</th><th>City</th><th>Selections</th><th>Selected items</th><th><span className='sr-only'>Action</span></th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={5} className='exhibition-customers-empty'>Loading customers…</td></tr> :
          visible.length === 0 ? <tr><td colSpan={5} className='exhibition-customers-empty'>{search.trim()?'No attendees match your search.':'No customers in this filter yet.'}</td></tr> :
          visible.map(customer => <CustomerRow key={customer.id} customer={customer} onOpen={() => onOpenSelection(customer.id)} />)}
        </tbody>
      </table></div>
      <footer className='exhibition-customers-footer'>Showing {visible.length} of {customers.length} {customers.length===1?'attendee':'attendees'}. “Open selection” goes to the Selections tab with this customer chosen.</footer>
    </div>
    {addOpen && <div className='exhibition-customers-backdrop' onMouseDown={e => { if (e.target===e.currentTarget) setAddOpen(false); }}><form className='exhibition-customers-modal' role='dialog' aria-modal='true' aria-labelledby='exhibition-add-customer-title' onSubmit={saveCustomer}>
      <header><div><h2 id='exhibition-add-customer-title'>Add customer</h2><p>Create a customer record for this exhibition.</p></div><button type='button' onClick={() => setAddOpen(false)} aria-label='Close'>×</button></header>
      <label>Business name <span>*</span><input autoFocus required value={businessName} onChange={e=>setBusinessName(e.target.value)} /></label>
      <label>Contact name<input value={contactName} onChange={e=>setContactName(e.target.value)} /></label>
      <label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} /></label>
      <label>City<input value={city} onChange={e=>setCity(e.target.value)} /></label>
      <footer><button type='button' className='exhibition-overview-secondary' onClick={() => setAddOpen(false)}>Cancel</button><button type='submit' className='exhibition-overview-primary' disabled={!businessName.trim()||saving}>{saving?'Saving…':'Add customer'}</button></footer>
    </form></div>}
  </section>;
}

function CustomerRow({ customer, onOpen }: { customer: ExhibitionCustomerRow; onOpen: () => void }) {
  const initials = (customer.contactName || customer.businessName).trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
  return <tr>
    <td><div className='exhibition-customers-person'><span className='exhibition-customers-avatar'>{initials || '•'}</span><span><strong>{customer.businessName}</strong><small>{customer.contactName || 'Contact not specified'}{customer.phone ? ` · ${customer.phone}` : ''}</small></span></div></td>
    <td>{customer.city?.trim() || '—'}</td>
    <td><span className={`exhibition-customers-count ${customer.activeItemCount===0?'is-zero':''}`}>{customer.activeItemCount} selected</span></td>
    <td>{customer.itemNumbers.length ? <div className='exhibition-customers-item-chips'>{customer.itemNumbers.map(item=><span key={item}>{item}</span>)}{customer.activeItemCount>customer.itemNumbers.length&&<span>+{customer.activeItemCount-customer.itemNumbers.length}</span>}</div> : <span className='exhibition-customers-no-selection'>No selections yet</span>}</td>
    <td className='exhibition-customers-action'><button type='button' className='exhibition-customers-open' onClick={onOpen}>{customer.activeItemCount ? 'Open selection' : 'Start selection'}</button></td>
  </tr>;
}
