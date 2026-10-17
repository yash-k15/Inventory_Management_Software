export type PaymentMethod =
  | 'Cash'
  | 'Bank Transfer'
  | 'UPI'
  | 'Cheque'
  | 'Other';

export interface PaymentRow {
  id: number;
  customerId: number | null;
  customerName: string;
  exhibitionId: number;
  exhibitionName: string;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PaymentCustomerOption {
  id: number;
  name: string;
}

export interface PaymentExhibitionOption {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}

export interface PaymentFormOptions {
  customers: PaymentCustomerOption[];
  exhibitions: PaymentExhibitionOption[];
}

export interface PaymentSummary {
  totalReceivedPaise: number;
  totalOutstandingPaise: number;
  transactionCount: number;
}

export interface CreatePaymentInput {
  customerId: number;
  exhibitionId: number;
  amountPaise: number;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  notes: string;
}
