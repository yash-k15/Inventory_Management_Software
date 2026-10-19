export type CustomerArchiveFilter = 'active' | 'archived' | 'all';

export interface CustomerFilters {
  search: string;
  archiveStatus: CustomerArchiveFilter;
}

export interface Customer {
  id: number;
  businessName: string;
  notes: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  isArchived: number;
  createdAt: string;
  updatedAt: string;
  primaryContactName: string | null;
  primaryContactPhone1: string | null;
  primaryContactPhone2: string | null;
  contactCount: number;
  orderCount: number;
  lifetimeValuePaise: number;
  lastPurchaseDate: string | null;
}

export interface CustomerContact {
  id: number;
  customerId: number;
  name: string;
  phone1: string | null;
  phone2: string | null;
  isPrimary: number;
  notes: string | null;
}

export interface CustomerOrderHistoryRow {
  id: number;
  orderDate: string;
  status: string;
  exhibitionName: string | null;
  itemCount: number;
  totalValuePaise: number;
}

export interface CustomerPaymentHistoryRow {
  id: number;
  paymentDate: string;
  exhibitionName: string;
  amountPaise: number;
  paymentMethod: string | null;
  notes: string | null;
}

export interface CustomerDetailsSummary {
  purchaseCount: number;
  lifetimeValuePaise: number;
  averageOrderValuePaise: number;
  lastPurchaseDate: string | null;
}

export interface CustomerRecentPurchase {
  orderItemId: number;
  itemNumber: string;
  itemName: string;
  amountPaise: number;
  orderDate: string;
}
