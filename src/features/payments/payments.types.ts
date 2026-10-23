export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'UPI' | 'Cheque' | 'Other';

export interface PaymentRow {
  id: number;
  orderId: number | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string;
  exhibitionId: number | null;
  exhibitionName: string | null;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PaymentOrderOption {
  id: number;
  orderNumber: string;
  customerName: string;
  exhibitionName: string | null;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  sourceLabel: string;
}

export interface PaymentFormOptions { orders: PaymentOrderOption[]; }

export interface PaymentSummary {
  totalReceivedPaise: number;
  totalOutstandingPaise: number;
  transactionCount: number;
}

export interface CreatePaymentInput {
  orderId: number;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  notes: string;
}
