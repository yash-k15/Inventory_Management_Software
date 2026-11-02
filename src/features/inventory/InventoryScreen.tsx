import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import './InventoryScreen.css';
import JewelryTagPreview from '../tags/JewelryTagPreview';
import ExportDialog from '../../components/export/ExportDialog';
import { INVENTORY_EXPORT_COLUMNS } from './inventory.export';

import InventoryFilters, {
  getActiveInventoryFilterChips,
  INITIAL_INVENTORY_FILTERS,
} from './InventoryFilters';
import {
  getInventoryFilterOptions,
  getInventoryItems,
} from './inventory.queries';
import type {
  InventoryFilterOptions,
  InventoryFilters as InventoryFilterValues,
  InventoryItem,
  InventorySort,
  InventorySortField,
} from './inventory.types';

function formatWeight(weightMilli: number | null): string {
  if (weightMilli === null) return '—';
  return `${(weightMilli / 1000).toFixed(3)} g`;
}

function formatPurity(
  purityName: string | null,
  purityPercentBp: number | null,
): { name: string; percentage: string | null } {
  if (!purityName) return { name: '—', percentage: null };

  return {
    name: purityName,
    percentage:
      purityPercentBp !== null
        ? `${(purityPercentBp / 100).toFixed(2)}%`
        : null,
  };
}

type Props = {
  onAddItem: () => void;
  onViewItem: (itemId: number) => void;
};

function InventoryScreen({ onAddItem, onViewItem }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [previewImage, setPreviewImage] = useState<{
    itemId: number;
    url: string;
    left: number;
    top: number;
  } | null>(null);
  const [selectedTagItemIds, setSelectedTagItemIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [tagPreviewItems, setTagPreviewItems] = useState<
    InventoryItem[] | null
  >(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const [filterOptions, setFilterOptions] =
    useState<InventoryFilterOptions | null>(null);
  const [filters, setFilters] = useState<InventoryFilterValues>(
    INITIAL_INVENTORY_FILTERS,
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sort, setSort] = useState<InventorySort>({
    field: 'itemNumber',
    direction: 'asc',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageStartIndex = (currentPage - 1) * pageSize;
  const paginatedItems = items.slice(pageStartIndex, pageStartIndex + pageSize);
  const selectedTagItems = items.filter((item) =>
    selectedTagItemIds.has(item.id),
  );
  const allVisiblePageItemsSelected =
    paginatedItems.length > 0 &&
    paginatedItems.every((item) => selectedTagItemIds.has(item.id));
  const someVisiblePageItemsSelected = paginatedItems.some((item) =>
    selectedTagItemIds.has(item.id),
  );
  const firstVisibleItem = items.length === 0 ? 0 : pageStartIndex + 1;
  const lastVisibleItem = Math.min(pageStartIndex + pageSize, items.length);

  const sortMenuRef = useRef<HTMLDivElement>(null);
  const imagePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const clearImagePreviewTimer = () => {
    if (imagePreviewTimerRef.current !== null) {
      clearTimeout(imagePreviewTimerRef.current);
      imagePreviewTimerRef.current = null;
    }
  };

  const handleImageMouseEnter = (
    itemId: number,
    url: string,
    event: React.MouseEvent<HTMLImageElement>,
  ) => {
    clearImagePreviewTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    const previewWidth = Math.min(420, window.innerWidth - 32);
    const previewHeight = Math.min(560, window.innerHeight - 32);
    const left =
      rect.right + previewWidth + 16 <= window.innerWidth
        ? rect.right + 16
        : Math.max(16, rect.left - previewWidth - 16);
    const top = Math.min(
      Math.max(16, rect.top),
      Math.max(16, window.innerHeight - previewHeight - 16),
    );

    imagePreviewTimerRef.current = setTimeout(() => {
      setPreviewImage({ itemId, url, left, top });
      imagePreviewTimerRef.current = null;
    }, 1500);
  };

  const handleImageMouseLeave = () => {
    clearImagePreviewTimer();
    setPreviewImage(null);
  };

  useEffect(() => () => clearImagePreviewTimer(), []);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [inventoryItems, options] = await Promise.all([
        getInventoryItems(filters, sort),
        getInventoryFilterOptions(),
      ]);

      setItems(inventoryItems);
      setFilterOptions(options);
    } catch (err) {
      console.error('Failed to load inventory:', err);
      setError(
        'Unable to load inventory. Please check the database connection and try again.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [filters, sort]);

  useEffect(() => {
    let cancelled = false;

    async function loadItemImages() {
      const itemsWithImages = items.filter((item) => item.imagePath);

      if (itemsWithImages.length === 0) {
        setImageUrls({});
        return;
      }

      try {
        const dataDirectory = await appDataDir();

        const entries = await Promise.all(
          itemsWithImages.map(async (item) => {
            const imagePath = await join(dataDirectory, item.imagePath!);

            await invoke('allow_image_preview', { path: imagePath });

            return [item.id, convertFileSrc(imagePath)] as const;
          }),
        );

        if (!cancelled) {
          setImageUrls(Object.fromEntries(entries));
        }
      } catch (err) {
        console.error('Failed to load inventory images:', err);
      }
    }

    void loadItemImages();

    return () => {
      cancelled = true;
    };
  }, [items]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, sort]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!showSortMenu) return;

    function handleOutsideSortClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !sortMenuRef.current?.contains(event.target)
      ) {
        setShowSortMenu(false);
      }
    }

    function handleSortEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowSortMenu(false);
    }

    document.addEventListener('mousedown', handleOutsideSortClick);
    document.addEventListener('keydown', handleSortEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideSortClick);
      document.removeEventListener('keydown', handleSortEscape);
    };
  }, [showSortMenu]);

  const sortOptions: {
    label: string;
    field: InventorySortField | null;
    direction: 'asc' | 'desc';
  }[] = [
    { label: 'Default', field: null, direction: 'asc' },
    { label: 'Latest', field: 'recentlyAdded', direction: 'desc' },
    { label: 'Oldest', field: 'recentlyAdded', direction: 'asc' },
    { label: 'Least diamond pieces', field: 'diamondPieces', direction: 'asc' },
    { label: 'Most diamond pieces', field: 'diamondPieces', direction: 'desc' },
    { label: 'Least stone pieces', field: 'stonePieces', direction: 'asc' },
    { label: 'Most stone pieces', field: 'stonePieces', direction: 'desc' },
  ];

  const currentSortLabel =
    sortOptions.find((option) =>
      option.field === null
        ? sort.field === 'itemNumber' && sort.direction === 'asc'
        : option.field === sort.field && option.direction === sort.direction,
    )?.label ?? 'Custom sort';

  const applySortOption = (
    field: InventorySortField | null,
    direction: 'asc' | 'desc',
  ) => {
    setCurrentPage(1);
    setSort(
      field === null
        ? { field: 'itemNumber', direction: 'asc' }
        : { field, direction },
    );
    setShowSortMenu(false);
  };

  const handleColumnSort = (field: InventorySortField) => {
    setCurrentPage(1);
    setSort((current) => {
      if (current.field !== field) {
        return { field, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { field, direction: 'desc' };
      }

      return { field: 'itemNumber', direction: 'asc' };
    });
  };

  const getColumnSortIndicator = (field: InventorySortField) => {
    if (sort.field !== field) return '';
    return sort.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const updateFilter = <K extends keyof InventoryFilterValues>(
    key: K,
    value: InventoryFilterValues[K],
  ) => {
    setCurrentPage(1);
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateFilters = (patch: Partial<InventoryFilterValues>) => {
    setCurrentPage(1);
    setFilters((current) => ({
      ...current,
      ...patch,
    }));
  };

  const resetFilters = () => {
    setCurrentPage(1);
    setFilters({ ...INITIAL_INVENTORY_FILTERS });
  };

  const activeFilterChips = filterOptions
    ? getActiveInventoryFilterChips(filters, filterOptions)
    : [];

  const toggleTagItem = (itemId: number) => {
    setSelectedTagItemIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleAllVisiblePageTagItems = () => {
    setSelectedTagItemIds((current) => {
      const next = new Set(current);
      if (allVisiblePageItemsSelected) {
        paginatedItems.forEach((item) => next.delete(item.id));
      } else {
        paginatedItems.forEach((item) => next.add(item.id));
      }
      return next;
    });
  };

  const activeItemsCount = items.filter((item) => item.isArchived === 0).length;

  return (
    <div className='inventory-screen'>
      <header className='inventory-page-header'>
        <div>
          <h2 className='app-page-title'>Inventory</h2>
        </div>
      </header>

      <section className='inventory-toolbar' aria-label='Inventory actions'>
        <div className='inventory-toolbar-search'>
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <circle cx='11' cy='11' r='7' />
            <path d='m16 16 4 4' />
          </svg>
          <input
            type='search'
            aria-label='Search inventory'
            placeholder='Search item number or name...'
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </div>

        {filterOptions && (
          <InventoryFilters
            filters={filters}
            options={filterOptions}
            onApply={setFilters}
          />
        )}

        <div className='inventory-sort-menu' ref={sortMenuRef}>
          <button
            type='button'
            className='inventory-toolbar-button inventory-sort-button'
            aria-haspopup='dialog'
            aria-expanded={showSortMenu}
            title='Change inventory sorting'
            onClick={() => setShowSortMenu((current) => !current)}
          >
            <svg viewBox='0 0 24 24' aria-hidden='true'>
              <path d='M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0-4 4m4-4 4 4' />
            </svg>
            <span>Sort:</span>
            <strong>{currentSortLabel}</strong>
          </button>

          {showSortMenu && (
            <div
              className='inventory-sort-panel'
              role='dialog'
              aria-label='Sort inventory'
            >
              {sortOptions.map((option) => {
                const isActive =
                  option.field === null
                    ? sort.field === 'itemNumber' && sort.direction === 'asc'
                    : sort.field === option.field &&
                      sort.direction === option.direction;
                return (
                  <button
                    key={option.label}
                    type='button'
                    className={`inventory-sort-option${isActive ? ' is-active' : ''}`}
                    aria-pressed={isActive}
                    onClick={() =>
                      applySortOption(option.field, option.direction)
                    }
                  >
                    <span>{option.label}</span>
                    {isActive && (
                      <span className='inventory-sort-check' aria-hidden='true'>
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <span className='inventory-toolbar-item-count' aria-live='polite'>
          {isLoading
            ? 'Loading...'
            : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        </span>

        <div className='inventory-toolbar-spacer' />


        <button
          type='button'
          className='inventory-toolbar-button inventory-export-button'
          onClick={() => setShowExportDialog(true)}
          disabled={isLoading || Boolean(error)}
          title={selectedTagItems.length ? `Export inventory records or print ${selectedTagItems.length} selected tags` : 'Export inventory records'}
        >
          Export<span aria-hidden='true'>⤓</span>
        </button>

        <button
          type='button'
          className='inventory-toolbar-button inventory-print-tags-button'
          onClick={() => setTagPreviewItems(selectedTagItems)}
          disabled={selectedTagItems.length === 0}
          title={
            selectedTagItems.length
              ? `Preview ${selectedTagItems.length} selected tags`
              : 'Select items to preview tags'
          }
        >
          Print tags
          {selectedTagItems.length > 0 ? ` (${selectedTagItems.length})` : ''}
        </button>

        <button
          type='button'
          className='inventory-add-button'
          onClick={onAddItem}
        >
          <span aria-hidden='true'>+</span> Add item
        </button>
      </section>

      {activeFilterChips.length > 0 && (
        <div className='inventory-list-meta'>
          {activeFilterChips.map((chip) => (
          <button
            key={chip.id}
            type='button'
            className='inventory-filter-chip'
            onClick={() => updateFilters(chip.clear)}
            title={`Remove filter: ${chip.label}`}
          >
            {chip.label}
            <span aria-hidden='true'>×</span>
          </button>
        ))}
        </div>
      )}

      <section className='inventory-results' aria-label='Inventory results'>
        {isLoading ? (
          <div className='inventory-state' role='status'>
            <span className='inventory-spinner' aria-hidden='true' />
            Loading jewelry inventory...
          </div>
        ) : error ? (
          <div className='inventory-state inventory-state--error' role='alert'>
            <p>{error}</p>
            <button
              type='button'
              className='inventory-add-button'
              onClick={() => void loadInventory()}
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className='inventory-state'>
            <div className='inventory-empty-mark' aria-hidden='true'>
              ◇
            </div>
            <h3>No jewelry items found</h3>
            <p>Try changing your search or filters.</p>
            <button
              type='button'
              className='inventory-toolbar-button'
              onClick={resetFilters}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className='inventory-table-wrapper'>
            <table className='inventory-table'>
              <thead>
                <tr>
                  <th
                    scope='col'
                    className='inventory-select-heading'
                  >
                    <input
                      className='inventory-select-checkbox'
                      type='checkbox'
                      aria-label='Select all inventory items on this page for export and tag printing'
                      title={
                        allVisiblePageItemsSelected
                          ? 'Deselect all items on this page'
                          : 'Select all items on this page'
                      }
                      checked={allVisiblePageItemsSelected}
                      ref={(element) => {
                        if (element)
                          element.indeterminate =
                            someVisiblePageItemsSelected &&
                            !allVisiblePageItemsSelected;
                      }}
                      onChange={toggleAllVisiblePageTagItems}
                    />
                  </th>
                  <th scope='col' className='inventory-serial-heading'>
                    S.NO.
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('itemNumber')}
                      aria-label={`Sort by item number${getColumnSortIndicator('itemNumber')}`}
                    >
                      Item{getColumnSortIndicator('itemNumber')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('category')}
                    >
                      Category{getColumnSortIndicator('category')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('grossWeight')}
                    >
                      Gross wt.{getColumnSortIndicator('grossWeight')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('netWeight')}
                    >
                      Net wt.{getColumnSortIndicator('netWeight')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('diamondWeight')}
                    >
                      Diamonds{getColumnSortIndicator('diamondWeight')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('stoneWeight')}
                    >
                      Other stones{getColumnSortIndicator('stoneWeight')}
                    </button>
                  </th>
                  <th scope='col'>
                    <button
                      type='button'
                      className='inventory-sort-heading'
                      onClick={() => handleColumnSort('purity')}
                    >
                      Purity{getColumnSortIndicator('purity')}
                    </button>
                  </th>
                  <th scope='col'>IGI</th>
                  <th scope='col'>HUID</th>
                  <th scope='col'>Status</th>
                </tr>
              </thead>

              <tbody>
                {paginatedItems.map((item, index) => {
                  const purity = formatPurity(
                    item.purityName,
                    item.purityPercentBp,
                  );

                  return (
                    <tr
                      key={item.id}
                      className='inventory-table-row'
                      onClick={() => onViewItem(item.id)}
                    >
                      <td className='inventory-select-cell'>
                        <input
                          className='inventory-select-checkbox'
                          type='checkbox'
                          aria-label={`Select ${item.itemNumber} for export and tag printing`}
                          checked={selectedTagItemIds.has(item.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={() => toggleTagItem(item.id)}
                        />
                      </td>
                      <td className='inventory-serial-cell'>
                        {pageStartIndex + index + 1}
                      </td>
                      <td className='inventory-item-column'>
                        <div className='inventory-item-cell'>
                          {imageUrls[item.id] ? (
                            <img
                              className='inventory-item-image'
                              src={imageUrls[item.id]}
                              alt={`${item.itemNumber} jewelry design`}
                              onMouseEnter={(event) =>
                                handleImageMouseEnter(
                                  item.id,
                                  imageUrls[item.id],
                                  event,
                                )
                              }
                              onMouseLeave={handleImageMouseLeave}
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
                                handleImageMouseLeave();
                              }}
                            />
                          ) : (
                            <div
                              className='inventory-image-placeholder'
                              aria-hidden='true'
                            >
                              ◇
                            </div>
                          )}
                          <div className='inventory-item-info'>
                            <strong>{item.itemNumber}</strong>
                            {item.name && (
                              <span className='inventory-secondary-detail'>
                                {item.name}
                              </span>
                            )}
                          </div>
                        </div>
                        {item.notes && (
                          <p className='inventory-item-note'>
                            <strong>Note:</strong> {item.notes}
                          </p>
                        )}
                      </td>

                      <td>{item.categoryName}</td>
                      <td className='inventory-weight-cell'>
                        {formatWeight(item.grossWeightMilli)}
                      </td>
                      <td
                        className={`inventory-weight-cell ${
                          item.netWeightMilli === null
                            ? 'inventory-empty-cell'
                            : ''
                        }`}
                      >
                        {formatWeight(item.netWeightMilli)}
                      </td>

                      {item.diamondDetails ? (
                        <td className='inventory-detail-cell inventory-diamonds-cell'>
                          {item.diamondDetails}
                        </td>
                      ) : (
                        <td className='inventory-empty-cell'>{'—'}</td>
                      )}
                      {item.stoneDetails ? (
                        <td className='inventory-detail-cell'>
                          {item.stoneDetails}
                        </td>
                      ) : (
                        <td className='inventory-empty-cell'>{'—'}</td>
                      )}

                      <td>
                        <div className='inventory-purity-cell'>
                          <strong>{purity.name}</strong>
                          {purity.percentage && (
                            <span>{purity.percentage}</span>
                          )}
                        </div>
                      </td>

                      <td>
                        <span
                          className={`inventory-check ${
                            item.igiCertificateNumber
                              ? 'inventory-check--yes'
                              : 'inventory-check--no'
                          }`}
                          aria-label={
                            item.igiCertificateNumber
                              ? 'IGI certificate present'
                              : 'IGI certificate missing'
                          }
                        >
                          {item.igiCertificateNumber ? '✓' : '×'}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`inventory-check ${
                            item.huid
                              ? 'inventory-check--yes'
                              : 'inventory-check--no'
                          }`}
                          aria-label={
                            item.huid ? 'HUID present' : 'HUID missing'
                          }
                        >
                          {item.huid ? '✓' : '×'}
                        </span>
                      </td>

                      <td>
                        <span
                          className={`inventory-badge ${
                            item.isArchived === 1
                              ? 'inventory-badge--warning'
                              : 'inventory-badge--success'
                          }`}
                        >
                          {item.isArchived === 1 ? 'Archived' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <div
            className='inventory-pagination'
            aria-label='Inventory table pagination'
          >
            <div className='inventory-pagination-summary'>
              Showing{' '}
              <strong>
                {firstVisibleItem}–{lastVisibleItem}
              </strong>{' '}
              of <strong>{items.length}</strong> items
            </div>
            <div className='inventory-pagination-controls'>
              <label className='inventory-page-size'>
                Rows per page
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setCurrentPage(1);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <span className='inventory-page-indicator'>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type='button'
                className='inventory-page-button'
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                aria-label='First page'
              >
                «
              </button>
              <button
                type='button'
                className='inventory-page-button'
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <button
                type='button'
                className='inventory-page-button'
                onClick={() =>
                  setCurrentPage((page) => Math.min(totalPages, page + 1))
                }
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
              <button
                type='button'
                className='inventory-page-button'
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages}
                aria-label='Last page'
              >
                »
              </button>
            </div>
          </div>
        )}
      </section>

      {showExportDialog && (
        <ExportDialog
          configuration={{
            title: 'Inventory Export',
            filename: 'inventory.xlsx',
            columns: INVENTORY_EXPORT_COLUMNS,
            filteredRows: items,
            getAllRows: () =>
              getInventoryItems(
                { ...INITIAL_INVENTORY_FILTERS },
                { field: 'itemNumber', direction: 'asc' },
              ),
          }}
          defaultSelectedColumns={[
            'itemNumber',
            'grossWeight',
            'netWeight',
            'diamondDetails',
            'stoneDetails',
            'igiCertificateNumber',
          ]}
          selectedRows={selectedTagItems}
          onClose={() => setShowExportDialog(false)}
        />
      )}

      {tagPreviewItems && tagPreviewItems.length > 0 && (
        <JewelryTagPreview
          items={tagPreviewItems}
          onClose={() => setTagPreviewItems(null)}
        />
      )}

      {previewImage && (
        <div
          className='inventory-image-preview'
          aria-hidden='true'
          style={{ left: previewImage.left, top: previewImage.top }}
        >
          <img src={previewImage.url} alt='' />
        </div>
      )}

      <span className='inventory-visually-hidden'>
        {activeItemsCount} active inventory items
      </span>
    </div>
  );
}

export default InventoryScreen;
