import type { ExportColumn } from '../../components/export/export.types';
import type { PaymentRow } from './payments.types';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(paise: number) {
  return currency.format(paise / 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export const PAYMENT_EXPORT_COLUMNS: ExportColumn<PaymentRow>[] = [
  { key: 'id', label: 'Payment ID', value: (payment) => payment.id },
  { key: 'paymentDate', label: 'Payment date', value: (payment) => formatDate(payment.paymentDate) },
  { key: 'orderNumber', label: 'Order', value: (payment) => payment.orderNumber ?? (payment.orderId ? `Order ${payment.orderId}` : 'Legacy payment') },
  { key: 'customerName', label: 'Customer', value: (payment) => payment.customerName || '' },
  { key: 'exhibitionName', label: 'Exhibition / source', value: (payment) => payment.exhibitionName ?? (payment.orderId ? 'Direct order' : 'Unallocated legacy payment') },
  { key: 'paymentMethod', label: 'Payment method', value: (payment) => payment.paymentMethod ?? 'Not specified' },
  { key: 'notes', label: 'Notes', value: (payment) => payment.notes ?? '' },
  {
    key: 'amount',
    label: 'Amount received',
    value: (payment) => formatMoney(payment.amountPaise),
    total: (payments) => formatMoney(payments.reduce((sum, payment) => sum + payment.amountPaise, 0)),
  },
];
