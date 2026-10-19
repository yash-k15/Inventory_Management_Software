import { useState, type ReactNode } from 'react';
import FilterPanel from '../../components/FilterPanel/FilterPanel';
import type {
  InventoryFilterOptions,
  InventoryFilters as InventoryFilterValues,
  InventoryHuidStatus,
  InventoryItemStatus,
} from './inventory.types';
import './InventoryFilters.css';

export const INITIAL_INVENTORY_FILTERS: InventoryFilterValues = {
  search: '',
  categoryId: null,
  certification: 'all',
  archiveStatus: 'active',
  categoryIds: [],
  itemStatuses: ['active'],
  certificationStatuses: [],
  huidStatuses: [],
  purityIds: [],
  goldTypeIds: [],
  diamondShapeIds: [],
  diamondCombinationIds: [],
  stoneTypeIds: [],
  diamondPiecesMin: null,
  diamondPiecesMax: null,
  diamondWeightMinCt: null,
  diamondWeightMaxCt: null,
  stonePresence: 'any',
  stonePiecesMin: null,
  stonePiecesMax: null,
  stoneWeightUnit: 'ct',
  stoneWeightMin: null,
  stoneWeightMax: null,
  grossWeightMin: null,
  grossWeightMax: null,
  netWeightMin: null,
  netWeightMax: null,
};

type FilterPatch = Partial<InventoryFilterValues>;

export interface ActiveInventoryFilterChip {
  id: string;
  label: string;
  clear: FilterPatch;
}

function selectedNames(
  ids: number[] | undefined,
  options: Array<{ id: number; name: string }>,
): string[] {
  return (ids ?? [])
    .map((id) => options.find((option) => option.id === id)?.name)
    .filter((name): name is string => Boolean(name));
}

function rangeLabel(
  label: string,
  min: number | null | undefined,
  max: number | null | undefined,
  unit: string,
): string | null {
  if (min == null && max == null) return null;

  if (min != null && max != null) return `${label}: ${min}–${max} ${unit}`;
  if (min != null) return `${label}: ≥ ${min} ${unit}`;
  return `${label}: ≤ ${max} ${unit}`;
}

export function getActiveInventoryFilterChips(
  filters: InventoryFilterValues,
  options: InventoryFilterOptions,
): ActiveInventoryFilterChip[] {
  const chips: ActiveInventoryFilterChip[] = [];

  const add = (id: string, label: string | null, clear: FilterPatch) => {
    if (label) chips.push({ id, label, clear });
  };

  const categoryNames = selectedNames(filters.categoryIds, options.categories);
  add(
    'categories',
    categoryNames.length ? `Category: ${categoryNames.join(', ')}` : null,
    { categoryIds: [], categoryId: null },
  );

  const statuses = filters.itemStatuses;
  const defaultActiveOnly = statuses?.length === 1 && statuses[0] === 'active';

  if (statuses !== undefined && !defaultActiveOnly && statuses.length !== 2) {
    add(
      'status',
      statuses.length === 1
        ? statuses[0] === 'active'
          ? 'Active items'
          : 'Archived items'
        : 'All item statuses',
      {
        itemStatuses: ['active'],
        archiveStatus: 'active',
      },
    );
  } else if (statuses === undefined && filters.archiveStatus !== 'active') {
    add(
      'status',
      filters.archiveStatus === 'archived' ? 'Archived items' : 'All items',
      { itemStatuses: ['active'], archiveStatus: 'active' },
    );
  }

  const certificationStatuses = filters.certificationStatuses ?? [];
  if (certificationStatuses.length === 1) {
    add(
      'certification',
      certificationStatuses[0] === 'certified'
        ? 'IGI certified'
        : 'No IGI certificate',
      { certificationStatuses: [], certification: 'all' },
    );
  } else if (
    filters.certificationStatuses === undefined &&
    filters.certification !== 'all'
  ) {
    add(
      'certification',
      filters.certification === 'certified'
        ? 'IGI certified'
        : 'No IGI certificate',
      { certification: 'all' },
    );
  }

  if (filters.huidStatuses?.length === 1) {
    add(
      'huid',
      filters.huidStatuses[0] === 'present' ? 'HUID present' : 'HUID missing',
      { huidStatuses: [] },
    );
  }

  const purityNames = selectedNames(filters.purityIds, options.purities);
  add(
    'purity',
    purityNames.length ? `Purity: ${purityNames.join(', ')}` : null,
    { purityIds: [] },
  );

  const goldTypeNames = selectedNames(filters.goldTypeIds, options.goldTypes);
  add(
    'gold-type',
    goldTypeNames.length ? `Gold type: ${goldTypeNames.join(', ')}` : null,
    { goldTypeIds: [] },
  );

  const diamondShapeNames = (filters.diamondShapeIds ?? [])
    .map((id) => options.diamondShapes.find((option) => option.id === id)?.code)
    .filter((name): name is string => Boolean(name));

  add(
    'diamond-shape',
    diamondShapeNames.length
      ? `Diamond shape: ${diamondShapeNames.join(', ')}`
      : null,
    { diamondShapeIds: [] },
  );

  const diamondQualities = (filters.diamondCombinationIds ?? [])
    .map((id) => {
      const option = options.diamondCombinations.find(
        (combination) => combination.id === id,
      );
      return option ? `${option.shapeCode} ${option.quality}` : null;
    })
    .filter((name): name is string => Boolean(name));

  add(
    'diamond-quality',
    diamondQualities.length
      ? `Diamond quality: ${diamondQualities.join(', ')}`
      : null,
    { diamondCombinationIds: [] },
  );

  const diamondPieces = rangeLabel(
    'Diamond pieces',
    filters.diamondPiecesMin,
    filters.diamondPiecesMax,
    'pcs',
  );
  add('diamond-pieces', diamondPieces, {
    diamondPiecesMin: null,
    diamondPiecesMax: null,
  });

  const diamondWeight = rangeLabel(
    'Diamond weight',
    filters.diamondWeightMinCt,
    filters.diamondWeightMaxCt,
    'ct',
  );
  add('diamond-weight', diamondWeight, {
    diamondWeightMinCt: null,
    diamondWeightMaxCt: null,
  });

  if (filters.stonePresence === 'has-stones') {
    add('stone-presence', 'Has other stones', { stonePresence: 'any' });
  } else if (filters.stonePresence === 'no-stones') {
    add('stone-presence', 'No other stones', { stonePresence: 'any' });
  }

  const stoneNames = selectedNames(filters.stoneTypeIds, options.stoneTypes);
  add(
    'stone-type',
    stoneNames.length ? `Stone type: ${stoneNames.join(', ')}` : null,
    { stoneTypeIds: [] },
  );

  const stonePieces = rangeLabel(
    'Other stone pieces',
    filters.stonePiecesMin,
    filters.stonePiecesMax,
    'pcs',
  );
  add('stone-pieces', stonePieces, {
    stonePiecesMin: null,
    stonePiecesMax: null,
  });

  const stoneWeight =
    filters.stoneWeightUnit === 'ct' || filters.stoneWeightUnit === 'g'
      ? rangeLabel(
          'Other stone weight',
          filters.stoneWeightMin,
          filters.stoneWeightMax,
          filters.stoneWeightUnit,
        )
      : null;

  add('stone-weight', stoneWeight, {
    stoneWeightUnit: 'ct',
    stoneWeightMin: null,
    stoneWeightMax: null,
  });

  const grossWeight = rangeLabel(
    'Gross weight',
    filters.grossWeightMin,
    filters.grossWeightMax,
    'g',
  );
  add('gross-weight', grossWeight, {
    grossWeightMin: null,
    grossWeightMax: null,
  });

  const netWeight = rangeLabel(
    'Net weight',
    filters.netWeightMin,
    filters.netWeightMax,
    'g',
  );
  add('net-weight', netWeight, {
    netWeightMin: null,
    netWeightMax: null,
  });

  return chips;
}

type Props = {
  filters: InventoryFilterValues;
  options: InventoryFilterOptions;
  onApply: (filters: InventoryFilterValues) => void;
};

type RangeKey =
  | 'grossWeightMin'
  | 'grossWeightMax'
  | 'netWeightMin'
  | 'netWeightMax'
  | 'diamondPiecesMin'
  | 'diamondPiecesMax'
  | 'diamondWeightMinCt'
  | 'diamondWeightMaxCt'
  | 'stonePiecesMin'
  | 'stonePiecesMax'
  | 'stoneWeightMin'
  | 'stoneWeightMax';

function RangeInputs({
  label,
  minKey,
  maxKey,
  unit,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  minKey: RangeKey;
  maxKey: RangeKey;
  unit: string;
  values: InventoryFilterValues;
  onChange: (key: RangeKey, value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`inventory-filter-range${disabled ? ' is-disabled' : ''}`}>
      <span className='inventory-filter-range-label'>{label}</span>
      <div className='inventory-filter-range-inputs'>
        <div className='inventory-filter-range-field'>
          <span className='inventory-filter-range-prefix'>Min</span>
          <input
            type='number'
            min='0'
            step='any'
            aria-label={`${label} minimum`}
            value={values[minKey] ?? ''}
            placeholder='Any'
            disabled={disabled}
            onChange={(event) =>
              onChange(
                minKey,
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          />
        </div>
        <span className='inventory-filter-range-to'>to</span>
        <div className='inventory-filter-range-field'>
          <span className='inventory-filter-range-prefix'>Max</span>
          <input
            type='number'
            min='0'
            step='any'
            aria-label={`${label} maximum`}
            value={values[maxKey] ?? ''}
            placeholder='Any'
            disabled={disabled}
            onChange={(event) =>
              onChange(
                maxKey,
                event.target.value === '' ? null : Number(event.target.value),
              )
            }
          />
        </div>
        <span className='inventory-filter-range-unit'>{unit}</span>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label?: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inventory-filter-segmented-wrap${disabled ? ' is-disabled' : ''}`}
    >
      {label && <span className='inventory-filter-control-label'>{label}</span>}
      <div
        className='inventory-filter-segmented'
        role='group'
        aria-label={label}
      >
        {options.map((option) => (
          <button
            type='button'
            key={option.value}
            disabled={disabled}
            className={value === option.value ? 'is-selected' : ''}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PillOptions({
  label,
  options,
  selectedIds,
  onToggle,
  disabled = false,
}: {
  label: string;
  options: Array<{ id: number; label: string }>;
  selectedIds: number[];
  onToggle: (id: number) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inventory-filter-choice-group${disabled ? ' is-disabled' : ''}`}
    >
      <span className='inventory-filter-control-label'>{label}</span>
      {options.length === 0 ? (
        <p className='inventory-filter-empty'>No options available.</p>
      ) : (
        <div className='inventory-filter-pills'>
          {options.map((option) => (
            <button
              type='button'
              key={option.id}
              disabled={disabled}
              className={`inventory-filter-pill${selectedIds.includes(option.id) ? ' is-selected' : ''}`}
              aria-pressed={selectedIds.includes(option.id)}
              onClick={() => onToggle(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryOptions({
  options,
  selectedIds,
  onToggle,
}: {
  options: Array<{ id: number; label: string }>;
  selectedIds: number[];
  onToggle: (id: number) => void;
}) {
  if (!options.length)
    return <p className='inventory-filter-empty'>No categories available.</p>;
  return (
    <div className='inventory-filter-category-grid'>
      {options.map((option) => (
        <label className='inventory-filter-category-option' key={option.id}>
          <input
            type='checkbox'
            checked={selectedIds.includes(option.id)}
            onChange={() => onToggle(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function FilterSection({
  id,
  title,
  count,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`inventory-filter-section${open ? ' is-open' : ''}`}>
      <button
        type='button'
        className='inventory-filter-section-toggle'
        aria-expanded={open}
        aria-controls={`inventory-filter-${id}`}
        onClick={onToggle}
      >
        <span className='inventory-filter-section-title'>{title}</span>
        {count > 0 && (
          <span className='inventory-filter-section-count'>{count}</span>
        )}
        {summary && (
          <span className='inventory-filter-section-summary'>{summary}</span>
        )}
        <svg
          className='inventory-filter-chevron'
          viewBox='0 0 20 20'
          aria-hidden='true'
        >
          <path d='m5 7.5 5 5 5-5' />
        </svg>
      </button>
      {open && (
        <div
          className='inventory-filter-section-content'
          id={`inventory-filter-${id}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function InventoryFilters({ filters, options, onApply }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<InventoryFilterValues>(
    INITIAL_INVENTORY_FILTERS,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    item: true,
    gold: true,
    diamonds: true,
    stones: true,
    certification: true,
  });

  const activeFilterCount = getActiveInventoryFilterChips(
    filters,
    options,
  ).length;
  const openPanel = () => {
    setDraft({
      ...INITIAL_INVENTORY_FILTERS,
      ...filters,
      stoneWeightUnit: 'ct',
    });
    setExpanded({
      item: true,
      gold: true,
      diamonds: true,
      stones: true,
      certification: true,
    });
    setIsOpen(true);
  };
  const updateDraft = (patch: FilterPatch) =>
    setDraft((current) => ({ ...current, ...patch }));
  const toggleId = (
    key:
      | 'categoryIds'
      | 'purityIds'
      | 'goldTypeIds'
      | 'diamondShapeIds'
      | 'diamondCombinationIds'
      | 'stoneTypeIds',
    id: number,
  ) => {
    const current = (draft[key] ?? []) as number[];
    updateDraft({
      [key]: current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    } as FilterPatch);
  };
  const changeRange = (key: RangeKey, value: number | null) =>
    updateDraft({ [key]: value } as FilterPatch);
  const resetDraft = () =>
    setDraft({ ...INITIAL_INVENTORY_FILTERS, search: filters.search });
  const applyDraft = () =>
    onApply({
      ...draft,
      search: filters.search,
      categoryId: null,
      certification: 'all',
      archiveStatus: 'active',
    });
  const toggleSection = (id: string) =>
    setExpanded((current) => ({ ...current, [id]: !current[id] }));

  const categories = options.categories.map((o) => ({
    id: o.id,
    label: o.name,
  }));
  const purities = options.purities.map((o) => ({ id: o.id, label: o.name }));
  const goldTypes = options.goldTypes.map((o) => ({ id: o.id, label: o.name }));
  const combinationsByShape = options.diamondShapes.map((shape) => ({
    ...shape,
    combinations: options.diamondCombinations.filter(
      (item) => item.shapeId === shape.id,
    ),
  }));
  const stoneTypes = options.stoneTypes.map((o) => ({
    id: o.id,
    label: o.name,
  }));

  const itemCount =
    (draft.categoryIds?.length ?? 0) +
    ((draft.itemStatuses?.length === 1 && draft.itemStatuses[0] !== 'active') ||
    draft.itemStatuses?.length === 0
      ? 1
      : 0);
  const goldCount =
    (draft.purityIds?.length ?? 0) +
    (draft.goldTypeIds?.length ?? 0) +
    (draft.grossWeightMin != null || draft.grossWeightMax != null ? 1 : 0) +
    (draft.netWeightMin != null || draft.netWeightMax != null ? 1 : 0);
  const diamondCount =
    (draft.diamondShapeIds?.length ?? 0) +
    (draft.diamondCombinationIds?.length ?? 0) +
    (draft.diamondPiecesMin != null || draft.diamondPiecesMax != null ? 1 : 0) +
    (draft.diamondWeightMinCt != null || draft.diamondWeightMaxCt != null
      ? 1
      : 0);
  const stoneCount =
    (draft.stonePresence !== 'any' ? 1 : 0) +
    (draft.stoneTypeIds?.length ?? 0) +
    (draft.stonePiecesMin != null || draft.stonePiecesMax != null ? 1 : 0) +
    (draft.stoneWeightMin != null || draft.stoneWeightMax != null ? 1 : 0);
  const certificationCount =
    (draft.certificationStatuses?.length === 1 ? 1 : 0) +
    (draft.huidStatuses?.length === 1 ? 1 : 0);
  const statusValue =
    draft.itemStatuses?.length === 0
      ? 'all'
      : draft.itemStatuses?.includes('archived') &&
          !draft.itemStatuses?.includes('active')
        ? 'archived'
        : 'active';
  const certificationValue =
    draft.certificationStatuses?.length === 1
      ? draft.certificationStatuses[0]
      : 'all';
  const huidValue =
    draft.huidStatuses?.length === 1 ? draft.huidStatuses[0] : 'all';
  const stoneWeightDisabled = draft.stonePresence === 'no-stones';

  return (
    <>
      <button
        type='button'
        className='inventory-toolbar-button'
        onClick={openPanel}
        aria-haspopup='dialog'
        aria-expanded={isOpen}
      >
        <svg viewBox='0 0 24 24' aria-hidden='true'>
          <path d='M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z' />
        </svg>
        <span>Filters</span>
        {activeFilterCount > 0 && (
          <span className='inventory-toolbar-count'>{activeFilterCount}</span>
        )}
      </button>
      <FilterPanel
        isOpen={isOpen}
        title='Filter inventory'
        subtitle={`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} selected`}
        applyLabel={`Show items`}
        onClose={() => setIsOpen(false)}
        onReset={resetDraft}
        onApply={applyDraft}
      >
        <div className='inventory-filter-sections'>
          <FilterSection
            id='item'
            title='Item details'
            count={itemCount}
            open={!!expanded.item}
            onToggle={() => toggleSection('item')}
          >
            <div className='inventory-filter-subgroup'>
              <span className='inventory-filter-control-label'>Category</span>
              <CategoryOptions
                options={categories}
                selectedIds={draft.categoryIds ?? []}
                onToggle={(id) => toggleId('categoryIds', id)}
              />
            </div>
            <Segmented
              label='Item status'
              value={statusValue}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
                { value: 'all', label: 'All' },
              ]}
              onChange={(value) =>
                updateDraft({
                  itemStatuses:
                    value === 'all' ? [] : [value as InventoryItemStatus],
                  archiveStatus: 'all',
                })
              }
            />
          </FilterSection>

          <FilterSection
            id='gold'
            title='Gold'
            count={goldCount}
            open={!!expanded.gold}
            onToggle={() => toggleSection('gold')}
          >
            <PillOptions
              label='Purity'
              options={purities}
              selectedIds={draft.purityIds ?? []}
              onToggle={(id) => toggleId('purityIds', id)}
            />
            <PillOptions
              label='Gold type'
              options={goldTypes}
              selectedIds={draft.goldTypeIds ?? []}
              onToggle={(id) => toggleId('goldTypeIds', id)}
            />
            <RangeInputs
              label='Gross weight'
              minKey='grossWeightMin'
              maxKey='grossWeightMax'
              unit='g'
              values={draft}
              onChange={changeRange}
            />
            <RangeInputs
              label='Net weight'
              minKey='netWeightMin'
              maxKey='netWeightMax'
              unit='g'
              values={draft}
              onChange={changeRange}
            />
          </FilterSection>

          <FilterSection
            id='diamonds'
            title='Diamonds'
            count={diamondCount}
            open={!!expanded.diamonds}
            onToggle={() => toggleSection('diamonds')}
          >
            <div className='inventory-filter-choice-group'>
              <span className='inventory-filter-control-label'>
                Shape and quality
              </span>
              <div className='inventory-filter-diamond-groups'>
                {combinationsByShape.map((shape) => {
                  const shapeSelected = (draft.diamondShapeIds ?? []).includes(
                    shape.id,
                  );
                  return (
                    <div
                      className='inventory-filter-diamond-card'
                      key={shape.id}
                    >
                      <label className='inventory-filter-shape-option'>
                        <input
                          type='checkbox'
                          checked={shapeSelected}
                          onChange={() => toggleId('diamondShapeIds', shape.id)}
                        />
                        <span>{shape.code}</span>
                      </label>
                      {shape.combinations.length > 0 && (
                        <div className='inventory-filter-pills'>
                          {shape.combinations.map((combo) => (
                            <button
                              type='button'
                              key={combo.id}
                              className={`inventory-filter-pill${(draft.diamondCombinationIds ?? []).includes(combo.id) ? ' is-selected' : ''}`}
                              aria-pressed={(
                                draft.diamondCombinationIds ?? []
                              ).includes(combo.id)}
                              onClick={() =>
                                toggleId('diamondCombinationIds', combo.id)
                              }
                            >
                              {combo.quality}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className='inventory-filter-help'>
                Select a shape to include all its qualities, or choose specific
                qualities.
              </p>
            </div>
            <RangeInputs
              label='Total diamond pieces'
              minKey='diamondPiecesMin'
              maxKey='diamondPiecesMax'
              unit='pcs'
              values={draft}
              onChange={changeRange}
            />
            <RangeInputs
              label='Total diamond weight'
              minKey='diamondWeightMinCt'
              maxKey='diamondWeightMaxCt'
              unit='ct'
              values={draft}
              onChange={changeRange}
            />
          </FilterSection>

          <FilterSection
            id='stones'
            title='Other stones'
            count={stoneCount}
            summary={stoneCount === 0 ? 'Any' : undefined}
            open={!!expanded.stones}
            onToggle={() => toggleSection('stones')}
          >
            <Segmented
              label='Other stones'
              value={draft.stonePresence ?? 'any'}
              options={[
                { value: 'any', label: 'Any' },
                { value: 'has-stones', label: 'Has stones' },
                { value: 'no-stones', label: 'No stones' },
              ]}
              onChange={(value) => updateDraft({ stonePresence: value })}
            />
            <PillOptions
              label='Stone type'
              options={stoneTypes}
              selectedIds={draft.stoneTypeIds ?? []}
              onToggle={(id) => toggleId('stoneTypeIds', id)}
              disabled={stoneWeightDisabled}
            />
            <RangeInputs
              label='Total stone pieces'
              minKey='stonePiecesMin'
              maxKey='stonePiecesMax'
              unit='pcs'
              values={draft}
              onChange={changeRange}
              disabled={stoneWeightDisabled}
            />
            <div
              className={`inventory-filter-stone-weight${stoneWeightDisabled ? ' is-disabled' : ''}`}
            >
              <RangeInputs
                label='Total stone weight'
                minKey='stoneWeightMin'
                maxKey='stoneWeightMax'
                unit='ct'
                values={draft}
                onChange={changeRange}
                disabled={stoneWeightDisabled}
              />
            </div>
          </FilterSection>

          <FilterSection
            id='certification'
            title='Certification'
            count={certificationCount}
            open={!!expanded.certification}
            onToggle={() => toggleSection('certification')}
          >
            <Segmented
              label='IGI certificate'
              value={certificationValue}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'certified', label: 'Certified' },
                { value: 'uncertified', label: 'Not certified' },
              ]}
              onChange={(value) =>
                updateDraft({
                  certificationStatuses:
                    value === 'all'
                      ? []
                      : [value as 'certified' | 'uncertified'],
                  certification: 'all',
                })
              }
            />
            <Segmented
              label='HUID'
              value={huidValue}
              options={[
                { value: 'all', label: 'Any' },
                { value: 'present', label: 'Present' },
                { value: 'missing', label: 'Missing' },
              ]}
              onChange={(value) =>
                updateDraft({
                  huidStatuses:
                    value === 'all' ? [] : [value as InventoryHuidStatus],
                })
              }
            />
          </FilterSection>
        </div>
      </FilterPanel>
    </>
  );
}

export default InventoryFilters;
