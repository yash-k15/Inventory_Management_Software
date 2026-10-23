export type OrderStatus =
  | 'Confirmed'
  | 'On Hold'
  | 'Manufacturing'
  | 'Ready'
  | 'Sent'
  | 'Completed'
  | 'Cancelled';

export type OrderStatusFilter = OrderStatus | 'All';

export interface OrderRow {
  id: number;
  customerName: string;
  contactName: string | null;
  city: string | null;
  exhibitionName: string | null;
  exhibitionStartDate: string | null;
  itemCount: number;
  orderDate: string;
  totalValuePaise: number;
  paymentReceivedPaise: number;
  paymentPendingPaise: number;
  status: OrderStatus;
}

export interface OrdersSummary {
  confirmedCount: number;
  confirmedValuePaise: number;
  exhibitionOrderCount: number;
  directOrderCount: number;
  provisionalItemCount: number;
  provisionalCustomerCount: number;
}
