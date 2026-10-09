import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './InventoryScreen.css';

import { getInventoryCategories, getInventoryItems } from './inventory.queries';

import type {
  InventoryCategoryOption,
  InventoryFilters,
  InventoryItem,
} from './inventory.types';

const INITIAL_FILTERS: InventoryFilters = {
  search: '',
  categoryId: null,
  certification: 'all',
  archiveStatus: 'active',
};

function formatWeight(weightMilli: number | null): string {
  if (weightMilli === null) {
    return '—';
  }

  return `${(weightMilli / 1000).toFixed(3)} g`;
}

function formatPurity(
  purityName: string | null,
  purityPercentBp: number | null,
): string {
  if (purityName && purityPercentBp !== null) {
    return `${purityName} (${(purityPercentBp / 100).toFixed(2)}%)`;
  }

  return purityName ?? '—';
}

function formatCertification(item: InventoryItem): string {
  return item.isCertified === 1 ? 'Certified' : 'Not certified';
}

function InventoryScreen() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategoryOption[]>([]);
  const [filters, setFilters] = useState<InventoryFilters>(INITIAL_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  const [showCleanConfirmation, setShowCleanConfirmation] = useState(false);

  const loadInventory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [inventoryItems, categoryOptions] = await Promise.all([
        getInventoryItems(filters),
        getInventoryCategories(),
      ]);

      setItems(inventoryItems);
      setCategories(categoryOptions);
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
    void loadInventory();
  }, [loadInventory]);

  const updateFilter = <K extends keyof InventoryFilters>(
    key: K,
    value: InventoryFilters[K],
  ) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const resetFilters = () => {
    setFilters({ ...INITIAL_FILTERS });
  };

  const seedSampleInventory = async () => {
    setIsSeeding(true);
    setSeedMessage(null);

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

  return (
    <div className='inventory-screen'>
      <section className='app-page-heading'>
        <div className='inventory-heading-row'>
          <div>
            <h2 className='app-page-title'>Inventory</h2>
            <p className='app-page-description'>
              Browse and search your jewelry catalog.
            </p>
          </div>

          <div className='inventory-heading-actions'>
            {import.meta.env.DEV && (
              <>
                <button
                  type='button'
                  className='app-button app-button--secondary'
                  onClick={() => void seedSampleInventory()}
                  disabled={isLoading || isSeeding}
                >
                  {isSeeding ? 'Working...' : 'Seed sample data'}
                </button>

                <button
                  type='button'
                  className='app-button app-button--secondary'
                  onClick={() => setShowCleanConfirmation(true)}
                  disabled={isLoading || isSeeding}
                >
                  Clean sample data
                </button>
              </>
            )}

            <button
              type='button'
              className='app-button app-button--secondary'
              onClick={() => void loadInventory()}
              disabled={isLoading || isSeeding}
            >
              Refresh
            </button>
          </div>
        </div>
        {import.meta.env.DEV && seedMessage && (
          <p className='app-muted' role='status'>
            {seedMessage}
          </p>
        )}

        {import.meta.env.DEV && showCleanConfirmation && (
          <div
            className='app-card'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='clean-sample-title'
          >
            <h3 id='clean-sample-title'>Delete sample jewelry data?</h3>
            <p>
              This will permanently delete sample items whose item numbers start
              with TEST-, along with unused test categories and purities.
            </p>
            <div className='inventory-heading-actions'>
              <button
                type='button'
                className='app-button app-button--secondary'
                onClick={() => setShowCleanConfirmation(false)}
                disabled={isSeeding}
              >
                Cancel
              </button>
              <button
                type='button'
                className='app-button app-button--secondary'
                onClick={() => void cleanSampleInventory()}
                disabled={isSeeding}
              >
                {isSeeding ? 'Cleaning...' : 'Confirm cleanup'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        className='inventory-filters app-card'
        aria-label='Inventory filters'
      >
        <div className='inventory-search'>
          <label htmlFor='inventory-search'>Search inventory</label>
          <input
            id='inventory-search'
            className='app-input'
            type='search'
            placeholder='Search item number or name...'
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
          />
        </div>

        <div className='inventory-filter-field'>
          <label htmlFor='inventory-category'>Category</label>
          <select
            id='inventory-category'
            className='app-select'
            value={filters.categoryId ?? ''}
            onChange={(event) =>
              updateFilter(
                'categoryId',
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          >
            <option value=''>All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className='inventory-filter-field'>
          <label htmlFor='inventory-certification'>Certification</label>
          <select
            id='inventory-certification'
            className='app-select'
            value={filters.certification}
            onChange={(event) =>
              updateFilter(
                'certification',
                event.target.value as InventoryFilters['certification'],
              )
            }
          >
            <option value='all'>All items</option>
            <option value='certified'>Certified</option>
            <option value='uncertified'>Not certified</option>
          </select>
        </div>

        <div className='inventory-filter-field'>
          <label htmlFor='inventory-archive'>Archive status</label>
          <select
            id='inventory-archive'
            className='app-select'
            value={filters.archiveStatus}
            onChange={(event) =>
              updateFilter(
                'archiveStatus',
                event.target.value as InventoryFilters['archiveStatus'],
              )
            }
          >
            <option value='active'>Active items</option>
            <option value='archived'>Archived items</option>
            <option value='all'>All items</option>
          </select>
        </div>

        <button
          type='button'
          className='app-button app-button--secondary inventory-reset-button'
          onClick={resetFilters}
          disabled={isLoading}
        >
          Reset filters
        </button>
      </section>

      <section
        className='inventory-results app-card'
        aria-label='Inventory results'
      >
        <div className='inventory-results-header'>
          <div>
            <h3 className='inventory-results-title'>Jewelry items</h3>
            <p className='app-muted inventory-results-subtitle'>
              {isLoading
                ? 'Loading inventory...'
                : `${items.length} ${items.length === 1 ? 'item' : 'items'} found`}
            </p>
          </div>
        </div>

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
              className='app-button app-button--primary'
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
            <h4>No jewelry items found</h4>
            <p className='app-muted'>Try changing your search or filters.</p>
            <button
              type='button'
              className='app-button app-button--secondary'
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
                  <th scope='col'>Gold weight</th>
                  <th scope='col'>Purity</th>
                  <th scope='col'>Diamonds</th>
                  <th scope='col'>Other stones</th>
                  <th scope='col'>Certification</th>
                  <th scope='col'>Status</th>
                </tr>
              </thead>

              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className='inventory-item-cell'>
                        <div
                          className='inventory-image-placeholder'
                          aria-label={`Image placeholder for ${item.itemNumber}`}
                        >
                          ◇
                        </div>

                        <div className='inventory-item-info'>
                          <strong>{item.itemNumber}</strong>
                          {item.name && (
                            <span className='app-muted'>{item.name}</span>
                          )}
                          {item.huid && (
                            <span className='inventory-secondary-detail'>
                              HUID: {item.huid}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td>{item.categoryName}</td>
                    <td>{formatWeight(item.grossWeightMilli)}</td>
                    <td>
                      {formatPurity(item.purityName, item.purityPercentBp)}
                    </td>
                    <td className='inventory-detail-cell'>
                      {item.diamondDetails ?? '—'}
                    </td>
                    <td className='inventory-detail-cell'>
                      {item.stoneDetails ?? '—'}
                    </td>
                    <td>
                      <span
                        className={`inventory-badge ${
                          item.isCertified === 1
                            ? 'inventory-badge--success'
                            : 'inventory-badge--muted'
                        }`}
                      >
                        {formatCertification(item)}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default InventoryScreen;
