import { useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getDatabase } from '../../db';
import './AddItemScreen.css';

type Option = {
  id: number;
  name: string;
};

type PurityOption = Option & {
  percent_bp: number;
};

type CategoryOption = Option & {
  sort_order: number;
};

type DiamondShape = {
  id: number;
  code: string;
  name: string;
};

type DiamondCombination = {
  id: number;
  shape_id: number;
  quality: string;
};

type StoneType = {
  id: number;
  name: string;
  tag_label: string;
  weight_unit: string;
};

type DiamondFormRow = {
  shapeId: number;
  code: string;
  name: string;
  combinationId: string;
  pieces: string;
  weight: string;
};

type StoneFormRow = {
  stoneTypeId: number;
  name: string;
  tagLabel: string;
  weightUnit: string;
  pieces: string;
  weight: string;
};

type Preview = {
  category_id: number;
  item_number: string;
};

type CreatedItem = {
  id: number;
  item_number: string;
};

type Props = {
  onCancel: () => void;
  onCreated: (itemNumber: string) => void;
};

function toMilliUnits(value: string, label: string): number {
  if (!value.trim()) return 0;

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a valid, non-negative number.`);
  }

  const milli = Math.round(parsed * 1000);

  if (!Number.isSafeInteger(milli)) {
    throw new Error(`${label} is outside the supported range.`);
  }

  return milli;
}

function toOptionalPieces(value: string, label: string): number | null {
  if (!value.trim()) return null;

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }

  return parsed;
}

type SelectOption = {
  value: string;
  label: string;
};

type StyledSelectProps = {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  ariaLabel?: string;
};

function StyledSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  required = false,
  placeholder,
  ariaLabel,
}: StyledSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );

  useEffect(() => {
    setActiveIndex(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
  }, [value, options]);

  useEffect(() => {
    if (!open) return;

    function handleOutsidePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    return () =>
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
  }, [open]);

  const selectedOption = options.find((option) => option.value === value);
  const listboxId = `${id}-options`;

  function choose(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(
          Math.max(
            0,
            options.findIndex((option) => option.value === value),
          ),
        );
      } else {
        setActiveIndex((current) => Math.min(current + 1, options.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(
          Math.max(
            0,
            options.findIndex((option) => option.value === value),
          ),
        );
      } else {
        setActiveIndex((current) => Math.max(current - 1, 0));
      }
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const firstMatch = options.findIndex((option) =>
        option.label.toLowerCase().startsWith(event.key.toLowerCase()),
      );
      if (firstMatch >= 0) {
        setActiveIndex(firstMatch);
        setOpen(true);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`styled-select${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
    >
      <button
        id={id}
        type='button'
        className='styled-select__trigger'
        role='combobox'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-controls={listboxId}
        aria-required={required}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
        }}
        onKeyDown={handleKeyDown}
        onBlur={(event) => {
          if (
            !event.currentTarget.parentElement?.contains(
              event.relatedTarget as Node | null,
            )
          ) {
            setOpen(false);
          }
        }}
      >
        <span className={!selectedOption ? 'styled-select__placeholder' : ''}>
          {selectedOption?.label ?? placeholder ?? ''}
        </span>
        <svg
          className='styled-select__chevron'
          viewBox='0 0 20 20'
          aria-hidden='true'
        >
          <path d='m5 7.5 5 5 5-5' />
        </svg>
      </button>
      {open && (
        <div
          className='styled-select__menu'
          id={listboxId}
          role='listbox'
          aria-labelledby={id}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const active = index === activeIndex;
            return (
              <button
                key={option.value}
                type='button'
                role='option'
                aria-selected={selected}
                className={[
                  'styled-select__option',
                  selected ? 'is-selected' : '',
                  active ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {selected && (
                  <span className='styled-select__check' aria-hidden='true'>
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddItemScreen({ onCancel, onCreated }: Props) {
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [purities, setPurities] = useState<PurityOption[]>([]);
  const [goldTypes, setGoldTypes] = useState<Option[]>([]);
  const [diamondShapes, setDiamondShapes] = useState<DiamondShape[]>([]);
  const [stoneTypes, setStoneTypes] = useState<StoneType[]>([]);
  const [combinations, setCombinations] = useState<DiamondCombination[]>([]);
  const [diamonds, setDiamonds] = useState<DiamondFormRow[]>([]);
  const [stones, setStones] = useState<StoneFormRow[]>([]);
  const [selectedShapeId, setSelectedShapeId] = useState('');
  const [selectedStoneTypeId, setSelectedStoneTypeId] = useState('');

  const [categoryId, setCategoryId] = useState('');
  const [preview, setPreview] = useState('');
  const [weight, setWeight] = useState('');
  const [purityId, setPurityId] = useState('');
  const [goldTypeId, setGoldTypeId] = useState('');
  const [igiCertificateNumber, setIgiCertificateNumber] = useState('');
  const [huid, setHuid] = useState('');
  const [notes, setNotes] = useState('');
  const [imageSource, setImageSource] = useState('');
  const [imageFileName, setImageFileName] = useState('');

  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const db = await getDatabase();

        const [
          categoryOptions,
          purityOptions,
          shapeOptions,
          combinationOptions,
          stoneOptions,
          goldTypeOptions,
        ] = await Promise.all([
          db.select<CategoryOption[]>(
            `SELECT id, name, sort_order
             FROM category
             WHERE is_archived = 0
             ORDER BY sort_order, name`,
          ),
          db.select<PurityOption[]>(
            `SELECT id, name, percent_bp
             FROM purity
             WHERE is_archived = 0
             ORDER BY CASE WHEN name = '18K' THEN 0 ELSE 1 END, name`,
          ),
          db.select<DiamondShape[]>(
            `SELECT id, code, name
             FROM diamond_shape
             WHERE is_archived = 0
             ORDER BY sort_order, name`,
          ),
          db.select<DiamondCombination[]>(
            `SELECT id, shape_id, quality
             FROM diamond_combination
             WHERE is_archived = 0
             ORDER BY CASE WHEN quality = 'EF-VVS' THEN 0 ELSE 1 END, quality`,
          ),
          db.select<StoneType[]>(
            `SELECT id, name, tag_label, weight_unit
             FROM stone_type
             WHERE is_archived = 0
             ORDER BY sort_order, name`,
          ),
          db.select<Option[]>(
            `SELECT id, name
             FROM gold_type
             WHERE is_archived = 0
             ORDER BY sort_order, name`,
          ),
        ]);

        if (cancelled) return;

        setCategories(categoryOptions);
        setPurities(purityOptions);
        setCombinations(combinationOptions);

        if (categoryOptions.length > 0) {
          setCategoryId(String(categoryOptions[0].id));
        }

        const defaultPurity = purityOptions.find(
          (purity) => purity.name.toUpperCase() === '18K',
        );

        if (defaultPurity) {
          setPurityId(String(defaultPurity.id));
        }

        setDiamondShapes(shapeOptions);
        setStoneTypes(stoneOptions);

        setGoldTypes(goldTypeOptions);
        setGoldTypeId(
          goldTypeOptions.length > 0 ? String(goldTypeOptions[0].id) : '',
        );
      } catch (err) {
        if (!cancelled) {
          setError(`Could not load jewelry options: ${String(err)}`);
        }
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setPreview('');

      if (!categoryId) return;

      try {
        const result = await invoke<Preview>('preview_item_number', {
          categoryId: Number(categoryId),
        });

        if (!cancelled) {
          setPreview(result.item_number);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Could not preview item number: ${String(err)}`);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  function updateDiamond(
    shapeId: number,
    field: 'combinationId' | 'pieces' | 'weight',
    value: string,
  ) {
    setDiamonds((current) =>
      current.map((diamond) =>
        diamond.shapeId === shapeId ? { ...diamond, [field]: value } : diamond,
      ),
    );
  }

  function updateStone(
    stoneTypeId: number,
    field: 'pieces' | 'weight',
    value: string,
  ) {
    setStones((current) =>
      current.map((stone) =>
        stone.stoneTypeId === stoneTypeId
          ? { ...stone, [field]: value }
          : stone,
      ),
    );
  }

  function addDiamondRow() {
    const shape = diamondShapes.find(
      (option) => String(option.id) === selectedShapeId,
    );
    if (!shape || diamonds.some((diamond) => diamond.shapeId === shape.id))
      return;

    const defaultCombination = combinations.find(
      (combination) =>
        combination.shape_id === shape.id && combination.quality === 'EF-VVS',
    );

    setDiamonds((current) => [
      ...current,
      {
        shapeId: shape.id,
        code: shape.code,
        name: shape.name,
        combinationId: defaultCombination ? String(defaultCombination.id) : '',
        pieces: '',
        weight: '',
      },
    ]);
    setSelectedShapeId('');
  }

  function addStoneRow() {
    const stone = stoneTypes.find(
      (option) => String(option.id) === selectedStoneTypeId,
    );
    if (!stone || stones.some((row) => row.stoneTypeId === stone.id)) return;

    setStones((current) => [
      ...current,
      {
        stoneTypeId: stone.id,
        name: stone.name,
        tagLabel: stone.tag_label,
        weightUnit: stone.weight_unit,
        pieces: '',
        weight: '',
      },
    ]);
    setSelectedStoneTypeId('');
  }

  async function chooseImage() {
    setError(null);

    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Jewelry images',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
          },
        ],
      });

      if (typeof selected === 'string') {
        await invoke('allow_image_preview', { path: selected });

        setImageSource(selected);
        setImageFileName(selected.split(/[\\/]/).pop() || selected);
      }
    } catch (err) {
      setError(`Could not select image: ${String(err)}`);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!categoryId) {
      setError('Please select a category.');
      return;
    }

    if (!weight.trim()) {
      setError('Gross weight is required.');
      return;
    }

    if (!imageSource) {
      setError('Please choose a design image before saving.');
      return;
    }

    if (!preview) {
      setError('Wait for the item number preview before saving.');
      return;
    }

    if (
      !goldTypeId ||
      !goldTypes.some((goldType) => String(goldType.id) === goldTypeId)
    ) {
      setError('Please select a valid gold type.');
      return;
    }

    const incompleteDiamond = diamonds.find(
      (diamond) => !diamond.pieces.trim() || !diamond.weight.trim(),
    );
    if (incompleteDiamond) {
      setError(
        `Enter both pieces and weight for ${incompleteDiamond.name}, or remove that row.`,
      );
      return;
    }

    const incompleteStone = stones.find(
      (stone) => !stone.pieces.trim() || !stone.weight.trim(),
    );
    if (incompleteStone) {
      setError(
        `Enter both pieces and weight for ${incompleteStone.name}, or remove that row.`,
      );
      return;
    }

    const normalizedHuid = huid.trim().toUpperCase();

    if (normalizedHuid && !/^[A-Z0-9]{6}$/.test(normalizedHuid)) {
      setError('HUID must contain exactly six letters or numbers.');
      return;
    }

    setSaving(true);

    try {
      const grossWeightMilli = toMilliUnits(weight, 'Gross gold weight');

      const diamondPayload = diamonds.flatMap((diamond) => {
        const pieces = toOptionalPieces(
          diamond.pieces,
          `${diamond.name} pieces`,
        );

        return [
          {
            shapeId: diamond.shapeId,
            combinationId: diamond.combinationId
              ? Number(diamond.combinationId)
              : null,
            pieces,
            weightMilli: toMilliUnits(
              diamond.weight,
              `${diamond.name} carat weight`,
            ),
          },
        ];
      });

      const stonePayload = stones.map((stone) => ({
        stoneTypeId: stone.stoneTypeId,
        pieces: toOptionalPieces(stone.pieces, `${stone.name} pieces`),
        weightMilli: toMilliUnits(stone.weight, `${stone.name} weight`),
      }));

      const result = await invoke<CreatedItem>('create_item', {
        categoryId: Number(categoryId),
        name: null,
        grossWeightMilli,
        purityId: purityId ? Number(purityId) : null,
        goldTypeId: Number(goldTypeId),
        igiCertificateNumber: igiCertificateNumber.trim() || null,
        huid: normalizedHuid || null,
        notes: notes.trim() || null,
        imageSource: imageSource || null,
        diamonds: diamondPayload,
        stones: stonePayload,
      });

      onCreated(result.item_number);
    } catch (err) {
      setError(`Could not save item: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  if (loadingOptions) {
    return <p className='add-item-status'>Loading jewelry options...</p>;
  }

  const completeDiamonds = diamonds.filter(
    (row) => row.pieces.trim() !== '' && row.weight.trim() !== '',
  );
  const completeStones = stones.filter(
    (row) => row.pieces.trim() !== '' && row.weight.trim() !== '',
  );
  const totalDiamondPieces = completeDiamonds.reduce(
    (sum, row) => sum + (Number(row.pieces) || 0),
    0,
  );
  const totalDiamondWeight = completeDiamonds.reduce(
    (sum, row) => sum + (Number(row.weight) || 0),
    0,
  );
  const totalStonePieces = completeStones.reduce(
    (sum, row) => sum + (Number(row.pieces) || 0),
    0,
  );
  const totalStoneWeight = completeStones.reduce(
    (sum, row) => sum + (Number(row.weight) || 0),
    0,
  );

  return (
    <section className='add-item-screen'>
      <div className='add-item-heading'>
        <div>
          <button
            type='button'
            className='add-item-back-link'
            onClick={onCancel}
            disabled={saving}
          >
            ← Inventory
          </button>
          <h2 className='app-page-title'>Add jewelry item</h2>
          <p className='app-page-description'>
            Register a new design. The item number is generated from the
            category.
          </p>
        </div>
        <button
          type='button'
          className='app-button app-button--secondary'
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div className='add-item-error' role='alert'>
          {error}
        </div>
      )}

      {categories.length === 0 ? (
        <div className='add-item-card'>
          No active categories found. Check your database configuration.
        </div>
      ) : (
        <form className='add-item-form' onSubmit={handleSubmit}>
          <div className='add-item-layout'>
            <div className='add-item-main-column'>
              <section className='add-item-card add-item-section-card'>
                <div>
                  <h3 className='add-item-section-title'>Basic details</h3>
                  <p className='add-item-section-description'>
                    Core attributes used on tags and in reports.
                  </p>
                </div>
                <div className='add-item-grid add-item-basic-grid'>
                  <div className='add-item-field add-item-field--full'>
                    <label htmlFor='item-category'>Category</label>
                    <StyledSelect
                      id='item-category'
                      value={categoryId}
                      options={categories.map((category) => ({
                        value: String(category.id),
                        label: category.name,
                      }))}
                      onChange={setCategoryId}
                      required
                      disabled={saving}
                      ariaLabel='Category'
                    />
                  </div>
                  <div className='add-item-field add-item-field--half'>
                    <label htmlFor='item-weight'>Gross weight (g)</label>
                    <input
                      id='item-weight'
                      className='app-input add-item-number-input'
                      type='number'
                      min='0'
                      step='0.001'
                      required
                      value={weight}
                      onChange={(event) => setWeight(event.target.value)}
                      onWheel={(event) => event.currentTarget.blur()}
                      placeholder='e.g. 4.250'
                      disabled={saving}
                    />
                  </div>
                  <div className='add-item-field'>
                    <label htmlFor='item-purity'>Purity</label>
                    <StyledSelect
                      id='item-purity'
                      value={purityId}
                      options={[
                        { value: '', label: 'Not specified' },
                        ...purities.map((purity) => ({
                          value: String(purity.id),
                          label: purity.name,
                        })),
                      ]}
                      onChange={setPurityId}
                      disabled={saving}
                      ariaLabel='Gold purity'
                    />
                  </div>
                  <div className='add-item-field'>
                    <label htmlFor='item-gold-type'>Gold type</label>
                    <StyledSelect
                      id='item-gold-type'
                      value={goldTypeId}
                      options={goldTypes.map((goldType) => ({
                        value: String(goldType.id),
                        label: goldType.name,
                      }))}
                      onChange={setGoldTypeId}
                      disabled={saving || goldTypes.length === 0}
                      required
                      ariaLabel='Gold type'
                    />
                  </div>
                  <div className='add-item-field'>
                    <label htmlFor='item-igi-certificate'>
                      Diamond certification
                    </label>
                    <input
                      id='item-igi-certificate'
                      className='app-input'
                      value={igiCertificateNumber}
                      onChange={(event) =>
                        setIgiCertificateNumber(event.target.value)
                      }
                      placeholder='e.g. IGI report number'
                      maxLength={100}
                      disabled={saving}
                    />
                  </div>
                  <div className='add-item-field'>
                    <label htmlFor='item-huid'>HUID</label>
                    <input
                      id='item-huid'
                      className='app-input'
                      value={huid}
                      onChange={(event) =>
                        setHuid(event.target.value.toUpperCase().slice(0, 6))
                      }
                      placeholder='Six characters'
                      maxLength={6}
                      autoCapitalize='characters'
                      disabled={saving}
                    />
                  </div>
                </div>
              </section>

              <section className='add-item-card add-item-section-card'>
                <div>
                  <h3 className='add-item-section-title'>Diamonds</h3>
                  <p className='add-item-section-description'>
                    Add details for the diamond shapes present in this design.
                  </p>
                </div>
                <div className='add-item-detail-list'>
                  {diamonds.length > 0 && (
                    <>
                      <div className='add-item-table-heading add-item-diamond-row'>
                        <span>Shape</span>
                        <span>Pieces</span>
                        <span>Weight (ct)</span>
                        <span>Quality</span>
                        <span aria-hidden='true'></span>
                      </div>
                      {diamonds.map((diamond) => {
                        const shapeCombinations = combinations.filter(
                          (combination) =>
                            combination.shape_id === diamond.shapeId,
                        );
                        return (
                          <div
                            className='add-item-detail-row add-item-diamond-row'
                            key={diamond.shapeId}
                          >
                            <div className='add-item-detail-name'>
                              <strong>{diamond.name}</strong>
                              <span>{diamond.code}</span>
                            </div>
                            <div className='add-item-field'>
                              <label
                                htmlFor={`diamond-pieces-${diamond.shapeId}`}
                              >
                                Pieces
                              </label>
                              <input
                                id={`diamond-pieces-${diamond.shapeId}`}
                                className='app-input add-item-number-input'
                                type='number'
                                min='0'
                                step='1'
                                value={diamond.pieces}
                                onChange={(event) =>
                                  updateDiamond(
                                    diamond.shapeId,
                                    'pieces',
                                    event.target.value,
                                  )
                                }
                                onWheel={(event) => event.currentTarget.blur()}
                                placeholder='—'
                                disabled={saving}
                              />
                            </div>
                            <div className='add-item-field'>
                              <label
                                htmlFor={`diamond-weight-${diamond.shapeId}`}
                              >
                                Weight (ct)
                              </label>
                              <input
                                id={`diamond-weight-${diamond.shapeId}`}
                                className='app-input add-item-number-input'
                                type='number'
                                min='0'
                                step='0.001'
                                value={diamond.weight}
                                onChange={(event) =>
                                  updateDiamond(
                                    diamond.shapeId,
                                    'weight',
                                    event.target.value,
                                  )
                                }
                                onWheel={(event) => event.currentTarget.blur()}
                                placeholder='—'
                                disabled={saving}
                              />
                            </div>
                            <div className='add-item-field'>
                              <label
                                htmlFor={`diamond-quality-${diamond.shapeId}`}
                              >
                                Quality
                              </label>
                              <StyledSelect
                                id={`diamond-quality-${diamond.shapeId}`}
                                value={diamond.combinationId}
                                options={[
                                  { value: '', label: 'Not specified' },
                                  ...shapeCombinations.map((combination) => ({
                                    value: String(combination.id),
                                    label: combination.quality,
                                  })),
                                ]}
                                onChange={(value) =>
                                  updateDiamond(
                                    diamond.shapeId,
                                    'combinationId',
                                    value,
                                  )
                                }
                                disabled={saving}
                                ariaLabel={`${diamond.name} quality`}
                              />
                            </div>
                            <button
                              type='button'
                              className='add-item-remove-row'
                              onClick={() =>
                                setDiamonds((current) =>
                                  current.filter(
                                    (row) => row.shapeId !== diamond.shapeId,
                                  ),
                                )
                              }
                              disabled={saving}
                              aria-label={`Remove ${diamond.name}`}
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div className='add-item-add-row'>
                    <div className='add-item-add-row-select'>
                      <StyledSelect
                        id='add-diamond-shape'
                        value={selectedShapeId}
                        options={diamondShapes
                          .filter(
                            (shape) =>
                              !diamonds.some((row) => row.shapeId === shape.id),
                          )
                          .map((shape) => ({
                            value: String(shape.id),
                            label: shape.name,
                          }))}
                        onChange={setSelectedShapeId}
                        placeholder='Select a shape...'
                        disabled={
                          saving ||
                          diamondShapes.every((shape) =>
                            diamonds.some((row) => row.shapeId === shape.id),
                          )
                        }
                        ariaLabel='Select a diamond shape to add'
                      />
                    </div>
                    <button
                      type='button'
                      className='app-button app-button--secondary add-item-add-button'
                      onClick={addDiamondRow}
                      disabled={saving || !selectedShapeId}
                    >
                      + Add shape
                    </button>
                  </div>
                </div>
              </section>

              <section className='add-item-card add-item-section-card'>
                <div>
                  <h3 className='add-item-section-title'>Other stones</h3>
                  <p className='add-item-section-description'>
                    Pearls / Moti are included here.
                  </p>
                </div>
                <div className='add-item-detail-list'>
                  {stones.length > 0 && (
                    <>
                      <div className='add-item-table-heading add-item-stone-row'>
                        <span>Stone</span>
                        <span>Pieces</span>
                        <span>Weight (ct)</span>
                        <span aria-hidden='true'></span>
                      </div>
                      {stones.map((stone) => (
                        <div
                          className='add-item-detail-row add-item-stone-row'
                          key={stone.stoneTypeId}
                        >
                          <div className='add-item-detail-name'>
                            <strong>{stone.name}</strong>
                            <span>Tag: {stone.tagLabel}</span>
                          </div>
                          <div className='add-item-field'>
                            <label
                              htmlFor={`stone-pieces-${stone.stoneTypeId}`}
                            >
                              Pieces
                            </label>
                            <input
                              id={`stone-pieces-${stone.stoneTypeId}`}
                              className='app-input add-item-number-input'
                              type='number'
                              min='0'
                              step='1'
                              value={stone.pieces}
                              onChange={(event) =>
                                updateStone(
                                  stone.stoneTypeId,
                                  'pieces',
                                  event.target.value,
                                )
                              }
                              onWheel={(event) => event.currentTarget.blur()}
                              placeholder='—'
                              disabled={saving}
                            />
                          </div>
                          <div className='add-item-field'>
                            <label
                              htmlFor={`stone-weight-${stone.stoneTypeId}`}
                            >
                              Weight ({stone.weightUnit})
                            </label>
                            <input
                              id={`stone-weight-${stone.stoneTypeId}`}
                              className='app-input add-item-number-input'
                              type='number'
                              min='0'
                              step='0.001'
                              value={stone.weight}
                              onChange={(event) =>
                                updateStone(
                                  stone.stoneTypeId,
                                  'weight',
                                  event.target.value,
                                )
                              }
                              onWheel={(event) => event.currentTarget.blur()}
                              placeholder='—'
                              disabled={saving}
                            />
                          </div>
                          <button
                            type='button'
                            className='add-item-remove-row'
                            onClick={() =>
                              setStones((current) =>
                                current.filter(
                                  (row) =>
                                    row.stoneTypeId !== stone.stoneTypeId,
                                ),
                              )
                            }
                            disabled={saving}
                            aria-label={`Remove ${stone.name}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                  <div className='add-item-add-row'>
                    <div className='add-item-add-row-select'>
                      <StyledSelect
                        id='add-stone-type'
                        value={selectedStoneTypeId}
                        options={stoneTypes
                          .filter(
                            (stone) =>
                              !stones.some(
                                (row) => row.stoneTypeId === stone.id,
                              ),
                          )
                          .map((stone) => ({
                            value: String(stone.id),
                            label: stone.name,
                          }))}
                        onChange={setSelectedStoneTypeId}
                        placeholder='Select a stone...'
                        disabled={
                          saving ||
                          stoneTypes.every((stone) =>
                            stones.some((row) => row.stoneTypeId === stone.id),
                          )
                        }
                        ariaLabel='Select a stone type to add'
                      />
                    </div>
                    <button
                      type='button'
                      className='app-button app-button--secondary add-item-add-button'
                      onClick={addStoneRow}
                      disabled={saving || !selectedStoneTypeId}
                    >
                      + Add stone
                    </button>
                  </div>
                </div>
              </section>

              <section className='add-item-card add-item-section-card'>
                <h3 className='add-item-section-title'>Additional notes</h3>
                <div className='add-item-field add-item-notes'>
                  <label htmlFor='item-notes'>Notes (optional)</label>
                  <textarea
                    id='item-notes'
                    className='app-input'
                    rows={4}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder='Setting style, clasp type, finish, anything the tag does not cover...'
                    disabled={saving}
                  />
                </div>
              </section>
            </div>

            <aside className='add-item-sidebar'>
              <div className='add-item-number'>
                <span>NEXT ITEM NUMBER</span>
                <strong>{preview || 'Loading...'}</strong>
                <small>
                  Reserved when you save. Changes if you switch category.
                </small>
              </div>
              <div className='add-item-card add-item-image-card'>
                <label className='add-item-image-label'>
                  Design image <span aria-hidden='true'>*</span>
                </label>
                <div
                  className={`add-item-image-dropzone${imageSource ? ' has-image' : ''}`}
                >
                  {imageSource ? (
                    <>
                      <div className='add-item-image-preview'>
                        <img
                          src={convertFileSrc(imageSource.replace(/\\/g, '/'))}
                          alt={imageFileName || 'Jewelry design preview'}
                          className='add-item-image-preview__img'
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                            const fallback =
                              event.currentTarget.parentElement?.querySelector(
                                '.add-item-image-preview__fallback',
                              );
                            if (fallback)
                              fallback.textContent =
                                'Image preview unavailable. Check Tauri asset permissions.';
                          }}
                        />
                        <div
                          className='add-item-image-preview__fallback'
                          aria-live='polite'
                        ></div>
                      </div>
                      {imageFileName && (
                        <div
                          className='add-item-image-name'
                          title={imageFileName}
                        >
                          {imageFileName}
                        </div>
                      )}
                      <div className='add-item-image-actions'>
                        <button
                          type='button'
                          className='app-button app-button--secondary'
                          onClick={() => void chooseImage()}
                          disabled={saving}
                        >
                          Change image
                        </button>
                        <button
                          type='button'
                          className='add-item-remove-image'
                          onClick={() => {
                            setImageSource('');
                            setImageFileName('');
                          }}
                          disabled={saving}
                        >
                          Remove image
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className='add-item-image-icon' aria-hidden='true'>
                        ◇
                      </div>
                      <button
                        type='button'
                        className='app-button app-button--secondary'
                        onClick={() => void chooseImage()}
                        disabled={saving}
                      >
                        Choose image
                      </button>
                      <small>
                        JPG, PNG, WebP, HEIC or HEIF. One per design.
                      </small>
                    </>
                  )}
                </div>
              </div>
              <div className='add-item-card add-item-summary'>
                <h3 className='add-item-section-title'>Summary</h3>
                <div>
                  <span>Gross weight</span>
                  <strong>
                    {weight.trim() ? `${Number(weight).toFixed(3)} g` : '—'}
                  </strong>
                </div>
                <div>
                  <span>Diamonds</span>
                  <strong>
                    {totalDiamondPieces} pcs · {totalDiamondWeight.toFixed(3)}{' '}
                    ct
                  </strong>
                </div>
                <div>
                  <span>Other stones</span>
                  <strong>
                    {totalStonePieces} pcs · {totalStoneWeight.toFixed(3)} total
                  </strong>
                </div>
                <div>
                  <span>IGI</span>
                  <strong
                    className={
                      igiCertificateNumber.trim()
                        ? 'summary-ok'
                        : 'summary-missing'
                    }
                  >
                    {igiCertificateNumber.trim() ? '✓' : '×'}
                  </strong>
                </div>
                <div>
                  <span>HUID</span>
                  <strong
                    className={huid.trim() ? 'summary-ok' : 'summary-missing'}
                  >
                    {huid.trim() ? '✓' : '×'}
                  </strong>
                </div>
              </div>
              <button
                type='submit'
                className='app-button app-button--primary add-item-save-button'
                disabled={saving || !preview}
              >
                {saving ? 'Saving jewelry item...' : 'Save jewelry item'}
              </button>
              <button
                type='button'
                className='add-item-cancel-link'
                onClick={onCancel}
                disabled={saving}
              >
                Cancel
              </button>
            </aside>
          </div>
        </form>
      )}
    </section>
  );
}

export default AddItemScreen;
