import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getOrderDetails, type OrderDetails, type OrderDetailItem } from './orders.queries';
import './OrderDetailsScreen.css';

interface Props { orderId: number; onBack: () => void; }
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatMoney = (paise: number | null | undefined) => paise == null || !Number.isFinite(Number(paise)) ? '—' : money.format(Number(paise) / 100);
const formatNumber = (value: unknown, digits = 3) => value == null || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
const orderNumber = (id: number) => `ORD-${String(id).padStart(4, '0')}`;
const safeArray = (value: unknown): Record<string, any>[] => Array.isArray(value) ? value.filter((entry) => entry && typeof entry === 'object') : [];
const getNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const pricingAvailable = (item: OrderDetailItem) => item.pricingBreakdown?.breakdown_available !== false && item.pricingBreakdown?.source !== 'direct' && typeof item.pricingBreakdown?.calculated_total_paise === 'number';

function snapshotPieces(item: OrderDetailItem, kind: 'diamond' | 'stone', line: Record<string, any>): number | null {
  if (typeof line.pieces === 'number') return line.pieces;
  if (typeof line.piece_count === 'number') return line.piece_count;
  const snapshot = item.itemSnapshot ?? {};
  const source = safeArray(kind === 'diamond' ? snapshot.diamonds : snapshot.stones);
  const match = source.find((entry) => kind === 'diamond'
    ? String(entry.shape ?? '') === String(line.shape ?? '')
      && String(entry.quality ?? '') === String(line.quality ?? '')
    : String(entry.stone ?? '') === String(line.stone ?? ''));
  const pieces = match?.pieces;
  return pieces == null || pieces === '' || !Number.isFinite(Number(pieces)) ? null : Number(pieces);
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <div className="od-breakdown-line"><span>{label}</span><strong>{value}</strong></div>;
}
function BreakdownTable({ title, headers, rows }: { title: string; headers: string[]; rows: (string | number)[][] }) {
  return <div className="od-breakdown-table-block"><h4>{title}</h4>{rows.length ? <div className="od-breakdown-table-scroll"><table className="od-breakdown-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td className={cellIndex === row.length - 1 ? 'od-number' : ''} key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div> : <p className="od-empty-breakdown">No {title.toLowerCase()} recorded for this item.</p>}</div>;
}
function ItemPricingBreakdown({ item }: { item: OrderDetailItem }) {
  const breakdown = item.pricingBreakdown;
  if (!pricingAvailable(item)) return <div className="od-direct-note"><strong>Direct final amount</strong><p>This item was priced by entering the final amount. A calculated price breakdown was not saved, so the component values are shown as unavailable.</p><div className="od-breakdown-line od-breakdown-total"><span>Agreed item price</span><strong>{formatMoney(item.agreedPricePaise)}</strong></div></div>;
  const diamonds = safeArray(breakdown?.diamond_lines);
  const stones = safeArray(breakdown?.stone_lines);
  const rates = breakdown?.rates_snapshot ?? {};
  return <div className="od-breakdown-content">
    <div className="od-breakdown-grid">
      <div className="od-breakdown-group"><h4>Gold &amp; making</h4>
        <DetailLine label={`Net gold weight (${formatNumber(breakdown?.purity_percent_bp == null ? null : Number(breakdown.purity_percent_bp) / 100, 2)}% purity)`} value={`${formatNumber(breakdown?.net_gold_g)} g`} />
        <DetailLine label={`Gold rate${breakdown?.gold_rate_paise_per_g != null ? ` (${formatMoney(breakdown.gold_rate_paise_per_g)} / g)` : ''}`} value={formatMoney(breakdown?.gold_value_paise)} />
        <DetailLine label={breakdown?.wastage_mode === 'percent' ? `Wastage (${formatNumber((getNumber(rates.wastagePercentBp) / 100), 2)}%)` : 'Wastage'} value={formatMoney(breakdown?.wastage_value_paise)} />
        <DetailLine label="Gold & making total" value={formatMoney(getNumber(breakdown?.gold_value_paise) + getNumber(breakdown?.wastage_value_paise))} />
      </div>
      <div className="od-breakdown-group"><h4>Other charges</h4>
        <DetailLine label="Extra cost" value={formatMoney(breakdown?.extra_cost_paise)} />
        <DetailLine label="Certification" value={formatMoney(breakdown?.certification_value_paise)} />
        <DetailLine label="Subtotal before GST" value={formatMoney(breakdown?.subtotal_paise == null ? null : getNumber(breakdown.subtotal_paise))} />
        <DetailLine label={`GST${breakdown?.gst_rate_bp == null ? '' : ` (${formatNumber(getNumber(breakdown.gst_rate_bp) / 100, 2)}%)`}`} value={formatMoney(breakdown?.gst_value_paise)} />
      </div>
    </div>
    <BreakdownTable title="Diamonds" headers={['Shape / quality', 'Pieces', 'Weight', 'Rate / ct', 'Cost']} rows={[...diamonds.map((line) => [`${line.shape ?? 'Diamond'}${line.quality ? ` · ${line.quality}` : ''}`, snapshotPieces(item, 'diamond', line) ?? '—', `${formatNumber(line.weight_ct ?? (line.weightMilliCarats != null ? Number(line.weightMilliCarats) / 1000 : line.weightMilli != null ? Number(line.weightMilli) / 1000 : null))} ct`, formatMoney(line.rate_paise_per_ct == null ? null : getNumber(line.rate_paise_per_ct)), formatMoney(line.value_paise)] as (string | number)[]), ...(diamonds.length ? [['Total diamonds', diamonds.reduce((sum, line) => sum + getNumber(snapshotPieces(item, 'diamond', line)), 0) || '—', `${formatNumber(diamonds.reduce((sum, line) => sum + getNumber(line.weight_ct ?? (line.weightMilliCarats != null ? Number(line.weightMilliCarats) / 1000 : line.weightMilli != null ? Number(line.weightMilli) / 1000 : 0)), 0))} ct`, '—', formatMoney(diamonds.reduce((sum, line) => sum + getNumber(line.value_paise), 0))] as (string | number)[]] : [])]} />
    <BreakdownTable title="Stones" headers={['Stone type', 'Pieces', 'Weight', 'Rate / unit', 'Cost']} rows={[...stones.map((line) => [`${line.stone ?? 'Stone'}`, snapshotPieces(item, 'stone', line) ?? '—', `${formatNumber(line.weight ?? (line.weightMilli != null ? Number(line.weightMilli) / 1000 : null))} ${line.unit ?? line.weightUnit ?? 'ct'}`, formatMoney(line.rate_paise_per_unit == null ? null : getNumber(line.rate_paise_per_unit)), formatMoney(line.value_paise)] as (string | number)[]), ...(stones.length ? [['Total stones', stones.reduce((sum, line) => sum + getNumber(snapshotPieces(item, 'stone', line)), 0) || '—', `${formatNumber(stones.reduce((sum, line) => sum + getNumber(line.weight ?? (line.weightMilli != null ? Number(line.weightMilli) / 1000 : 0)), 0))} ${String(stones[0]?.unit ?? stones[0]?.weightUnit ?? 'ct')}`, '—', formatMoney(stones.reduce((sum, line) => sum + getNumber(line.value_paise), 0))] as (string | number)[]] : [])]} />
    <div className="od-breakdown-total-row"><span>Calculated item price</span><strong>{formatMoney(breakdown?.calculated_total_paise)}</strong><span>Agreed price</span><strong>{formatMoney(item.agreedPricePaise)}</strong></div>
  </div>;
}

function OrderPriceBreakdown({ items, totalValuePaise }: { items: OrderDetailItem[]; totalValuePaise: number }) {
  const calculatedItems = items.filter(pricingAvailable);
  const anyDirect = items.some((item) => !pricingAvailable(item));
  const sumField = (field: string) => calculatedItems.reduce((sum, item) => sum + getNumber(item.pricingBreakdown?.[field]), 0);
  const diamondTotals = new Map<string, { pieces: number; weight: number; value: number }>();
  const stoneTotals = new Map<string, { pieces: number; weight: number; value: number; unit: string }>();
  for (const item of calculatedItems) {
    for (const line of safeArray(item.pricingBreakdown?.diamond_lines)) {
      const key = `${line.shape ?? 'Diamond'}${line.quality ? ` · ${line.quality}` : ''}`;
      const current = diamondTotals.get(key) ?? { pieces: 0, weight: 0, value: 0 };
      current.pieces += getNumber(snapshotPieces(item, 'diamond', line)); current.weight += getNumber(line.weight_ct); current.value += getNumber(line.value_paise); diamondTotals.set(key, current);
    }
    for (const line of safeArray(item.pricingBreakdown?.stone_lines)) {
      const unit = String(line.unit ?? line.weightUnit ?? 'ct'); const key = `${line.stone ?? 'Stone'} (${unit})`;
      const current = stoneTotals.get(key) ?? { pieces: 0, weight: 0, value: 0, unit };
      current.pieces += getNumber(snapshotPieces(item, 'stone', line)); current.weight += getNumber(line.weight); current.value += getNumber(line.value_paise); stoneTotals.set(key, current);
    }
  }
  return <section className="order-detail-card od-order-breakdown"><div className="od-section-heading"><div><h2>Order price breakdown</h2><p>Uses the rate snapshots saved when each order item was created.</p></div></div>
    {anyDirect && <p className="od-breakdown-caveat">One or more items use a direct final amount. Their individual component breakdowns are unavailable and are excluded from the component totals below.</p>}
    <div className="od-breakdown-grid od-order-summary-grid">
      <div className="od-breakdown-group"><h4>Gold &amp; making</h4><DetailLine label="Gold" value={calculatedItems.length ? formatMoney(sumField('gold_value_paise')) : '—'} /><DetailLine label="Wastage" value={calculatedItems.length ? formatMoney(sumField('wastage_value_paise')) : '—'} /><DetailLine label="Gold & making total" value={calculatedItems.length ? formatMoney(sumField('gold_value_paise') + sumField('wastage_value_paise')) : '—'} /></div>
      <div className="od-breakdown-group"><h4>Other charges</h4><DetailLine label="Extra cost" value={calculatedItems.length ? formatMoney(sumField('extra_cost_paise')) : '—'} /><DetailLine label="Certification" value={calculatedItems.length ? formatMoney(sumField('certification_value_paise')) : '—'} /><DetailLine label="GST" value={calculatedItems.length ? formatMoney(sumField('gst_value_paise')) : '—'} /><DetailLine label="Other charges total" value={calculatedItems.length ? formatMoney(sumField('extra_cost_paise') + sumField('certification_value_paise') + sumField('gst_value_paise')) : '—'} /><DetailLine label="Calculated total (priced items)" value={calculatedItems.length ? formatMoney(sumField('calculated_total_paise')) : '—'} /></div>
    </div>
    <BreakdownTable title="Diamond totals by type / quality" headers={['Shape / quality', 'Pieces', 'Total weight', 'Total cost']} rows={[...[...diamondTotals.entries()].map(([name, line]) => [name, line.pieces ?? '—', `${formatNumber(line.weight)} ct`, formatMoney(line.value)] as (string | number)[]), ...(diamondTotals.size ? [['Total diamonds', [...diamondTotals.values()].reduce((sum, line) => sum + line.pieces, 0), `${formatNumber([...diamondTotals.values()].reduce((sum, line) => sum + line.weight, 0))} ct`, formatMoney([...diamondTotals.values()].reduce((sum, line) => sum + line.value, 0))] as (string | number)[]] : [])]} />
    <BreakdownTable title="Stone totals by type" headers={['Stone type', 'Pieces', 'Total weight', 'Total cost']} rows={[...[...stoneTotals.entries()].map(([name, line]) => [name, line.pieces ?? '—', `${formatNumber(line.weight)} ${line.unit}`, formatMoney(line.value)] as (string | number)[]), ...(stoneTotals.size ? [['Total stones', [...stoneTotals.values()].reduce((sum, line) => sum + line.pieces, 0), `${formatNumber([...stoneTotals.values()].reduce((sum, line) => sum + line.weight, 0))} ${[...stoneTotals.values()][0].unit}`, formatMoney([...stoneTotals.values()].reduce((sum, line) => sum + line.value, 0))] as (string | number)[]] : [])]} />
    <div className="od-order-total"><span>Final order value</span><strong>{formatMoney(totalValuePaise)}</strong></div>
  </section>;
}

export default function OrderDetailsScreen({ orderId, onBack }: Props) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setExpandedItems([]);
    getOrderDetails(orderId).then((result) => {
      if (!cancelled) { setOrder(result); if (!result) setError('This order could not be found.'); }
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
      <p>{order.customerName} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'} · {isDirect ? 'created directly' : 'from exhibition selections'} · Created {formatDate(order.createdAt)}</p>
    </header>
    <div className="od-context-grid">
      <section className="order-detail-card od-context-card"><span className="od-context-label">CUSTOMER</span><strong>{order.customerName}</strong><p>{[order.contactName, order.phone].filter(Boolean).join(' · ') || 'Contact details unavailable'}</p>{order.city && <p>{order.city}</p>}</section>
      <section className="order-detail-card od-context-card"><span className="od-context-label">{isDirect ? 'ORDER TYPE' : 'EXHIBITION'}</span><strong>{isDirect ? 'Direct order' : order.exhibitionName || 'Exhibition'}</strong>{!isDirect && <p>{[order.exhibitionStartDate && formatDate(order.exhibitionStartDate), order.exhibitionEndDate && formatDate(order.exhibitionEndDate)].filter(Boolean).join(' – ')}</p>}<p>Confirmed: {formatDate(order.confirmedAt)}</p></section>
      <section className="order-detail-card od-context-card"><span className="od-context-label">PAYMENTS</span><strong>{formatMoney(order.paymentReceivedPaise)} received</strong><p>{formatMoney(order.paymentPendingPaise)} outstanding</p></section>
      <section className="order-detail-card od-context-card"><span className="od-context-label">RECORD</span><strong>{orderNumber(order.id)}</strong><p>Created {formatDate(order.createdAt)}</p><p>{isDirect ? 'Direct order' : 'Exhibition selections'}</p></section>
    </div>
    <section className="order-detail-card od-items-section"><div className="od-section-heading"><div><h2>Jewelry items</h2><p>Select an item to view its saved pricing calculation.</p></div><strong className="od-item-count">{order.items.length} {order.items.length === 1 ? 'item' : 'items'}</strong></div>
      <div className="od-item-list">{order.items.map((item) => {
        const expanded = expandedItems.includes(item.id);
        const snapshot = item.itemSnapshot ?? {};
        const imagePath = item.imageUrl || (typeof snapshot.image_path === 'string' && snapshot.image_path.trim() ? snapshot.image_path : null);
        const imageSrc = imagePath
          ? (/^(https?:|data:|blob:)/i.test(imagePath) ? imagePath : convertFileSrc(imagePath))
          : null;
        const diamonds = safeArray(snapshot.diamonds);
        const stones = safeArray(snapshot.stones);
        const goldWeight = item.grossWeightMilli == null ? '—' : `${formatNumber(item.grossWeightMilli / 1000)} g`;
        const netWeightValue = item.netWeightMilli ?? (snapshot.net_weight_milli == null ? (snapshot.netWeightMilli == null ? null : Number(snapshot.netWeightMilli)) : Number(snapshot.net_weight_milli));
        const netWeight = netWeightValue == null ? '—' : `${formatNumber(netWeightValue / 1000)} g`;
        const diamondSummary = diamonds.length ? `${diamonds.length} type${diamonds.length === 1 ? '' : 's'} · ${formatNumber(diamonds.reduce((sum, diamond) => sum + (Number(diamond.weightMilliCarats ?? diamond.weightMilli) || 0), 0) / 1000)} ct` : '—';
        const stoneSummary = stones.length ? `${stones.length} type${stones.length === 1 ? '' : 's'} · ${formatNumber(stones.reduce((sum, stone) => sum + (Number(stone.weightMilli) || 0), 0) / 1000)} ${String(stones[0]?.weightUnit ?? 'ct')}` : '—';
        const details = [diamonds.length ? `${diamonds.length} diamond type${diamonds.length === 1 ? '' : 's'}` : '', stones.length ? `${stones.length} stone type${stones.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || item.details;
        return <article className={`od-item-card ${expanded ? 'od-item-card--expanded' : ''}`} key={item.id}>
          <button type="button" className="od-item-summary" aria-expanded={expanded} onClick={() => setExpandedItems((current) => expanded ? current.filter((id) => id !== item.id) : [...current, item.id])}>
            {imageSrc ? <img className="od-item-image" src={imageSrc} alt={item.itemNumber} onError={(event) => { const placeholder = document.createElement('span'); placeholder.className = 'od-item-image od-item-image--placeholder'; placeholder.textContent = '◇'; event.currentTarget.replaceWith(placeholder); }} /> : <span className="od-item-image od-item-image--placeholder">◇</span>}
            <span className="od-item-main"><strong>{item.itemNumber}</strong><span>{item.category}{snapshot.name ? ` · ${String(snapshot.name)}` : ''}</span><small>{details}</small></span>
            <span className="od-item-weight"><small>Gross wt.</small><strong>{goldWeight}</strong></span><span className="od-item-weight"><small>Net wt.</small><strong>{netWeight}</strong></span><span className="od-item-material"><small>Diamonds</small><strong>{diamondSummary}</strong></span><span className="od-item-material"><small>Stones</small><strong>{stoneSummary}</strong></span>
            <span className="od-item-price"><small>Agreed price</small><strong>{formatMoney(item.agreedPricePaise)}</strong></span><span className={`od-expand-icon ${expanded ? 'od-expand-icon--open' : ''}`}>⌄</span>
          </button>
          {expanded && <div className="od-item-expanded"><ItemPricingBreakdown item={item} /></div>}
        </article>;
      })}</div>
      <div className="od-items-total"><span>Order value</span><strong>{formatMoney(order.totalValuePaise)}</strong></div>
    </section>
    <OrderPriceBreakdown items={order.items} totalValuePaise={order.totalValuePaise} />
    {order.notes && <section className="order-detail-card od-notes-card"><h2>Notes</h2><p>{order.notes}</p></section>}
  </section>;
}
