export type ExhibitionStatus = 'Planned' | 'Active' | 'Closed';
export type ExhibitionStatusFilter = 'all' | 'upcoming' | 'active' | 'past';

export interface ExhibitionFilters {
  search: string;
  status: ExhibitionStatusFilter;
}

export interface Exhibition {
  id: number;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  status: ExhibitionStatus;
  totalDays: number;
  customersAttended: number;
  customersWithSelections: number;
  totalSelections: number;
  distinctItems: number;
  registeredItems: number;
}

export interface ExhibitionCategoryCount {
  exhibitionId: number;
  categoryId: number;
  categoryName: string;
  itemCount: number;
}

export interface ExhibitionInput {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  notes: string;
}
