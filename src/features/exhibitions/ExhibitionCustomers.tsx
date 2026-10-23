import { useEffect, useState } from 'react';
import { getExhibitionCustomers, type ExhibitionCustomerRow } from './exhibition.customers.queries';
import CustomerPickerModal from './CustomerPickerModal';
import './ExhibitionCustomers.css';

type Notice = { error: boolean; text: string } | null;

export default function ExhibitionCustomers({ exhibitionId, onOpenSelection }: { exhibitionId: number; onOpenSelection: (customerId: number) => void }) {
  const [customers, setCustomers] = useState<ExhibitionCustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => { let alive = true; setLoading(true); void getExhibitionCustomers(exhibitionId, search).then((rows) => { if (alive) setCustomers(rows); }).catch((error) => { if (alive) setNotice({ error: true, text: error instanceof Error ? error.message : 'Unable to load exhibition customers.' }); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [exhibitionId, search]);

  const visible = customers;

  async function handleCustomerAdded(customer: { id: number; businessName: string }) {
    setCustomers(await getExhibitionCustomers(exhibitionId, search));
    setNotice({ error: false, text: `${customer.businessName} added to this exhibition.` });
  }

  return <section className='exhibition-customers'>
    <div className='exhibition-customers-toolbar'>
      <label className='exhibition-customers-search'><span aria-hidden='true'>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder='Search attendees by name or phone…' aria-label='Search attendees by name or phone' /></label>
      <button type='button' className='exhibition-overview-primary exhibition-customers-add' onClick={() => setAddOpen(true)}>＋ Add customer</button>
    </div>
    {notice && <div className={`exhibition-customers-notice ${notice.error?'is-error':'is-success'}`} role={notice.error?'alert':'status'}><span>{notice.text}</span><button type='button' onClick={() => setNotice(null)} aria-label='Dismiss message'>×</button></div>}
    <div className='exhibition-customers-table-card'>
      <div className='exhibition-customers-table-scroll'><table className='exhibition-customers-table'>
        <thead><tr><th>Customer</th><th>City</th><th>Selections</th><th>Order created</th><th>Selected items</th><th>Orders</th><th><span className='sr-only'>Action</span></th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan={7} className='exhibition-customers-empty'>Loading customers…</td></tr> :
          visible.length === 0 ? <tr><td colSpan={7} className='exhibition-customers-empty'>{search.trim()?'No attendees match your search.':'No customers in this exhibition yet.'}</td></tr> :
          visible.map(customer => <CustomerRow key={customer.id} customer={customer} onOpen={() => onOpenSelection(customer.id)} />)}
        </tbody>
      </table></div>
      <footer className='exhibition-customers-footer'>Showing {visible.length} {visible.length===1?'attendee':'attendees'}. “Open selection” goes to the Selections tab with this customer chosen.</footer>
    </div>
    {addOpen && <CustomerPickerModal exhibitionId={exhibitionId} onClose={() => setAddOpen(false)} onAdded={async (customer) => { await handleCustomerAdded(customer); setAddOpen(false); }} />}
  </section>;
}

function CustomerRow({ customer, onOpen }: { customer: ExhibitionCustomerRow; onOpen: () => void }) {
  const initials = (customer.contactName || customer.businessName).trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
  return <tr>
    <td><div className='exhibition-customers-person'><span className='exhibition-customers-avatar'>{initials || '•'}</span><span><strong>{customer.businessName}</strong><small>{customer.contactName || 'Contact not specified'}{customer.phone ? ` · ${customer.phone}` : ''}</small></span></div></td>
    <td>{customer.city?.trim() || '—'}</td>
    <td><span className={`exhibition-customers-count ${customer.activeItemCount===0?'is-zero':''}`}>{customer.activeItemCount} selected</span></td>
    <td><span className={`exhibition-customers-count ${customer.orderCreatedItemCount===0?'is-zero':''}`}>{customer.orderCreatedItemCount} items</span></td>
    <td>{customer.itemNumbers.length ? <div className='exhibition-customers-item-chips'>{customer.itemNumbers.map(item=><span key={item}>{item}</span>)}{customer.activeItemCount>customer.itemNumbers.length&&<span>+{customer.activeItemCount-customer.itemNumbers.length}</span>}</div> : <span className='exhibition-customers-no-selection'>No selections yet</span>}</td>
    <td>{customer.orderNumbers.length ? <div className='exhibition-customers-item-chips'>{customer.orderNumbers.slice(0, 3).map(order => <span key={order}>{order}</span>)}{customer.orderNumbers.length > 3 && <span>+{customer.orderNumbers.length - 3}</span>}</div> : <span className='exhibition-customers-no-selection'>—</span>}</td>
    <td className='exhibition-customers-action'><button type='button' className='exhibition-customers-open' onClick={onOpen}>{customer.activeItemCount ? 'Open selection' : 'Start selection'}</button></td>
  </tr>;
}
