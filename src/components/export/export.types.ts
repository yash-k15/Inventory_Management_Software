export type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'print';
export type ExportScope = 'filtered' | 'all';

export type ExportColumn<T> = {
  key: string;
  label: string;
  defaultVisible?: boolean;
  value: (row: T) => string | number | boolean | null | undefined;
};

export type ExportConfiguration<T> = {
  title: string;
  filename: string;
  columns: ExportColumn<T>[];
  filteredRows: T[];
  getAllRows: () => Promise<T[]>;
};
