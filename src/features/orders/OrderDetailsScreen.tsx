import { useEffect, useState } from 'react';
import { getOrderDetails, type OrderDetails } from './orders.queries';
import './OrderDetailsScreen.css';

interface Props { orderId: number; onBack: () => void; }
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (paise: number) => money.format(paise / 100);
function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
const orderNumber = (id: number) => `ORD-${String(id).padStart(4, '0')}`;

export default function OrderDetailsScreen({ orderId, onBack }: Props) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    getOrderDetails(orderId).then((result) => {
      if (!cancelled) {
        setOrder(result);
        if (!result) setError('This order could not be found.');
      }
    }).catch((err: unknown) => {
      console.error('Failed to load order details:', err);
      if (!cancelled) setError('Could not load order details. Please try again.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderId]);

  if (loading) return <section className="order-details-screen"><button className="order-details-back" onClick={onBack}>← Orders</button><p className="order-details-message">Loading order details…</p></section>;
  if (!order) return <section className="order-details-screen"><button className="order-details-back" onClick={onBack}>← Orders</button><p className="order-details-message" role="alert">{error || 'Order not found.'}</p></section>;
  const isDirect = order.exhibitionId === null;
  return <section className="order-details-screen">
    <button type="button" className="order-details-back" onClick={onBack}>← Orders</button>
    <header className="order-details-heading">
      <div className="order-details-title-row"><h1>{orderNumber(order.id)}</h1><span className={`order-detail-badge order-detail-status order-detail-status--${order.status.toLowerCase().replace(/ /g, '-')}`}>{order.status}</span><span className={`order-detail-badge ${isDirect ? 'order-detail-source--direct' : 'order-detail-source--exhibition'}`}>{isDirect ? 'Direct' : 'Exhibition'}</span></div>
      <p>{order.customerName} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'} · {isDirect ? 'created directly' : 'from exhibition selections'}</p>
    </header>
    <div className="order-details-layout">
      <div className="order-details-main-column">
        <section className="order-detail-card order-detail-items-card">
          <h2>Jewelry items</h2>
          <div className="order-detail-table-wrap"><table className="order-detail-items-table"><thead><tr><th>Item</th><th>Category</th><th>Gross wt.</th><th>Details</th><th className="order-detail-number">Value</th></tr></thead><tbody>
            {order.items.map(item => <tr key={item.id}><td><span className="order-detail-item-icon">◇</span><strong>{item.itemNumber}</strong></td><td>{item.category}</td><td>{item.grossWeightMilli == null ? '—' : `${(item.grossWeightMilli / 1000).toFixed(3)} g`}</td><td>{item.details}</td><td className="order-detail-number order-detail-price">{formatMoney(item.agreedPricePaise)}</td></tr>)}
          </tbody><tfoot><tr><th colSpan={4}>Order value</th><th className="order-detail-number">{formatMoney(order.totalValuePaise)}</th></tr></tfoot></table></div>
        </section>
        <div className={`order-detail-payment-note ${isDirect ? 'order-detail-payment-note--direct' : ''}`}>
          {isDirect ? <><strong>Payment tracking for direct orders is not defined yet.</strong> Payments belong to a customer and an exhibition, and this order has no exhibition. Needs a business-rule decision.</> : <><strong>Payments are not tracked per order.</strong> They are recorded for this customer at the exhibition level. <span className="order-detail-payment-link">View payments for {order.customerName}{order.exhibitionName ? ` · ${order.exhibitionName}` : ''}</span></>}
        </div>
      </div>
      <aside className="order-details-side-column">
        <section className="order-detail-card"><h2>Customer</h2><strong className="order-detail-card-primary">{order.customerName}</strong><p>{[order.contactName, order.phone].filter(Boolean).join(' · ') || 'Contact details unavailable'}</p>{order.city && <p>{order.city}</p>}<span className="order-detail-static-link">View customer →</span></section>
        <section className="order-detail-card"><h2>Exhibition</h2>{isDirect ? <><span className="order-detail-badge order-detail-source--direct">Direct order</span><p className="order-detail-card-muted">Not linked to any exhibition.</p></> : <><strong className="order-detail-card-primary">{order.exhibitionName || 'Exhibition'}</strong><p>{[order.exhibitionStartDate && formatDate(order.exhibitionStartDate), order.exhibitionEndDate && formatDate(order.exhibitionEndDate)].filter(Boolean).join(' – ')}</p><span className="order-detail-static-link">Open exhibition →</span></>}</section>
        <section className="order-detail-card"><h2>Record</h2><div className="order-detail-record-row"><span>Created</span><span>{formatDate(order.createdAt)}</span></div><div className="order-detail-record-row"><span>Confirmed</span><span>{formatDate(order.confirmedAt)}</span></div><div className="order-detail-record-row"><span>Source</span><span>{isDirect ? 'Direct order' : 'Exhibition selections'}</span></div></section>
        {order.notes && <section className="order-detail-card"><h2>Notes</h2><p className="order-detail-notes">{order.notes}</p></section>}
      </aside>
    </div>
  </section>;
}
