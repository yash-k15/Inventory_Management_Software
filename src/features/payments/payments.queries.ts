import { getDatabase } from '../../db';
import type { CreatePaymentInput, PaymentFormOptions, PaymentRow, PaymentSummary } from './payments.types';

export async function getPayments(): Promise<PaymentRow[]> {
  const db = await getDatabase();
  return db.select<PaymentRow[]>(`
    SELECT
      p.id,
      p.order_id AS orderId,
      CASE WHEN p.order_id IS NOT NULL THEN 'ORD-' || printf('%04d', p.order_id) ELSE NULL END AS orderNumber,
      p.customer_id AS customerId,
      p.customer_name_snapshot AS customerName,
      p.exhibition_id AS exhibitionId,
      e.name AS exhibitionName,
      p.amount_paise AS amountPaise,
      p.payment_date AS paymentDate,
      p.payment_method AS paymentMethod,
      p.notes,
      p.created_at AS createdAt
    FROM payment p
    LEFT JOIN exhibition e ON e.id = p.exhibition_id
    ORDER BY p.payment_date DESC, p.id DESC
  `);
}

export async function getPaymentFormOptions(): Promise<PaymentFormOptions> {
  const db = await getDatabase();
  const orders = await db.select<PaymentFormOptions['orders']>(`
    SELECT
      co.id,
      'ORD-' || printf('%04d', co.id) AS orderNumber,
      co.customer_name_snapshot AS customerName,
      e.name AS exhibitionName,
      co.final_total_paise AS totalPaise,
      COALESCE(vob.paid_paise, 0) AS paidPaise,
      COALESCE(vob.outstanding_paise, 0) AS outstandingPaise,
      CASE WHEN co.exhibition_id IS NULL THEN 'Direct order' ELSE e.name END AS sourceLabel
    FROM customer_order co
    LEFT JOIN exhibition e ON e.id = co.exhibition_id
    LEFT JOIN v_order_balance vob ON vob.order_id = co.id
    WHERE co.status <> 'Cancelled'
    ORDER BY co.created_at DESC, co.id DESC
  `);
  return { orders };
}

export async function getPaymentSummary(): Promise<PaymentSummary> {
  const db = await getDatabase();
  const [paymentTotals, balanceTotals] = await Promise.all([
    db.select<{ totalReceivedPaise: number; transactionCount: number }[]>(`
      SELECT COALESCE(SUM(amount_paise), 0) AS totalReceivedPaise, COUNT(*) AS transactionCount FROM payment
    `),
    db.select<{ totalOutstandingPaise: number }[]>(`
      SELECT COALESCE(SUM(outstanding_paise), 0) AS totalOutstandingPaise FROM v_order_balance WHERE status <> 'Cancelled'
    `),
  ]);
  return {
    totalReceivedPaise: paymentTotals[0]?.totalReceivedPaise ?? 0,
    transactionCount: paymentTotals[0]?.transactionCount ?? 0,
    totalOutstandingPaise: balanceTotals[0]?.totalOutstandingPaise ?? 0,
  };
}

export async function createPayment(input: CreatePaymentInput): Promise<void> {
  const orderId = Number(input.orderId);
  const amountPaise = Number(input.amountPaise);
  const paymentDate = input.paymentDate.trim();
  const paymentMethod = input.paymentMethod.trim();
  const notes = input.notes.trim();
  if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('Please select a valid order.');
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error('Payment amount must be greater than zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new Error('Please enter a valid payment date.');

  const db = await getDatabase();
  const rows = await db.select<{ id: number; customerId: number | null; customerName: string; exhibitionId: number | null; status: string }[]>(`
    SELECT id, customer_id AS customerId, customer_name_snapshot AS customerName, exhibition_id AS exhibitionId, status
    FROM customer_order WHERE id = ?
  `, [orderId]);
  const order = rows[0];
  if (!order) throw new Error('The selected order could not be found.');
  if (order.status === 'Cancelled') throw new Error('Payments cannot be recorded against a cancelled order.');

  await db.execute(`
    INSERT INTO payment (order_id, customer_id, customer_name_snapshot, exhibition_id, amount_paise, payment_date, payment_method, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [order.id, order.customerId, order.customerName, order.exhibitionId, amountPaise, paymentDate, paymentMethod || null, notes || null]);
}
