import type { ExportColumn } from '../../components/export/export.types';
import type { OrderRow } from './orders.types';

const money = (paise: number | null | undefined) =>
  paise == null
    ? ''
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(paise / 100);

const date = (value: string | null | undefined) => {
  if (!value) return '';
  const parsed = new Date(value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
};

const orderNumber = (id: number) => `ORD-${String(id).padStart(4, '0')}`;

export const ORDER_EXPORT_COLUMNS: ExportColumn<OrderRow>[] = [
  { key: 'orderNumber', label: 'Order number', value: (order) => orderNumber(order.id) },
  { key: 'customerName', label: 'Customer', value: (order) => order.customerName },
  { key: 'contactName', label: 'Contact name', value: (order) => order.contactName },
  { key: 'city', label: 'City', value: (order) => order.city },
  { key: 'source', label: 'Exhibition / source', value: (order) => order.exhibitionName ?? 'Direct order' },
  { key: 'itemCount', label: 'Items', value: (order) => order.itemCount },
  { key: 'orderDate', label: 'Order date', value: (order) => date(order.orderDate) },
  { key: 'totalValue', label: 'Order value', value: (order) => money(order.totalValuePaise) },
  { key: 'paymentReceived', label: 'Payment received', value: (order) => money(order.paymentReceivedPaise) },
  { key: 'paymentPending', label: 'Payment pending', value: (order) => money(order.paymentPendingPaise) },
  { key: 'status', label: 'Status', value: (order) => order.status },
];
