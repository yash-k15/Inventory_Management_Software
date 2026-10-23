import { useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getExhibitions, getSharedInterestItems } from './exhibition.queries';
import {
  getRecentSelectionActivity,
  type RecentSelectionActivity,
} from '../../db/activityLog';
import ExhibitionInventory from './ExhibitionInventory';
import ExhibitionSelections from './ExhibitionSelections';
import ExhibitionCustomers from './ExhibitionCustomers';
import type { Exhibition, SharedInterestItem } from './exhibition.types';
import './ExhibitionWorkspace.css';

type WorkspaceTab =
  | 'overview'
  | 'inventory'
  | 'selections'
  | 'customers'
  | 'shared-interest';

const TABS: {
  id: WorkspaceTab;
  label: string;
  countKey?: 'registeredItems' | 'totalSelections' | 'customersAttended';
}[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory', countKey: 'registeredItems' },
  { id: 'selections', label: 'Selections', countKey: 'totalSelections' },
  { id: 'customers', label: 'Customers', countKey: 'customersAttended' },
  { id: 'shared-interest', label: 'Shared Interest' },
];

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatActivityTime(value: string) {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDateRange(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (start === end) return formatDate(start);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth)
    return `${startDate.getDate()}–${endDate.getDate()} ${new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(startDate)}`;
  if (sameYear)
    return `${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(startDate)} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function displayStatus(status: Exhibition['status']) {
  if (status === 'Planned') return 'Upcoming';
  if (status === 'Closed') return 'Past';
  return 'Active';
}

function getDayProgress(exhibition: Exhibition) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(`${exhibition.startDate}T00:00:00`);
  const end = new Date(`${exhibition.endDate}T00:00:00`);
  const totalDays = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
  );
  if (today < start) return null;
  if (today > end) return totalDays;
  return Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
}

const CATEGORY_CHART_COLORS = [
  '#98713f',
  '#647f70',
  '#b98d72',
  '#71849b',
  '#b7a16d',
  '#8c7898',
  '#73959a',
  '#bd8a8a',
  '#7f8f45',
  '#c17c45',
  '#557c8c',
  '#a66b83',
  '#8a7652',
  '#6e9b83',
  '#a18bc1',
  '#c09a57',
  '#5f8d9e',
  '#b4775d',
  '#7d83a8',
  '#8c9a63',
];

// Derive colors from the category ID so a category keeps its color when
// other categories have zero items or the category list changes order.
function getCategoryChartColor(categoryId: number) {
  const index =
    (((categoryId - 1) % CATEGORY_CHART_COLORS.length) +
      CATEGORY_CHART_COLORS.length) %
    CATEGORY_CHART_COLORS.length;
  return CATEGORY_CHART_COLORS[index];
}

function Overview({
  exhibition,
  onOpenTab,
}: {
  exhibition: Exhibition;
  onOpenTab: (tab: WorkspaceTab) => void;
}) {
  const activeCategories = exhibition.categories.filter(
    (category) => category.itemCount > 0,
  );
  const categoryTotal = activeCategories.reduce(
    (total, category) => total + category.itemCount,
    0,
  );
  const [hoveredCategoryId, setHoveredCategoryId] = useState<number | null>(
    null,
  );
  const [recentActivity, setRecentActivity] = useState<
    RecentSelectionActivity[]
  >([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      setActivityLoading(true);
      setActivityError(false);

      try {
        const activities = await getRecentSelectionActivity(exhibition.id, 5);
        if (!cancelled) setRecentActivity(activities);
      } catch (error) {
        console.error('Unable to load recent exhibition activity:', error);
        if (!cancelled) setActivityError(true);
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    }

    void loadActivity();

    return () => {
      cancelled = true;
    };
  }, [exhibition.id]);
  const donutCircumference = 2 * Math.PI * 72;
  let accumulatedItems = 0;
  const donutSegments = activeCategories
    .map((category) => {
      const segmentLength =
        categoryTotal > 0
          ? (category.itemCount / categoryTotal) * donutCircumference
          : 0;
      const segment = {
        category,
        color: getCategoryChartColor(category.categoryId),
        length: segmentLength,
        offset: accumulatedItems,
      };
      accumulatedItems += segmentLength;
      return segment;
    })
    .filter(({ category }) => category.itemCount > 0 && categoryTotal > 0);
  const hoveredCategory = activeCategories.find(
    (category) => category.categoryId === hoveredCategoryId,
  );

  return (
    <div className='exhibition-overview'>
      <section
        className='exhibition-overview-metrics'
        aria-label='Exhibition summary'
      >
        <article className='exhibition-overview-metric'>
          <span className='exhibition-overview-metric-label'>
            Items registered
          </span>
          <strong>{exhibition.registeredItems}</strong>
          <p>Inventory for this exhibition</p>
        </article>
        <article className='exhibition-overview-metric'>
          <span className='exhibition-overview-metric-label'>
            Customers attended
          </span>
          <strong>{exhibition.customersAttended}</strong>
          <p>Customers linked to this exhibition</p>
        </article>
        <article className='exhibition-overview-metric'>
          <span className='exhibition-overview-metric-label'>
            Total selections
          </span>
          <strong>{exhibition.totalSelections}</strong>
          <p>Active selections across all customers</p>
        </article>
        <article className='exhibition-overview-metric'>
          <span className='exhibition-overview-metric-label'>
            Unique selections
          </span>
          <strong>{exhibition.distinctSelectedItems}</strong>
          <p>Distinct pieces selected, counted once</p>
        </article>
      </section>

      <div className='exhibition-overview-panels'>
        <div className='exhibition-overview-left-column'>
          <section className='exhibition-overview-panel'>
            <header className='exhibition-overview-panel-header'>
              <h2>Registered inventory by category</h2>
              <span>Registered items, not selections</span>
            </header>
            {activeCategories.length === 0 ? (
              <div className='exhibition-overview-empty'>
                <p>No inventory categories are available yet.</p>
                <button
                  type='button'
                  className='exhibition-overview-secondary'
                  onClick={() => onOpenTab('inventory')}
                >
                  Register items
                </button>
              </div>
            ) : (
              <div className='exhibition-overview-inventory-chart'>
                <div className='exhibition-overview-donut-wrap'>
                  <div
                    className='exhibition-overview-donut'
                    aria-label='Registered inventory by category'
                  >
                    <svg
                      viewBox='0 0 180 180'
                      role='img'
                      aria-label='Hover over a colored segment to see its category and registered item count'
                    >
                      {donutSegments.map(
                        ({ category, color, length, offset }) => (
                          <circle
                            key={category.categoryId}
                            cx='90'
                            cy='90'
                            r='72'
                            fill='none'
                            stroke={color}
                            strokeWidth='32'
                            strokeDasharray={`${length} ${donutCircumference - length}`}
                            strokeDashoffset={-offset}
                            transform='rotate(-90 90 90)'
                            className='exhibition-overview-donut-segment'
                            tabIndex={0}
                            onMouseEnter={() =>
                              setHoveredCategoryId(category.categoryId)
                            }
                            onMouseLeave={() => setHoveredCategoryId(null)}
                            onFocus={() =>
                              setHoveredCategoryId(category.categoryId)
                            }
                            onBlur={() => setHoveredCategoryId(null)}
                            aria-label={`${category.categoryName}: ${category.itemCount} registered items`}
                          />
                        ),
                      )}
                    </svg>
                    <div className='exhibition-overview-donut-hole'>
                      {hoveredCategory ? (
                        <>
                          <strong>{hoveredCategory.itemCount}</strong>
                          <span>{hoveredCategory.categoryName}</span>
                        </>
                      ) : (
                        <>
                          <strong>{categoryTotal}</strong>
                          <span>registered</span>
                        </>
                      )}
                    </div>
                  </div>
                  <p
                    className='exhibition-overview-donut-hint'
                    aria-live='polite'
                  >
                    {hoveredCategory
                      ? `${hoveredCategory.categoryName}: ${hoveredCategory.itemCount} registered ${hoveredCategory.itemCount === 1 ? 'item' : 'items'}`
                      : 'Hover over a segment for category details'}
                  </p>
                </div>
                <div className='exhibition-overview-legend'>
                  {activeCategories.map((category) => (
                    <div
                      className='exhibition-overview-legend-item'
                      key={category.categoryId}
                    >
                      <span
                        className='exhibition-overview-legend-swatch'
                        style={{
                          backgroundColor: getCategoryChartColor(
                            category.categoryId,
                          ),
                        }}
                        aria-hidden='true'
                      />
                      <span className='exhibition-overview-legend-name'>
                        {category.categoryName}
                      </span>
                      <strong>{category.itemCount}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className='exhibition-overview-panel exhibition-overview-activity'>
            <header className='exhibition-overview-panel-header'>
              <h2>Recent activity</h2>
            </header>
            {activityLoading ? (
              <div
                className='exhibition-overview-activity-empty'
                aria-live='polite'
              >
                <p>Loading recent activity…</p>
              </div>
            ) : activityError ? (
              <div className='exhibition-overview-activity-empty' role='alert'>
                <p>Unable to load recent activity.</p>
                <span>Please try reopening this exhibition.</span>
              </div>
            ) : recentActivity.length === 0 ? (
              <div className='exhibition-overview-activity-empty'>
                <span aria-hidden='true'>◇</span>
                <p>No selection activity yet</p>
                <span>Selection additions and removals will appear here.</span>
              </div>
            ) : (
              <div className='exhibition-overview-activity-list'>
                {recentActivity.map((activity) => {
                  const added =
                    activity.activityType === 'selection_items_added';
                  const count = activity.itemCount;

                  return (
                    <article
                      className='exhibition-overview-activity-item'
                      key={activity.operationId ?? `activity-${activity.id}`}
                    >
                      <span
                        className={`exhibition-overview-activity-badge ${added ? 'is-added' : 'is-removed'}`}
                      >
                        {added ? 'Added' : 'Removed'}
                      </span>
                      <div className='exhibition-overview-activity-details'>
                        <p>
                          <strong>{activity.customerName}</strong>{' '}
                          {added ? 'added' : 'removed'}{' '}
                          <strong>
                            {count} {count === 1 ? 'item' : 'items'}
                          </strong>{' '}
                          {added ? 'to' : 'from'} their selection
                        </p>
                      </div>
                      <time
                        className='exhibition-overview-activity-time'
                        dateTime={activity.createdAt}
                      >
                        {formatActivityTime(activity.createdAt)}
                      </time>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className='exhibition-overview-panel exhibition-overview-selection-panel'>
          <header className='exhibition-overview-panel-header'>
            <h2>Selections by category</h2>
            <span>Unique pieces selected vs. registered</span>
          </header>
          {activeCategories.length === 0 ? (
            <div className='exhibition-overview-empty'>
              <p>
                Category selection details will appear when inventory categories
                are available.
              </p>
            </div>
          ) : (
            <div className='exhibition-overview-selection-list'>
              {activeCategories.map((category) => {
                const uniqueSelectedItems = category.uniqueSelectedItems ?? 0;
                const totalSelections = category.totalSelections ?? 0;
                const percentage =
                  category.itemCount > 0
                    ? Math.min(
                        100,
                        (uniqueSelectedItems / category.itemCount) * 100,
                      )
                    : 0;
                return (
                  <div
                    className='exhibition-overview-selection'
                    key={category.categoryId}
                  >
                    <div className='exhibition-overview-selection-heading'>
                      <span className='exhibition-overview-category-name'>
                        {category.categoryName}
                      </span>
                      <strong>
                        {uniqueSelectedItems} / {category.itemCount}
                      </strong>
                    </div>
                    <div
                      className='exhibition-overview-category-track'
                      role='progressbar'
                      aria-label={`${category.categoryName} unique pieces selected`}
                      aria-valuemin={0}
                      aria-valuemax={category.itemCount}
                      aria-valuenow={Math.min(
                        uniqueSelectedItems,
                        category.itemCount,
                      )}
                    >
                      <span style={{ width: `${percentage}%` }} />
                    </div>
                    <div className='exhibition-overview-selection-counts'>
                      <span>
                        {uniqueSelectedItems} unique{' '}
                        {uniqueSelectedItems === 1 ? 'piece' : 'pieces'}{' '}
                        selected
                      </span>
                      <span>
                        {totalSelections} total{' '}
                        {totalSelections === 1 ? 'selection' : 'selections'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

type SharedInterestSortKey =
  | 'itemNumber'
  | 'categoryName'
  | 'customerCount'
  | 'customerNames';
type SortDirection = 'asc' | 'desc';

function SharedInterest({ exhibitionId }: { exhibitionId: number }) {
  const [items, setItems] = useState<SharedInterestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  const [imageErrors, setImageErrors] = useState<Set<number>>(() => new Set());
  const [sortKey, setSortKey] =
    useState<SharedInterestSortKey>('customerCount');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  useEffect(() => {
    if (!categoryMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        categoryDropdownRef.current &&
        event.target instanceof Node &&
        !categoryDropdownRef.current.contains(event.target)
      ) {
        setCategoryMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [categoryMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const result = await getSharedInterestItems(exhibitionId);
        if (!cancelled) setItems(result);
      } catch (err) {
        console.error('Unable to load shared interest:', err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [exhibitionId]);

  const categories = [...new Set(items.map((item) => item.categoryName))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  const term = search.trim().toLowerCase();
  const filteredItems = items.filter(
    (item) =>
      (categoryFilter === 'all' || item.categoryName === categoryFilter) &&
      (!term ||
        item.itemNumber.toLowerCase().includes(term) ||
        item.categoryName.toLowerCase().includes(term) ||
        item.customerNames.some((name) => name.toLowerCase().includes(term))),
  );
  const sortedItems = [...filteredItems].sort((a, b) => {
    let comparison = 0;
    if (sortKey === 'customerCount')
      comparison = a.customerCount - b.customerCount;
    else if (sortKey === 'customerNames')
      comparison = a.customerNames
        .join(', ')
        .localeCompare(b.customerNames.join(', '), undefined, {
          sensitivity: 'base',
        });
    else
      comparison = a[sortKey].localeCompare(b[sortKey], undefined, {
        sensitivity: 'base',
      });
    if (comparison === 0)
      comparison = a.itemNumber.localeCompare(b.itemNumber, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  function changeSort(key: SharedInterestSortKey) {
    if (sortKey === key)
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection(key === 'customerCount' ? 'desc' : 'asc');
    }
  }
  function sortLabel(key: SharedInterestSortKey) {
    return sortKey === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
  }

  return (
    <section className='exhibition-shared-interest'>
      <header className='exhibition-shared-interest-header'>
        <div>
          <h2>Shared Interest</h2>
          <p>
            Pieces actively selected by two or more customers in this
            exhibition.
          </p>
        </div>
        <span className='exhibition-shared-interest-total'>
          {items.length} {items.length === 1 ? 'piece' : 'pieces'}
        </span>
      </header>
      <div className='exhibition-shared-interest-filters'>
        <label className='exhibition-shared-interest-search'>
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Item number, category, or customer'
          />
        </label>
        <div className='exhibition-shared-interest-category'>
          <span className='exhibition-shared-interest-filter-label'>
            Category
          </span>
          <div
            className='exhibition-shared-interest-category-dropdown'
            ref={categoryDropdownRef}
          >
            <button
              type='button'
              className='exhibition-shared-interest-category-select'
              aria-haspopup='listbox'
              aria-expanded={categoryMenuOpen}
              onClick={() => setCategoryMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCategoryMenuOpen(false);
              }}
            >
              <span>
                {categoryFilter === 'all' ? 'All categories' : categoryFilter}
              </span>
              <span
                className='exhibition-shared-interest-category-chevron'
                aria-hidden='true'
              >
                ⌄
              </span>
            </button>
            {categoryMenuOpen && (
              <div
                className='exhibition-shared-interest-category-menu'
                role='listbox'
                aria-label='Filter by category'
              >
                {[
                  { value: 'all', label: 'All categories' },
                  ...categories.map((category) => ({
                    value: category,
                    label: category,
                  })),
                ].map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    role='option'
                    aria-selected={categoryFilter === option.value}
                    className={`exhibition-shared-interest-category-option ${categoryFilter === option.value ? 'is-selected' : ''}`}
                    onClick={() => {
                      setCategoryFilter(option.value);
                      setCategoryMenuOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {categoryFilter === option.value && (
                      <span aria-hidden='true'>✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <div className='exhibition-shared-interest-state'>
          Loading shared interest…
        </div>
      ) : error ? (
        <div className='exhibition-shared-interest-state' role='alert'>
          Unable to load shared interest. Please try reopening this exhibition.
        </div>
      ) : sortedItems.length === 0 ? (
        <div className='exhibition-shared-interest-state'>
          <strong>
            {items.length === 0
              ? 'No shared interest yet'
              : 'No matching pieces'}
          </strong>
          <p>
            {items.length === 0
              ? 'When multiple customers actively select the same registered piece, it will appear here.'
              : 'Try changing your search or category filter.'}
          </p>
        </div>
      ) : (
        <div className='exhibition-shared-interest-table-wrap'>
          <table className='exhibition-shared-interest-table'>
            <thead>
              <tr>
                <th></th>
                <th>
                  <button
                    type='button'
                    onClick={() => changeSort('itemNumber')}
                  >
                    Item No.{sortLabel('itemNumber')}
                  </button>
                </th>
                <th>
                  <button
                    type='button'
                    onClick={() => changeSort('categoryName')}
                  >
                    Category{sortLabel('categoryName')}
                  </button>
                </th>
                <th className='is-numeric'>
                  <button
                    type='button'
                    onClick={() => changeSort('customerCount')}
                  >
                    Customers interested{sortLabel('customerCount')}
                  </button>
                </th>
                <th>
                  <button
                    type='button'
                    onClick={() => changeSort('customerNames')}
                  >
                    Customer names{sortLabel('customerNames')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.itemId}>
                  <td className='exhibition-shared-interest-image-cell'>
                    {item.imagePath && !imageErrors.has(item.itemId) ? (
                      <img
                        className='exhibition-shared-interest-image'
                        src={convertFileSrc(item.imagePath)}
                        alt={`${item.itemNumber}`}
                        onError={() =>
                          setImageErrors((current) =>
                            new Set(current).add(item.itemId),
                          )
                        }
                      />
                    ) : (
                      <span
                        className='exhibition-shared-interest-image-fallback'
                        aria-label='No image available'
                        title='No image available'
                      >
                        ◇
                      </span>
                    )}
                  </td>
                  <td className='exhibition-shared-interest-item-number'>
                    {item.itemNumber}
                  </td>
                  <td>{item.categoryName}</td>
                  <td className='is-numeric'>
                    <span className='exhibition-shared-interest-count'>
                      {item.customerCount}
                    </span>
                  </td>
                  <td className='exhibition-shared-interest-customer-names'>
                    <div className='exhibition-shared-interest-customer-chips'>
                      {item.customerNames.map((name) => (
                        <span
                          className='exhibition-shared-interest-customer-chip'
                          key={name}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function ExhibitionWorkspace({
  exhibitionId,
  onBack,
}: {
  exhibitionId: number;
  onBack: () => void;
}) {
  const [exhibition, setExhibition] = useState<Exhibition | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview');
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null,
  );
  const [sharedInterestCount, setSharedInterestCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshExhibition() {
    const results = await getExhibitions({
      search: '',
      status: 'all',
    });

    const match = results.find((item) => item.id === exhibitionId) ?? null;

    if (match) {
      setExhibition(match);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadExhibition() {
      setLoading(true);
      setError(null);
      try {
        const results = await getExhibitions({ search: '', status: 'all' });
        const match = results.find((item) => item.id === exhibitionId) ?? null;
        if (!cancelled) {
          setExhibition(match);
          if (!match)
            setError(
              'This exhibition could not be found. It may have been deleted.',
            );
        }
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load this exhibition.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadExhibition();
    return () => {
      cancelled = true;
    };
  }, [exhibitionId]);

  useEffect(() => {
    let cancelled = false;
    getSharedInterestItems(exhibitionId)
      .then((items) => {
        if (!cancelled) setSharedInterestCount(items.length);
      })
      .catch((err) =>
        console.error('Unable to load shared interest count:', err),
      );
    return () => {
      cancelled = true;
    };
  }, [exhibitionId]);

  if (loading) {
    return (
      <section className='exhibition-workspace-state' aria-live='polite'>
        <p className='exhibition-workspace-back'>
          <button type='button' onClick={onBack}>
            ← Exhibitions
          </button>
        </p>
        <p>Loading exhibition…</p>
      </section>
    );
  }

  if (error || !exhibition) {
    return (
      <section className='exhibition-workspace-state' role='alert'>
        <p className='exhibition-workspace-back'>
          <button type='button' onClick={onBack}>
            ← Exhibitions
          </button>
        </p>
        <h1>Unable to open exhibition</h1>
        <p>{error ?? 'This exhibition is no longer available.'}</p>
        <button
          type='button'
          className='exhibition-workspace-secondary'
          onClick={onBack}
        >
          Back to exhibitions
        </button>
      </section>
    );
  }

  const dayProgress = getDayProgress(exhibition);

  return (
    <section className='exhibition-workspace'>
      <button
        type='button'
        className='exhibition-workspace-back'
        onClick={onBack}
      >
        <span aria-hidden='true'>←</span> Exhibitions
      </button>
      <header className='exhibition-workspace-header'>
        <div className='exhibition-workspace-heading'>
          <div className='exhibition-workspace-title-line'>
            <h1>{exhibition.name}</h1>
            <span
              className={`exhibition-workspace-status exhibition-workspace-status--${exhibition.status.toLowerCase()}`}
            >
              {displayStatus(exhibition.status)}
            </span>
          </div>
          <p className='exhibition-workspace-subtitle'>
            {[
              exhibition.location?.trim(),
              formatDateRange(exhibition.startDate, exhibition.endDate),
            ]
              .filter(Boolean)
              .join(' · ')}
            {dayProgress !== null && exhibition.status === 'Active' && (
              <>
                {' '}
                · Day {dayProgress} of {exhibition.totalDays}
              </>
            )}
          </p>
          <p className='exhibition-workspace-summary'>
            {exhibition.registeredItems}{' '}
            {exhibition.registeredItems === 1 ? 'item' : 'items'} registered
            {' · '}
            {exhibition.customersAttended}{' '}
            {exhibition.customersAttended === 1 ? 'customer' : 'customers'}{' '}
            attended
            {' · '}
            {exhibition.totalSelections} active selections
          </p>
        </div>
      </header>

      <nav
        className='exhibition-workspace-tabs'
        aria-label='Exhibition workspace sections'
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type='button'
            className={`exhibition-workspace-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {(tab.countKey || tab.id === 'shared-interest') && (
              <span className='exhibition-workspace-tab-count'>
                {tab.id === 'shared-interest'
                  ? sharedInterestCount
                  : exhibition[tab.countKey!]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className='exhibition-workspace-content' aria-live='polite'>
        {activeTab === 'overview' ? (
          <Overview exhibition={exhibition} onOpenTab={setActiveTab} />
        ) : activeTab === 'inventory' ? (
          <ExhibitionInventory
            exhibitionId={exhibitionId}
            exhibitionEnded={
              exhibition.endDate < new Date().toLocaleDateString('en-CA')
            }
            exhibitionUpcoming={
              exhibition.startDate > new Date().toLocaleDateString('en-CA')
            }
            onInventoryChanged={refreshExhibition}
          />
        ) : activeTab === 'selections' ? (
          <ExhibitionSelections
            exhibitionId={exhibitionId}
            initialCustomerId={selectedCustomerId}
            onRefreshExhibition={refreshExhibition}
          />
        ) : activeTab === 'shared-interest' ? (
          <SharedInterest exhibitionId={exhibitionId} />
        ) : (
          <ExhibitionCustomers
            exhibitionId={exhibitionId}
            onOpenSelection={(customerId) => {
              setSelectedCustomerId(customerId);
              setActiveTab('selections');
            }}
          />
        )}
      </div>
    </section>
  );
}
