import { getDatabase } from '../../db';
import type {
  CreatePaymentInput,
  PaymentFormOptions,
  PaymentRow,
  PaymentSummary,
} from './payments.types';

export async function getPayments(): Promise<PaymentRow[]> {
  const db = await getDatabase();

  return db.select<PaymentRow[]>(`
    SELECT
      p.id,
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
    JOIN exhibition e ON e.id = p.exhibition_id
    ORDER BY p.payment_date DESC, p.id DESC
  `);
}

export async function getPaymentFormOptions(): Promise<PaymentFormOptions> {
  const db = await getDatabase();

  const [customers, exhibitions] = await Promise.all([
    db.select<PaymentFormOptions['customers']>(`
      SELECT id, business_name AS name
      FROM customer
      WHERE is_archived = 0
      ORDER BY business_name COLLATE NOCASE
    `),

    db.select<PaymentFormOptions['exhibitions']>(`
      SELECT
        id,
        name,
        start_date AS startDate,
        end_date AS endDate
      FROM exhibition
      ORDER BY start_date DESC, name COLLATE NOCASE
    `),
  ]);

  return { customers, exhibitions };
}

export async function getPaymentSummary(): Promise<PaymentSummary> {
  const db = await getDatabase();

  const [paymentTotals, balanceTotals] = await Promise.all([
    db.select<{ totalReceivedPaise: number; transactionCount: number }[]>(`
      SELECT
        COALESCE(SUM(amount_paise), 0) AS totalReceivedPaise,
        COUNT(*) AS transactionCount
      FROM payment
    `),

    db.select<{ totalOutstandingPaise: number }[]>(`
      SELECT COALESCE(SUM(outstanding_paise), 0) AS totalOutstandingPaise
      FROM v_customer_balance
    `),
  ]);

  return {
    totalReceivedPaise: paymentTotals[0]?.totalReceivedPaise ?? 0,
    transactionCount: paymentTotals[0]?.transactionCount ?? 0,
    totalOutstandingPaise: balanceTotals[0]?.totalOutstandingPaise ?? 0,
  };
}

export async function createPayment(input: CreatePaymentInput): Promise<void> {
  const customerId = Number(input.customerId);
  const exhibitionId = Number(input.exhibitionId);
  const amountPaise = Number(input.amountPaise);
  const paymentDate = input.paymentDate.trim();
  const paymentMethod = input.paymentMethod.trim();
  const notes = input.notes.trim();

  if (!Number.isInteger(customerId) || customerId <= 0) {
    throw new Error('Please select a valid customer.');
  }

  if (!Number.isInteger(exhibitionId) || exhibitionId <= 0) {
    throw new Error('Please select a valid exhibition.');
  }

  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw new Error('Please enter a valid payment date.');
  }

  const db = await getDatabase();

  const customers = await db.select<{ name: string }[]>(
    `
    SELECT business_name AS name
    FROM customer
    WHERE id = ? AND is_archived = 0
  `,
    [customerId],
  );

  if (!customers.length) {
    throw new Error('The selected customer is unavailable or archived.');
  }

  const exhibitions = await db.select<{ id: number }[]>(
    `
    SELECT id
    FROM exhibition
    WHERE id = ?
  `,
    [exhibitionId],
  );

  if (!exhibitions.length) {
    throw new Error('The selected exhibition could not be found.');
  }

  await db.execute(
    `
    INSERT INTO payment (
      customer_id,
      customer_name_snapshot,
      exhibition_id,
      amount_paise,
      payment_date,
      payment_method,
      notes
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    [
      customerId,
      customers[0].name,
      exhibitionId,
      amountPaise,
      paymentDate,
      paymentMethod || null,
      notes || null,
    ],
  );
}
