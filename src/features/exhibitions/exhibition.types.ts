export type ExhibitionStatus = 'Planned' | 'Active' | 'Closed';
export type ExhibitionFilter = 'all' | 'upcoming' | 'active' | 'past';

export interface ExhibitionCategoryCount {
  categoryId: number;
  categoryName: string;
  itemCount: number;
  uniqueSelectedItems: number;
  totalSelections: number;
}

export interface Exhibition {
  id: number;
  name: string;
  location: string | null;
  startDate: string;
  endDate: string;
  notes: string | null;
  status: ExhibitionStatus;
  totalDays: number;
  registeredItems: number;
  categories: ExhibitionCategoryCount[];
  customersAttended: number;
  customersWithSelections: number;
  totalSelections: number;
  distinctSelectedItems: number;
}

export interface ExhibitionInput {
  name: string;
  location: string;
  startDate: string;
  endDate: string;
  notes: string;
}

export interface ExhibitionFilters {
  search: string;
  status: ExhibitionFilter;
}


export interface SharedInterestItem {
  itemId: number;
  itemNumber: string;
  imagePath: string | null;
  categoryName: string;
  customerCount: number;
  customerNames: string[];
}
