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
