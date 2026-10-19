import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import './InventoryScreen.css';

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

  const [filterOptions, setFilterOptions] =
    useState<InventoryFilterOptions | null>(null);
  const [filters, setFilters] = useState<InventoryFilterValues>(
    INITIAL_INVENTORY_FILTERS,
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [showCleanConfirmation, setShowCleanConfirmation] = useState(false);
  const [showDevMenu, setShowDevMenu] = useState(false);

  const devMenuRef = useRef<HTMLDivElement>(null);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [inventoryItems, options] = await Promise.all([
        getInventoryItems(filters),
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
  }, [filters]);

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
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    if (!showDevMenu) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !devMenuRef.current?.contains(event.target)
      ) {
        setShowDevMenu(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setShowDevMenu(false);
    }

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDevMenu]);

  const updateFilter = <K extends keyof InventoryFilterValues>(
    key: K,
    value: InventoryFilterValues[K],
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const updateFilters = (patch: Partial<InventoryFilterValues>) => {
    setFilters((current) => ({
      ...current,
      ...patch,
    }));
  };

  const resetFilters = () => {
    setFilters({ ...INITIAL_INVENTORY_FILTERS });
  };

  const activeFilterChips = filterOptions
    ? getActiveInventoryFilterChips(filters, filterOptions)
    : [];

  const seedSampleInventory = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    setShowDevMenu(false);

    try {
      const count = await invoke<number>('seed_dev_inventory');
      setSeedMessage(`Sample inventory ready: ${count} test items.`);
      await loadInventory();
    } catch (err) {
      console.error('Failed to seed sample inventory:', err);
      setSeedMessage(
        'Unable to seed sample inventory. Check the console for details.',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const cleanSampleInventory = async () => {
    setIsSeeding(true);
    setSeedMessage(null);
    setShowDevMenu(false);

    try {
      const count = await invoke<number>('clean_dev_inventory');
      setSeedMessage(`Sample cleanup complete: ${count} test items removed.`);
      setShowCleanConfirmation(false);
      await loadInventory();
    } catch (err) {
      console.error('Failed to clean sample inventory:', err);
      setSeedMessage(
        'Unable to clean sample inventory. Check the console for details.',
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const activeItemsCount = items.filter((item) => item.isArchived === 0).length;

  return (
    <div className='inventory-screen'>
      <header className='inventory-page-header'>
        <div>
          <h2 className='app-page-title'>Inventory</h2>
          <p className='app-page-description'>
            Browse and search your jewelry catalog.
          </p>
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

        <button
          type='button'
          className='inventory-toolbar-button inventory-sort-button'
          title='Sorting will be implemented later'
          onClick={() => {
            // Sorting behavior will be implemented in a later pass.
          }}
        >
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <path d='M8 4v16m0 0-4-4m4 4 4-4M16 20V4m0 0-4 4m4-4 4 4' />
          </svg>
          <span>Sort:</span>
          <strong>Item number</strong>
        </button>

        <div className='inventory-toolbar-spacer' />

        {import.meta.env.DEV && (
          <div className='inventory-dev-menu' ref={devMenuRef}>
            <button
              type='button'
              className='inventory-toolbar-button inventory-more-button'
              aria-label='Development tools'
              aria-haspopup='menu'
              aria-expanded={showDevMenu}
              onClick={() => setShowDevMenu((current) => !current)}
              disabled={isSeeding}
            >
              <span aria-hidden='true'>•••</span>
            </button>

            {showDevMenu && (
              <div className='inventory-dev-menu-panel' role='menu'>
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => void seedSampleInventory()}
                  disabled={isLoading || isSeeding}
                >
                  {isSeeding ? 'Working...' : 'Seed sample data'}
                </button>
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => {
                    setShowDevMenu(false);
                    setShowCleanConfirmation(true);
                  }}
                  disabled={isLoading || isSeeding}
                >
                  Clean sample data
                </button>
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => {
                    setShowDevMenu(false);
                    void loadInventory();
                  }}
                  disabled={isLoading || isSeeding}
                >
                  Refresh inventory
                </button>
              </div>
            )}
          </div>
        )}

        <button
          type='button'
          className='inventory-add-button'
          onClick={onAddItem}
        >
          <span aria-hidden='true'>+</span> Add item
        </button>
      </section>

      <div className='inventory-list-meta'>
        <span>
          {isLoading
            ? 'Loading...'
            : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        </span>

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

      {import.meta.env.DEV && seedMessage && (
        <div className='inventory-dev-message' role='status'>
          <span>{seedMessage}</span>
          <button
            type='button'
            aria-label='Dismiss message'
            onClick={() => setSeedMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      {import.meta.env.DEV && showCleanConfirmation && (
        <div
          className='inventory-confirm-overlay'
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSeeding) {
              setShowCleanConfirmation(false);
            }
          }}
        >
          <section
            className='inventory-confirm-dialog'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='clean-sample-title'
          >
            <h3 id='clean-sample-title'>Delete sample jewelry data?</h3>
            <p>
              This permanently deletes sample items whose item numbers start
              with TEST-, along with unused test categories and purities.
            </p>
            <div className='inventory-confirm-actions'>
              <button
                type='button'
                className='inventory-toolbar-button'
                onClick={() => setShowCleanConfirmation(false)}
                disabled={isSeeding}
              >
                Cancel
              </button>
              <button
                type='button'
                className='inventory-add-button'
                onClick={() => void cleanSampleInventory()}
                disabled={isSeeding}
              >
                {isSeeding ? 'Cleaning...' : 'Confirm cleanup'}
              </button>
            </div>
          </section>
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
                  <th scope='col'>Item</th>
                  <th scope='col'>Category</th>
                  <th scope='col'>Gross wt.</th>
                  <th scope='col'>Net wt.</th>
                  <th scope='col'>Diamonds</th>
                  <th scope='col'>Other stones</th>
                  <th scope='col'>Purity</th>
                  <th scope='col'>IGI</th>
                  <th scope='col'>HUID</th>
                  <th scope='col'>Status</th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => {
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
                      <td className='inventory-item-column'>
                        <div className='inventory-item-cell'>
                          {imageUrls[item.id] ? (
                            <img
                              className='inventory-item-image'
                              src={imageUrls[item.id]}
                              alt={`${item.itemNumber} jewelry design`}
                              onError={(event) => {
                                event.currentTarget.style.display = 'none';
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
      </section>

      <span className='inventory-visually-hidden'>
        {activeItemsCount} active inventory items
      </span>
    </div>
  );
}

export default InventoryScreen;
