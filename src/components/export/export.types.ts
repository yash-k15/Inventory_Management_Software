export type ExportFormat = 'xlsx' | 'csv' | 'pdf' | 'print';
export type ExportScope = 'filtered' | 'all';

export type ExportColumn<T> = {
  key: string;
  label: string;
  defaultVisible?: boolean;
  value: (row: T) => string | number | boolean | null | undefined;
  /** Optional aggregate used when the export includes a totals row. */
  total?: (rows: T[]) => string | number | null | undefined;
};

export type ExportConfiguration<T> = {
  title: string;
  filename: string;
  columns: ExportColumn<T>[];
  filteredRows: T[];
  getAllRows: () => Promise<T[]>;
};
