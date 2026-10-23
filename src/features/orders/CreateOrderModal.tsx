import { useEffect, useMemo, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { getDatabase } from '../../db';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  createConfirmedOrder,
  getCreateOrderCustomers,
  getCreateOrderExhibitions,
  searchCreateOrderInventory,
  searchCreateOrderSelectionItems,
  getOrderPricingContext,
  type OrderPricingContext,
  type CreateOrderCustomer,
  type CreateOrderExhibition,
  type CreateOrderInventoryItem,
} from './createOrder.queries';
import './CreateOrderModal.css';
import {
  calculateItemPrice,
  type PricingRates,
  type PricingItem,
} from './orderPricing';

interface Props {
  onClose: () => void;
  onCreated: (orderId: number) => void;
  initialCustomerId?: number;
  initialExhibitionId?: number;
  initialItems?: {
    inventoryItemId: number;
    selectionItemId: number;
    itemNumber?: string;
  }[];
}

type CustomItemOverrides = Partial<PricingRates> & {
  purityPercentBp?: number;
  extraCostPaise?: number;
};

type CustomRateDraft = {
  goldRate: string;
  wastageMode: 'percent' | 'per_g';
  wastagePercent: string;
  wastagePerGram: string;
  certification: string;
  gst: string;
  diamondRates: Record<string, string>;
  stoneRates: Record<string, string>;
  purityByItem: Record<number, string>;
  extraCost: string;
};

interface SelectedItem {
  item: CreateOrderInventoryItem;
  price: string;
  selectionItemId?: number | null;
  directPrice?: boolean;
  pricingSource?: 'direct' | 'global' | 'custom';
}

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; code?: unknown };
    if (typeof details.message === 'string' && details.message.trim()) {
      return details.message;
    }
    if (typeof details.code === 'string' && details.code.trim()) {
      return details.code;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Use the fallback if the thrown value cannot be serialized.
    }
  }

  return fallback;
}

function formatWeight(milli: number | null) {
  return milli === null ? '—' : `${(milli / 1000).toFixed(3)} g`;
}

function formatDetailLines(value: string | null | undefined) {
  return value?.trim() ? value : '—';
}

function formatDetailTotal(
  items: SelectedItem[],
  detailKey: 'diamondDetails' | 'stoneDetails',
) {
  let totalCarats = 0;
  let totalPieces = 0;
  let hasDetails = false;

  for (const selected of items) {
    const details = selected.item[detailKey];
    if (!details?.trim()) continue;

    const matches = details.matchAll(/([\d.]+)\s*ct\s*\((\d+)\s*pcs?\)/gi);

    for (const match of matches) {
      totalCarats += Number(match[1]);
      totalPieces += Number(match[2]);
      hasDetails = true;
    }
  }

  return hasDetails ? `${totalCarats.toFixed(3)} ct (${totalPieces} pcs)` : '—';
}

function ItemThumbnail({
  path,
  alt,
}: {
  path: string | null | undefined;
  alt: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!path) return;

    void (async () => {
      try {
        const imagePath = await join(await appDataDir(), path);
        await invoke('allow_image_preview', { path: imagePath });
        if (!cancelled) setSrc(convertFileSrc(imagePath));
      } catch (imageError) {
        console.error('Could not load jewelry thumbnail:', imageError);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path]);

  return src ? (
    <img className='create-order-item-thumbnail' src={src} alt={alt} />
  ) : (
    <span
      className='create-order-item-thumbnail create-order-item-thumbnail--empty'
      aria-hidden='true'
    >
      ◇
    </span>
  );
}


export default function CreateOrderModal({
  onClose,
  onCreated,
  initialCustomerId,
  initialExhibitionId,
  initialItems = [],
}: Props) {
  const [customers, setCustomers] = useState<CreateOrderCustomer[]>([]);
  const [exhibitions, setExhibitions] = useState<CreateOrderExhibition[]>([]);
  const [inventory, setInventory] = useState<CreateOrderInventoryItem[]>([]);
  const [orderType, setOrderType] = useState<'exhibition' | 'direct' | ''>('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedExhibitionId, setSelectedExhibitionId] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [exhibitionSearch, setExhibitionSearch] = useState('');
  const [exhibitionCustomerIds, setExhibitionCustomerIds] = useState<number[] | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [showMoreItems, setShowMoreItems] = useState(false);
  const [additionalSelectedIds, setAdditionalSelectedIds] = useState<number[]>(
    [],
  );
  const [notes, setNotes] = useState('');
  const [roundOffFinalTotal, setRoundOffFinalTotal] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhibitionDropdownOpen, setExhibitionDropdownOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(initialItems.length ? 2 : 1);
  const [reviewReady, setReviewReady] = useState(false);

  // Prevent an immediate submission while the Pricing step transitions to Full Review.
  useEffect(() => {
    if (step !== 4) {
      setReviewReady(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setReviewReady(true), 600);
    return () => window.clearTimeout(timeoutId);
  }, [step]);
  const [pricingContext, setPricingContext] =
    useState<OrderPricingContext | null>(null);
  const [customizeSelected, setCustomizeSelected] = useState<number[]>([]);
  const [showCustomRates, setShowCustomRates] = useState(false);
  const [customRatesByItem, setCustomRatesByItem] = useState<
    Record<number, CustomItemOverrides>
  >({});
  const [customRateDraft, setCustomRateDraft] =
    useState<CustomRateDraft | null>(null);
  const [customRateDirty, setCustomRateDirty] = useState<string[]>([]);
  const [customRateHasMixedValues, setCustomRateHasMixedValues] =
    useState(false);

  function effectiveRatesForItem(
    itemId: number,
    baseRates = pricingContext?.rates,
  ): PricingRates | null {
    if (!baseRates) return null;
    const override = customRatesByItem[itemId];
    return {
      ...baseRates,
      ...(override || {}),
      diamondRatesPaisePerCarat: {
        ...baseRates.diamondRatesPaisePerCarat,
        ...(override?.diamondRatesPaisePerCarat || {}),
      },
      stoneRatesPaisePerUnit: {
        ...baseRates.stoneRatesPaisePerUnit,
        ...(override?.stoneRatesPaisePerUnit || {}),
      },
    } as PricingRates;
  }

  function openCustomRates() {
    if (!pricingContext || !customizeSelected.length) return;
    const ids = customizeSelected.filter((id) =>
      selectedItems.some((item) => item.item.id === id),
    );
    if (!ids.length) return;
    const sources = ids
      .map((id) =>
        pricingContext.items.find((item) => item.inventoryItemId === id),
      )
      .filter(
        (source): source is NonNullable<typeof source> => source !== undefined,
      );
    const effective = ids
      .map((id) => effectiveRatesForItem(id))
      .filter(Boolean) as PricingRates[];
    const common = (values: (string | number)[]) =>
      values.every((value) => String(value) === String(values[0]))
        ? String(values[0] ?? '')
        : '';
    const diamondKeySet = new Set<string>();
    const stoneKeySet = new Set<string>();
    sources.forEach((source) => {
      source.diamonds.forEach((diamond) =>
        diamondKeySet.add(String(diamond.combinationId ?? diamond.shapeId)),
      );
      source.stones.forEach((stone) =>
        stoneKeySet.add(String(stone.stoneTypeId)),
      );
    });
    const diamondKeys = [...diamondKeySet];
    const stoneKeys = [...stoneKeySet];
    const purityByItem: Record<number, string> = {};
    ids.forEach((id) => {
      const source = pricingContext.items.find(
        (item) => item.inventoryItemId === id,
      );
      purityByItem[id] = (
        (customRatesByItem[id]?.purityPercentBp ??
          source?.purityPercentBp ??
          10000) / 100
      ).toString();
    });
    const diamondRates: Record<string, string> = {};
    diamondKeys.forEach(
      (key) =>
        (diamondRates[key] = common(
          effective
            .map((rates) => rates.diamondRatesPaisePerCarat[key] ?? 0)
            .map((value) => value / 100),
        )),
    );
    const stoneRates: Record<string, string> = {};
    stoneKeys.forEach(
      (key) =>
        (stoneRates[key] = common(
          effective
            .map((rates) => rates.stoneRatesPaisePerUnit[key] ?? 0)
            .map((value) => value / 100),
        )),
    );
    const hasMixed = (values: unknown[]) =>
      values.some((value) => String(value) !== String(values[0]));
    const hasMixedValues =
      hasMixed(effective.map((rates) => rates.goldRatePaisePerGram)) ||
      hasMixed(effective.map((rates) => rates.wastageMode)) ||
      hasMixed(effective.map((rates) => rates.wastagePercentBp)) ||
      hasMixed(effective.map((rates) => rates.wastagePaisePerGram)) ||
      hasMixed(effective.map((rates) => rates.certificationPaisePerCarat)) ||
      hasMixed(effective.map((rates) => rates.gstRateBp)) ||
      hasMixed(ids.map((id) => customRatesByItem[id]?.extraCostPaise ?? 0)) ||
      diamondKeys.some((key) =>
        hasMixed(
          effective.map((rates) => rates.diamondRatesPaisePerCarat[key] ?? 0),
        ),
      ) ||
      stoneKeys.some((key) =>
        hasMixed(
          effective.map((rates) => rates.stoneRatesPaisePerUnit[key] ?? 0),
        ),
      );
    setCustomRateHasMixedValues(hasMixedValues);
    setCustomRateDraft({
      goldRate: common(
        effective.map((rates) => rates.goldRatePaisePerGram / 100),
      ),
      wastageMode:
        effective[0]?.wastageMode || pricingContext.rates.wastageMode,
      wastagePercent: common(
        effective.map((rates) => rates.wastagePercentBp / 100),
      ),
      wastagePerGram: common(
        effective.map((rates) => rates.wastagePaisePerGram / 100),
      ),
      certification: common(
        effective.map((rates) => rates.certificationPaisePerCarat / 100),
      ),
      gst: common(effective.map((rates) => rates.gstRateBp / 100)),
      diamondRates,
      stoneRates,
      purityByItem,
      extraCost: common(
        ids.map((id) => (customRatesByItem[id]?.extraCostPaise ?? 0) / 100),
      ),
    });
    setCustomRateDirty([]);
    setShowCustomRates(true);
  }

  function changeCustomDraft(key: string, value: string) {
    if (
      key !== 'wastageMode' &&
      value !== '' &&
      (!/^\d*\.?\d*$/.test(value) || Number(value) < 0)
    )
      return;
    setCustomRateDraft((current) =>
      current ? ({ ...current, [key]: value } as CustomRateDraft) : current,
    );
    setCustomRateDirty((current) =>
      current.includes(key) ? current : [...current, key],
    );
  }

  function applyCustomRates() {
    if (!pricingContext || !customRateDraft || !customizeSelected.length)
      return;
    const nextOverrides: Record<number, CustomItemOverrides> = {
      ...customRatesByItem,
    };
    const parseAmount = (value: string) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    };
    const parsePercent = (value: string) => {
      const parsed = Number(value || 0);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
    };
    for (const id of customizeSelected) {
      const current: CustomItemOverrides = { ...(nextOverrides[id] || {}) };
      for (const dirty of customRateDirty) {
        if (dirty === 'goldRate')
          current.goldRatePaisePerGram = parseAmount(customRateDraft.goldRate);
        else if (dirty === 'wastageMode')
          current.wastageMode = customRateDraft.wastageMode;
        else if (dirty === 'wastagePercent')
          current.wastagePercentBp = parsePercent(
            customRateDraft.wastagePercent,
          );
        else if (dirty === 'wastagePerGram')
          current.wastagePaisePerGram = parseAmount(
            customRateDraft.wastagePerGram,
          );
        else if (dirty === 'certification')
          current.certificationPaisePerCarat = parseAmount(
            customRateDraft.certification,
          );
        else if (dirty === 'gst')
          current.gstRateBp = parsePercent(customRateDraft.gst);
        else if (dirty.startsWith('diamond:')) {
          const key = dirty.slice('diamond:'.length);
          current.diamondRatesPaisePerCarat = {
            ...(current.diamondRatesPaisePerCarat || {}),
            [key]: parseAmount(customRateDraft.diamondRates[key] ?? ''),
          };
        } else if (dirty.startsWith('stone:')) {
          const key = dirty.slice('stone:'.length);
          current.stoneRatesPaisePerUnit = {
            ...(current.stoneRatesPaisePerUnit || {}),
            [key]: parseAmount(customRateDraft.stoneRates[key] ?? ''),
          };
        } else if (dirty === 'extraCost')
          current.extraCostPaise = parseAmount(customRateDraft.extraCost);
        else if (dirty.startsWith('purity:')) {
          const purityKey = dirty.slice('purity:'.length);
          const source = pricingContext.items.find(
            (item) => item.inventoryItemId === id,
          );
          const sourcePurityKey =
            (source?.purityName || 'Purity not specified').trim() ||
            'Purity not specified';
          if (sourcePurityKey === purityKey)
            current.purityPercentBp = parsePercent(
              customRateDraft.purityByItem[id] ?? '',
            );
        }
      }
      nextOverrides[id] = current;
    }
    setCustomRatesByItem(nextOverrides);
    setSelectedItems((current) =>
      current.map((selected) => {
        if (
          !customizeSelected.includes(selected.item.id) ||
          selected.directPrice
        )
          return selected;
        const source = pricingContext.items.find(
          (item) => item.inventoryItemId === selected.item.id,
        );
        if (!source) return selected;
        const override = nextOverrides[selected.item.id] || {};
        const rates = {
          ...pricingContext.rates,
          ...override,
          diamondRatesPaisePerCarat: {
            ...pricingContext.rates.diamondRatesPaisePerCarat,
            ...(override.diamondRatesPaisePerCarat || {}),
          },
          stoneRatesPaisePerUnit: {
            ...pricingContext.rates.stoneRatesPaisePerUnit,
            ...(override.stoneRatesPaisePerUnit || {}),
          },
        } as PricingRates;
        const pricingItem = {
          ...source,
          purityPercentBp: override.purityPercentBp ?? source.purityPercentBp,
        } as PricingItem;
        const breakdown = calculateItemPrice(
          pricingItem,
          rates,
          'custom_individual',
        );
        const totalPaise =
          breakdown.calculated_total_paise + (override.extraCostPaise || 0);
        return {
          ...selected,
          price: (totalPaise / 100).toFixed(2),
          pricingSource: 'custom',
        };
      }),
    );
    setShowCustomRates(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoading(true);
      try {
        const [nextCustomers, nextExhibitions, baseInventory] =
          await Promise.all([
            getCreateOrderCustomers(),
            getCreateOrderExhibitions(),
            searchCreateOrderInventory(''),
          ]);
        const selectedInventoryResults = initialItems.length
          ? await Promise.all(
              initialItems
                .filter((entry) => entry.itemNumber)
                .map((entry) => searchCreateOrderInventory(entry.itemNumber!)),
            )
          : [];
        const nextInventory = [
          ...baseInventory,
          ...selectedInventoryResults.flat(),
        ].filter(
          (item, index, all) =>
            all.findIndex((candidate) => candidate.id === item.id) === index,
        );

        if (cancelled) return;

        setCustomers(nextCustomers);
        setExhibitions(nextExhibitions);
        setInventory(nextInventory);
        if (initialCustomerId != null)
          setSelectedCustomerId(String(initialCustomerId));
        if (initialExhibitionId != null) {
          setSelectedExhibitionId(String(initialExhibitionId));
          setOrderType('exhibition');
        }
        if (initialItems.length) {
          const requestedIds = new Set(
            initialItems.map((entry) => entry.inventoryItemId),
          );
          const available = nextInventory.filter(
            (item) => requestedIds.has(item.id) && !item.isArchived,
          );
          setSelectedItems(
            available.map((item) => ({
              item,
              price: '',
              selectionItemId:
                initialItems.find((entry) => entry.inventoryItemId === item.id)
                  ?.selectionItemId ?? null,
            })),
          );
          if (available.length !== initialItems.length) {
            setError(
              'Some selected items are no longer available to order. Please review the items before continuing.',
            );
          }
        }
      } catch (err) {
        console.error('Failed to load order options:', err);
        if (!cancelled) {
          setError(getErrorMessage(err, 'Could not load order options.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ids = selectedItems.map((selected) => selected.item.id);
    if (!ids.length) {
      setPricingContext(null);
      return;
    }
    void getOrderPricingContext(ids)
      .then((context) => {
        if (cancelled) return;
        setPricingContext(context);
        const defaultRates = context.rates;
        setSelectedItems((current) =>
          current.map((selected) => {
            if (selected.directPrice) return selected;
            const source = context.items.find(
              (item) => item.inventoryItemId === selected.item.id,
            );
            if (!source) return selected;
            const override = customRatesByItem[selected.item.id];
            const rates = {
              ...defaultRates,
              ...(override || {}),
              diamondRatesPaisePerCarat: {
                ...defaultRates.diamondRatesPaisePerCarat,
                ...(override?.diamondRatesPaisePerCarat || {}),
              },
              stoneRatesPaisePerUnit: {
                ...defaultRates.stoneRatesPaisePerUnit,
                ...(override?.stoneRatesPaisePerUnit || {}),
              },
            } as PricingRates;
            const pricingItem = {
              ...source,
              purityPercentBp:
                override?.purityPercentBp ?? source.purityPercentBp,
            } as PricingItem;
            const breakdown = calculateItemPrice(
              pricingItem,
              rates,
              override ? 'custom_individual' : 'global',
            );
            const totalPaise =
              breakdown.calculated_total_paise +
              (override?.extraCostPaise || 0);
            return {
              ...selected,
              price: (totalPaise / 100).toFixed(2),
              pricingSource: override ? 'custom' : 'global',
            };
          }),
        );
      })
      .catch((err) => console.error('Could not load pricing rates', err));
    return () => {
      cancelled = true;
    };
  }, [selectedItems.map((selected) => selected.item.id).join(',')]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) {
        if (showCustomRates) setShowCustomRates(false);
        else onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving, showCustomRates]);

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === selectedCustomerId,
  );

  const eligibleCustomers = useMemo(() => {
    if (orderType !== 'exhibition') return customers;
    if (!selectedExhibitionId || exhibitionCustomerIds === null) return [];
    const eligibleIds = new Set(exhibitionCustomerIds);
    return customers.filter((customer) => eligibleIds.has(customer.id));
  }, [customers, orderType, selectedExhibitionId, exhibitionCustomerIds]);

  const filteredEligibleCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return eligibleCustomers;
    return eligibleCustomers.filter((customer) =>
      [customer.businessName, customer.contactName, customer.phone, customer.city]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [eligibleCustomers, customerSearch]);

  const filteredExhibitions = useMemo(() => {
    const term = exhibitionSearch.trim().toLowerCase();
    if (!term) return exhibitions;
    return exhibitions.filter((exhibition) =>
      [exhibition.name, exhibition.startDate, exhibition.endDate]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [exhibitions, exhibitionSearch]);

  useEffect(() => {
    let cancelled = false;
    async function loadExhibitionCustomers() {
      setExhibitionCustomerIds(null);
      if (orderType !== 'exhibition' || !selectedExhibitionId) return;
      try {
        const db = await getDatabase();
        const rows = await db.select<{ id: number }[]>(
          `SELECT DISTINCT c.id
           FROM customer c
           JOIN selection s ON s.customer_id = c.id
           WHERE s.exhibition_id = ? AND c.is_archived = 0
           ORDER BY c.id`,
          [Number(selectedExhibitionId)],
        );
        if (!cancelled) setExhibitionCustomerIds(rows.map((row) => Number(row.id)));
      } catch (err) {
        console.error('Failed to load exhibition customers:', err);
        if (!cancelled) {
          setExhibitionCustomerIds([]);
          setError('Could not load customers for this exhibition.');
        }
      }
    }
    void loadExhibitionCustomers();
    return () => { cancelled = true; };
  }, [orderType, selectedExhibitionId]);

  useEffect(() => {
    if (step !== 2 || orderType !== 'direct' || initialItems.length > 0) return;
    let cancelled = false;
    setLoading(true);
    searchCreateOrderInventory(inventorySearch)
      .then((items) => {
        if (!cancelled) setInventory(items);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load inventory.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [step, orderType, initialItems.length]);

  useEffect(() => {
    if (step !== 2 || orderType !== 'exhibition' || !selectedCustomerId || !selectedExhibitionId || initialItems.length > 0) return;
    let cancelled = false;
    setLoading(true);
    searchCreateOrderSelectionItems(Number(selectedCustomerId), Number(selectedExhibitionId))
      .then((items) => {
        if (!cancelled) setInventory(items.filter((item) => !selectedItems.some((selected) => selected.item.id === item.id)));
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load this customer’s selected items.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [step, orderType, selectedCustomerId, selectedExhibitionId, initialItems.length]);

  const totalPaise = selectedItems.reduce(
    (total, selected) => total + Math.round(Number(selected.price || 0) * 100),
    0,
  );
  const finalTotalPaise =
    roundOffFinalTotal.trim() !== ''
      ? Math.max(0, Math.round(Number(roundOffFinalTotal) * 100))
      : totalPaise;

  async function searchInventory(value: string) {
    setInventorySearch(value);
    try {
      let results: CreateOrderInventoryItem[];
      if (
        orderType === 'exhibition' &&
        selectedCustomerId &&
        selectedExhibitionId
      ) {
        results = await searchCreateOrderSelectionItems(
          Number(selectedCustomerId),
          Number(selectedExhibitionId),
        );
        const term = value.trim().toLocaleLowerCase();
        if (term) {
          results = results.filter((item) =>
            [item.itemNumber, item.name ?? '', item.categoryName].some((field) =>
              field.toLocaleLowerCase().includes(term),
            ),
          );
        }
      } else {
        results = await searchCreateOrderInventory(value);
      }
      setInventory(results);
    } catch (err) {
      console.error('Failed to search order inventory:', err);
      setError(getErrorMessage(err, 'Could not search inventory.'));
    }
  }

  function addItem(item: CreateOrderInventoryItem) {
    if (
      item.isArchived ||
      selectedItems.some((selected) => selected.item.id === item.id)
    ) {
      return;
    }

    setSelectedItems((current) => [
      ...current,
      { item, price: '', directPrice: false, pricingSource: 'global' },
    ]);
    setError(null);
  }

  function updatePrice(itemId: number, price: string) {
    if (price !== '' && (!/^\d*\.?\d{0,2}$/.test(price) || Number(price) < 0)) {
      return;
    }

    setSelectedItems((current) =>
      current.map((selected) =>
        selected.item.id === itemId
          ? { ...selected, price, directPrice: true, pricingSource: 'direct' }
          : selected,
      ),
    );
  }

  function resetToGlobalPricing(itemId: number) {
    if (!pricingContext) return;

    const source = pricingContext.items.find(
      (item) => item.inventoryItemId === itemId,
    );
    if (!source) return;

    const breakdown = calculateItemPrice(
      source as PricingItem,
      pricingContext.rates,
      'global',
    );

    setSelectedItems((current) =>
      current.map((selected) =>
        selected.item.id === itemId
          ? {
              ...selected,
              price: (breakdown.calculated_total_paise / 100).toFixed(2),
              directPrice: false,
              pricingSource: 'global',
            }
          : selected,
      ),
    );

    setCustomRatesByItem((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function continueToNextStep() {
    setError(null);
    if (step === 1 && !orderType) {
      setError('Choose whether this is an exhibition order or a direct order.');
      return;
    }
    if (step === 1 && !selectedCustomerId) {
      setError('Select a customer before continuing.')
      return;
    }
    if (step === 2 && !selectedItems.length) {
      setError('Add at least one jewelry item before continuing.');
      return;
    }
    if (step === 3) {
      if (
        selectedItems.some(
          (selected) =>
            selected.price.trim() === '' ||
            !Number.isFinite(Number(selected.price)),
        )
      ) {
        setError('Enter the final selling price for every selected item.');
        return;
      }
    }
    setStep((current) =>
      current < 4 ? ((current + 1) as 1 | 2 | 3 | 4) : current,
    );
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== 4) {
      continueToNextStep();
      return;
    }
    // Ignore submit attempts until Full Review has been visible briefly.
    if (!reviewReady) return;
    setError(null);

    if (!selectedCustomerId) {
      setError('Select a customer before creating the order.');
      return;
    }

    if (!selectedItems.length) {
      setError('Add at least one jewelry item.');
      return;
    }

    if (
      selectedItems.some(
        (selected) =>
          selected.price.trim() === '' ||
          !Number.isFinite(Number(selected.price)),
      )
    ) {
      setError('Enter the final selling price for every selected item.');
      return;
    }

    setSaving(true);

    try {
      const orderId = await createConfirmedOrder({
        customerId: Number(selectedCustomerId),
        exhibitionId: selectedExhibitionId
          ? Number(selectedExhibitionId)
          : null,
        notes,
        roundedTotalPaise:
          roundOffFinalTotal.trim() !== ''
            ? Number(roundOffFinalTotal) * 100
            : null,
        items: selectedItems.map((selected) => ({
          inventoryItemId: selected.item.id,
          agreedPricePaise: Math.round(Number(selected.price) * 100),
          selectionItemId: selected.selectionItemId ?? null,
        })),
      });

      onCreated(orderId);
    } catch (err) {
      console.error('Failed to create order:', err);
      setError(getErrorMessage(err, 'Could not create the order.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className='create-order-overlay'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className='create-order-modal'
        onSubmit={submitOrder}
        aria-labelledby='create-order-title'
      >
        <header className='create-order-header'>
          <div>
            <h2 id='create-order-title'>Create order</h2>
            <p>
              {initialItems.length
                ? step === 2
                  ? 'Review the items selected from this exhibition.'
                  : 'Review pricing and save the order.'
                : step === 1
                  ? 'Choose the customer and exhibition.'
                  : step === 2
                    ? 'Add the jewelry pieces for this order.'
                    : 'Review prices and confirm the order.'}
            </p>
          </div>
          <button
            type='button'
            className='create-order-close'
            aria-label='Close create order'
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </header>

        <div className='create-order-progress' aria-label='Order progress'>
          {(initialItems.length
            ? [
                { number: 2, label: 'Review order items' },
                { number: 3, label: 'Price review' },
                { number: 4, label: 'Full review' },
              ]
            : [
                { number: 1, label: 'Customer & exhibition' },
                { number: 2, label: 'Select jewelry' },
                { number: 3, label: 'Price review' },
                { number: 4, label: 'Full review' },
              ]
          ).map((item) => (
            <div
              key={item.number}
              className={`create-order-progress-step ${step === item.number ? 'is-current' : step > item.number ? 'is-complete' : ''}`}
            >
              <strong>{item.label}</strong>
            </div>
          ))}
        </div>

        <div className={`create-order-body ${step === 1 ? 'create-order-body-step-one' : ''}`}>
          <div className='create-order-main'>
            {step === 1 && (
              <>
                <section className='create-order-section'>
                  <h3>Create order for</h3>
                  <div className='create-order-type-options' role='radiogroup' aria-label='Create order for'>
                    <button
                      type='button'
                      role='radio'
                      aria-checked={orderType === 'exhibition'}
                      className={`create-order-type-option ${orderType === 'exhibition' ? 'is-selected' : ''}`}
                      onClick={() => {
                        setOrderType('exhibition');
                        setSelectedItems([]);
                        setInventory([]);
                        setInventorySearch('');
                        setSelectedCategoryIds([]);
                        setShowMoreItems(false);
                        setAdditionalSelectedIds([]);
                        setSelectedExhibitionId('');
                        setExhibitionSearch('');
                        setExhibitionDropdownOpen(false);
                        setExhibitionCustomerIds(null);
                        setSelectedCustomerId('');
                        setShowCustomerPicker(false);
                        setError(null);
                      }}
                    >
                      <span className='create-order-type-radio' />
                      <span><strong>From exhibition</strong><small>Create an order associated with an exhibition.</small></span>
                    </button>
                    <button
                      type='button'
                      role='radio'
                      aria-checked={orderType === 'direct'}
                      className={`create-order-type-option ${orderType === 'direct' ? 'is-selected' : ''}`}
                      onClick={() => {
                        setOrderType('direct');
                        setSelectedItems([]);
                        setInventory([]);
                        setInventorySearch('');
                        setSelectedCategoryIds([]);
                        setShowMoreItems(false);
                        setAdditionalSelectedIds([]);
                        setSelectedExhibitionId('');
                        setExhibitionSearch('');
                        setExhibitionDropdownOpen(false);
                        setExhibitionCustomerIds(null);
                        setSelectedCustomerId('');
                        setShowCustomerPicker(false);
                        setError(null);
                      }}
                    >
                      <span className='create-order-type-radio' />
                      <span><strong>Direct order</strong><small>Create an order without an exhibition.</small></span>
                    </button>
                  </div>
                </section>

                {orderType === 'exhibition' && <section className='create-order-section'>
                  <h3>Exhibition</h3>
                  <div className='create-order-exhibition-select'>
                    <input
                      className='create-order-exhibition-search'
                      value={exhibitionDropdownOpen ? exhibitionSearch : (
                        exhibitions.find((exhibition) => String(exhibition.id) === selectedExhibitionId)?.name ?? ''
                      )}
                      onFocus={() => {
                        setExhibitionDropdownOpen(true);
                        setExhibitionSearch('');
                      }}
                      onChange={(event) => {
                        setExhibitionSearch(event.target.value);
                        setExhibitionDropdownOpen(true);
                        setSelectedItems([]);
                        setInventory([]);
                        setInventorySearch('');
                        setSelectedCategoryIds([]);
                        setSelectedExhibitionId('');
                        setExhibitionCustomerIds(null);
                        setSelectedCustomerId('');
                        setShowCustomerPicker(false);
                      }}
                      placeholder='Search or choose an exhibition...'
                      aria-label='Search exhibitions'
                      role='combobox'
                      aria-expanded={exhibitionDropdownOpen}
                    />
                    {exhibitionDropdownOpen && (
                      <>
                        <button
                          type='button'
                          className='create-order-dropdown-dismiss'
                          aria-label='Close exhibition menu'
                          onClick={() => setExhibitionDropdownOpen(false)}
                        />
                        <div className='create-order-exhibition-menu' role='listbox'>
                          {filteredExhibitions.map((exhibition) => {
                            const selected = String(exhibition.id) === selectedExhibitionId;
                            return (
                              <button
                                type='button'
                                role='option'
                                aria-selected={selected}
                                key={exhibition.id}
                                className={`create-order-exhibition-option ${selected ? 'is-selected' : ''}`}
                                onClick={() => {
                                  setSelectedItems([]);
                                  setInventory([]);
                                  setInventorySearch('');
                                  setSelectedCategoryIds([]);
                                  setSelectedExhibitionId(String(exhibition.id));
                                  setSelectedCustomerId('');
                                  setCustomerSearch('');
                                  setShowCustomerPicker(false);
                                  setExhibitionSearch('');
                                  setExhibitionDropdownOpen(false);
                                  setError(null);
                                }}
                              >
                                <span>{exhibition.name}<small>{exhibition.startDate}</small></span>
                                {selected && <span>✓</span>}
                              </button>
                            );
                          })}
                          {!filteredExhibitions.length && <p className='create-order-empty-option'>No matching exhibitions.</p>}
                        </div>
                      </>
                    )}
                  </div>
                  <p className='create-order-helper'>
                    Choose an exhibition to see only customers who attended it.
                  </p>
                </section>}

                {orderType && <section className='create-order-section'>
                  <h3>Customer</h3>
                  <div className='create-order-exhibition-select create-order-customer-select'>
                    <input
                      className='create-order-exhibition-search'
                      value={showCustomerPicker ? customerSearch : (selectedCustomer?.businessName ?? '')}
                      disabled={orderType === 'exhibition' && !selectedExhibitionId}
                      onFocus={() => {
                        if (orderType === 'exhibition' && !selectedExhibitionId) return;
                        setExhibitionDropdownOpen(false);
                        setCustomerSearch('');
                        setShowCustomerPicker(true);
                      }}
                      onChange={(event) => {
                        setCustomerSearch(event.target.value);
                        setShowCustomerPicker(true);
                        setSelectedItems([]);
                        setInventory([]);
                        setInventorySearch('');
                        setSelectedCategoryIds([]);
                        setSelectedCustomerId('');
                      }}
                      placeholder={orderType === 'exhibition' && !selectedExhibitionId ? 'Choose an exhibition first' : 'Search or choose a customer...'}
                      aria-label='Search customers'
                      role='combobox'
                      aria-expanded={showCustomerPicker}
                    />
                    {showCustomerPicker && !(orderType === 'exhibition' && !selectedExhibitionId) && (
                      <>
                        <button
                          type='button'
                          className='create-order-dropdown-dismiss'
                          aria-label='Close customer menu'
                          onClick={() => {
                            setShowCustomerPicker(false);
                            setCustomerSearch('');
                          }}
                        />
                        <div className='create-order-exhibition-menu create-order-customer-menu' role='listbox'>
                          {filteredEligibleCustomers.map((customer) => {
                            const selected = String(customer.id) === selectedCustomerId;
                            return (
                              <button
                                type='button'
                                role='option'
                                aria-selected={selected}
                                key={customer.id}
                                className={`create-order-exhibition-option create-order-customer-option ${selected ? 'is-selected' : ''}`}
                                onClick={() => {
                                  if (selectedCustomerId !== String(customer.id)) {
                                    setSelectedItems([]);
                                    setInventory([]);
                                    setInventorySearch('');
                                    setSelectedCategoryIds([]);
                                  }
                                  setSelectedCustomerId(String(customer.id));
                                  setCustomerSearch('');
                                  setShowCustomerPicker(false);
                                  setError(null);
                                }}
                              >
                                <span>
                                  {customer.businessName}
                                  <small>{[
                                    customer.contactName,
                                    customer.phone,
                                    customer.city,
                                  ].filter(Boolean).join(' · ')}</small>
                                </span>
                                {selected && <span>✓</span>}
                              </button>
                            );
                          })}
                          {!filteredEligibleCustomers.length && <p className='create-order-empty-option'>No matching customers.</p>}
                        </div>
                      </>
                    )}
                  </div>
                  <p className='create-order-helper'>
                    Not listed? Customer creation will be available from Customers.
                  </p>
                </section>}


              </>
            )}

            {step === 2 && (
              <section className='create-order-section create-order-jewelry-section'>
                {!showMoreItems && initialItems.length > 0 && (
                  <button
                    type='button'
                    className='create-order-add-more-button'
                    onClick={async () => {
                      setShowMoreItems(true);
                      setAdditionalSelectedIds([]);
                      setInventorySearch('');
                      if (!selectedCustomerId || !selectedExhibitionId) {
                        setInventory([]);
                        setError(
                          'Select the customer and exhibition before adding items from their selection.',
                        );
                        return;
                      }
                      try {
                        setLoading(true);
                        setError(null);
                        const selectionItems =
                          await searchCreateOrderSelectionItems(
                            Number(selectedCustomerId),
                            Number(selectedExhibitionId),
                          );
                        const alreadyInOrder = new Set(
                          selectedItems.map((selected) => selected.item.id),
                        );
                        setInventory(
                          selectionItems.filter(
                            (item) => !alreadyInOrder.has(item.id),
                          ),
                        );
                      } catch (err) {
                        setError(
                          getErrorMessage(
                            err,
                            'Could not load this customer’s selected items.',
                          ),
                        );
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    + Add more items
                  </button>
                )}

                {(!initialItems.length || showMoreItems) && (
                  <>
                    {!showMoreItems && (
                      <div className='create-order-inventory-search'>
                        <span aria-hidden='true'>▥</span>
                        <input
                          value={inventorySearch}
                          onChange={(event) =>
                            void searchInventory(event.target.value)
                          }
                          placeholder='Search by item number, name, or category...'
                          aria-label='Search inventory by item number, name, or category'
                        />
                      </div>
                    )}

                    <div className='create-order-category-filters' aria-label='Filter by category'>
                      {[...new Map(inventory.map((item) => [item.categoryId, item.categoryName])).entries()].map(([categoryId, categoryName]) => (
                        <button
                          type='button'
                          key={categoryId}
                          className={selectedCategoryIds.includes(categoryId) ? 'is-selected' : ''}
                          aria-pressed={selectedCategoryIds.includes(categoryId)}
                          onClick={() => setSelectedCategoryIds((current) => current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId])}
                        >
                          {categoryName}
                        </button>
                      ))}
                      {selectedCategoryIds.length > 0 && (
                        <button type='button' className='create-order-category-clear' onClick={() => setSelectedCategoryIds([])}>Clear</button>
                      )}
                    </div>
                    <div
                      className={`create-order-inventory-list create-order-step2-table ${showMoreItems && initialItems.length > 0 ? 'create-order-add-more-table' : ''}`}
                    >
                      {!showMoreItems && (
                        <div className='create-order-step2-heading'>
                          <span></span><span>Item</span><span>Gross wt.</span><span>Net wt.</span><span>Diamonds</span><span>Stones</span>
                        </div>
                      )}
                      {showMoreItems && initialItems.length > 0 && (
                        <div className='create-order-add-more-heading'>
                          <span></span>
                          <span>Item</span>
                          <span>Gross wt.</span>
                          <span>Net wt.</span>
                          <span>Diamond details</span>
                          <span>Stone details</span>
                        </div>
                      )}
                      {loading && (
                        <p className='create-order-empty'>Loading inventory…</p>
                      )}

                      {!loading &&
                        inventory.filter((item) => (selectedCategoryIds.length === 0 || selectedCategoryIds.includes(item.categoryId)) && (showMoreItems || !selectedItems.some((selected) => selected.item.id === item.id))).map((item) => {
                          const alreadySelected = selectedItems.some(
                            (selected) => selected.item.id === item.id,
                          );
                          return (
                            <div
                              key={item.id}
                              className='create-order-inventory-row'
                            >
                              <input
                                type='checkbox'
                                className='create-order-item-checkbox'
                                aria-label={`Select ${item.itemNumber}`}
                                checked={initialItems.length > 0 && showMoreItems ? additionalSelectedIds.includes(item.id) : alreadySelected}
                                disabled={Boolean(item.isArchived) || (initialItems.length > 0 && showMoreItems ? alreadySelected : false)}
                                onChange={(event) => {
                                  if (initialItems.length > 0 && showMoreItems) {
                                    setAdditionalSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id));
                                  } else if (event.target.checked) {
                                    addItem(item);
                                  } else {
                                    setSelectedItems((current) => current.filter((selected) => selected.item.id !== item.id));
                                  }
                                }}
                              />
                              <div className='create-order-item-identity create-order-add-more-identity'>
                                <ItemThumbnail path={item.imagePath} alt={item.itemNumber} />
                                <div className='create-order-inventory-name'>
                                  <strong>{item.itemNumber}{item.name ? ` · ${item.name}` : ''}</strong>
                                  <span>{item.categoryName}</span>
                                </div>
                              </div>
                              <span className='create-order-inventory-details'>{formatWeight(item.grossWeightMilli)}</span>
                              <span className='create-order-inventory-details'>{formatWeight(item.netWeightMilli)}</span>
                              <span className='create-order-inventory-details'>{formatDetailLines(item.diamondDetails)}</span>
                              <span className='create-order-inventory-details'>{formatDetailLines(item.stoneDetails)}</span>
                            </div>
                          );
                        })}

                      {!loading && !inventory.some((item) => selectedCategoryIds.length === 0 || selectedCategoryIds.includes(item.categoryId)) && (
                        <p className='create-order-empty'>No eligible items match your search and category filters.</p>
                      )}
                    </div>



                    {!(initialItems.length > 0 && showMoreItems) && (
                      <p className='create-order-helper'>
                        Only available, non-archived items can be added. You
                        will enter final prices in the next step.
                      </p>
                    )}
                  </>
                )}

                {showMoreItems && initialItems.length > 0 ? (
                  <div className='create-order-add-more-footer'>
                    <button
                      type='button'
                      className='create-order-cancel-button'
                      onClick={() => {
                        setShowMoreItems(false);
                        setAdditionalSelectedIds([]);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      type='button'
                      className='create-order-submit-button'
                      disabled={!additionalSelectedIds.length || saving}
                      onClick={() => {
                        const additions = inventory.filter((item) =>
                          additionalSelectedIds.includes(item.id),
                        );
                        setSelectedItems((current) => [
                          ...current,
                          ...additions
                            .filter(
                              (item) =>
                                !current.some(
                                  (selected) => selected.item.id === item.id,
                                ),
                            )
                            .map((item) => ({
                              item,
                              price: '',
                              selectionItemId: item.selectionItemId ?? null,
                            })),
                        ]);
                        setShowMoreItems(false);
                        setAdditionalSelectedIds([]);
                        setError(null);
                      }}
                    >
                      Add selected items
                    </button>
                  </div>
                ) : (
                  <div className='create-order-selected-table'>
                    <div className='create-order-selected-heading'>
                      <span>Selected item</span>
                      <span>Gross wt.</span>
                      <span>Net wt.</span>
                      <span>Diamond details</span>
                      <span>Stone details</span>
                      <span />
                    </div>

                    {selectedItems.map(({ item }) => (
                      <div className='create-order-selected-row' key={item.id}>
                        <div className='create-order-item-identity create-order-selected-name'>
                          <ItemThumbnail
                            path={item.imagePath}
                            alt={item.itemNumber}
                          />
                          <span>
                            <strong>{item.itemNumber}</strong>
                            <small>{item.categoryName}</small>
                          </span>
                        </div>
                        <span>{formatWeight(item.grossWeightMilli)}</span>
                        <span>{formatWeight(item.netWeightMilli)}</span>
                        <span className='create-order-selected-details'>
                          {formatDetailLines(item.diamondDetails)}
                        </span>
                        <span className='create-order-selected-details'>
                          {formatDetailLines(item.stoneDetails)}
                        </span>
                        <button
                          type='button'
                          className='create-order-remove-item'
                          aria-label={`Remove ${item.itemNumber}`}
                          onClick={() =>
                            setSelectedItems((current) =>
                              current.filter(
                                (selected) => selected.item.id !== item.id,
                              ),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}

                    {!selectedItems.length && (
                      <p className='create-order-empty'>
                        No items selected yet.
                      </p>
                    )}
                    {selectedItems.length > 0 && (
                      <div className='create-order-selected-total'>
                        <strong>Totals ({selectedItems.length} items)</strong>
                        <strong>
                          {formatWeight(
                            selectedItems.reduce(
                              (sum, selected) =>
                                sum + (selected.item.grossWeightMilli ?? 0),
                              0,
                            ),
                          )}
                        </strong>
                        <strong>
                          {formatWeight(
                            selectedItems.reduce(
                              (sum, selected) =>
                                sum + (selected.item.netWeightMilli ?? 0),
                              0,
                            ),
                          )}
                        </strong>
                        <strong>
                          {formatDetailTotal(selectedItems, 'diamondDetails')}
                        </strong>
                        <strong>
                          {formatDetailTotal(selectedItems, 'stoneDetails')}
                        </strong>
                        <span />
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {step === 3 && (
              <section className='create-order-section create-order-review-section'>
                <div className='create-order-custom-toolbar'>
                  <p className='create-order-pricing-help'>
                    Global rates are applied automatically. Custom rates are
                    saved per item.
                  </p>
                  <button
                    type='button'
                    className='create-order-custom-button'
                    disabled={!customizeSelected.length || !pricingContext}
                    onClick={openCustomRates}
                  >
                    Apply custom prices
                    {customizeSelected.length
                      ? ` (${customizeSelected.length})`
                      : ''}
                  </button>
                </div>
                <div className='create-order-review-items create-order-price-review-table'>
                  <div className='create-order-review-heading'>
                    <span className='create-order-price-review-item-heading'>
                      <input
                        type='checkbox'
                        aria-label='Select all items for custom pricing'
                        checked={
                          selectedItems.length > 0 &&
                          customizeSelected.length === selectedItems.length
                        }
                        onChange={(event) =>
                          setCustomizeSelected(
                            event.target.checked
                              ? selectedItems.map((item) => item.item.id)
                              : [],
                          )
                        }
                      />{' '}
                      Item
                    </span>
                    <span>Gross wt.</span>
                    <span>Net wt.</span>
                    <span>Diamonds</span>
                    <span>Stones</span>
                    <span>Price (₹)</span>
                  </div>
                  {selectedItems.map(({ item, price, pricingSource }) => (
                    <div className='create-order-review-row' key={item.id}>
                      <div className='create-order-price-review-item'>
                        <input
                          type='checkbox'
                          checked={customizeSelected.includes(item.id)}
                          onChange={(event) =>
                            setCustomizeSelected((current) =>
                              event.target.checked
                                ? [...current, item.id]
                                : current.filter((id) => id !== item.id),
                            )
                          }
                          aria-label={`Select ${item.itemNumber} for custom pricing`}
                        />
                        <ItemThumbnail
                          path={item.imagePath}
                          alt={item.itemNumber}
                        />
                        <span className='create-order-item-identity-copy'>
                          <strong>{item.itemNumber}</strong>
                          <small>{item.categoryName}</small>
                        </span>
                      </div>
                      <span>{formatWeight(item.grossWeightMilli)}</span>
                      <span>{formatWeight(item.netWeightMilli)}</span>
                      <span className='create-order-price-review-detail'>
                        {formatDetailLines(item.diamondDetails)}
                      </span>
                      <span className='create-order-price-review-detail'>
                        {formatDetailLines(item.stoneDetails)}
                      </span>
                      <div className='create-order-price-review-price'>
                        <input
                          inputMode='decimal'
                          value={price}
                          onChange={(event) =>
                            updatePrice(item.id, event.target.value)
                          }
                          placeholder='0.00'
                          aria-label={`Final selling price for ${item.itemNumber}`}
                          required
                        />
                        <small>
                          {pricingSource === 'direct'
                            ? 'Calculated directly. '
                            : pricingSource === 'custom'
                              ? 'Calculated using custom rates. '
                              : 'Calculated using global rates.'}
                          {(pricingSource === 'direct' ||
                            pricingSource === 'custom') && (
                            <button
                              type='button'
                              className='create-order-reset-pricing'
                              onClick={() => resetToGlobalPricing(item.id)}
                            >
                              Default to global rule.
                            </button>
                          )}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
                <div className='create-order-review-total'>
                  <span>Calculated order value</span>
                  <strong>{formatMoney(totalPaise)}</strong>
                </div>
                <div className='create-order-round-off'>
                  <label htmlFor='create-order-round-off-final-total'>
                    Round off final total (₹)
                  </label>
                  <input
                    id='create-order-round-off-final-total'
                    type='text'
                    inputMode='decimal'
                    value={roundOffFinalTotal}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === '' || /^\d*\.?\d{0,2}$/.test(value)) {
                        setRoundOffFinalTotal(value);
                      }
                    }}
                    placeholder={formatMoney(totalPaise)
                      .replace(/[₹,]/g, '')
                      .trim()}
                    aria-describedby='create-order-round-off-help'
                  />
                  <small id='create-order-round-off-help'>
                    Leave empty to use the calculated order value.
                  </small>
                </div>
                <div className='create-order-review-total create-order-review-final-total'>
                  <span>Final order total</span>
                  <strong>{formatMoney(finalTotalPaise)}</strong>
                </div>
              </section>
            )}

            {step === 4 && (
              <section className='create-order-section create-order-review-section'>
                <h3>Full review</h3>
                <div className='create-order-review-customer'>
                  <span>Customer</span>
                  <strong>
                    {selectedCustomer?.businessName || 'Not selected'}
                  </strong>
                </div>
                <div className='create-order-review-customer'>
                  <span>Exhibition</span>
                  <strong>
                    {selectedExhibitionId
                      ? exhibitions.find(
                          (exhibition) =>
                            String(exhibition.id) === selectedExhibitionId,
                        )?.name || 'Selected exhibition'
                      : 'Direct order'}
                  </strong>
                </div>
                <div className='create-order-review-items'>
                  <div className='create-order-review-heading'>
                    <span>Item</span>
                    <span>Gross wt.</span>
                    <span>Net wt.</span>
                    <span>Diamonds</span>
                    <span>Stones</span>
                    <span>Final price</span>
                  </div>
                  {selectedItems.map(({ item, price }) => (
                    <div className='create-order-review-row' key={item.id}>
                      <div className='create-order-item-identity create-order-review-item-name'>
                        <ItemThumbnail
                          path={item.imagePath}
                          alt={item.itemNumber}
                        />
                        <span>
                          <strong>{item.itemNumber}</strong>
                          <small>{item.categoryName}</small>
                        </span>
                      </div>
                      <span>{formatWeight(item.grossWeightMilli)}</span>
                      <span>{formatWeight(item.netWeightMilli)}</span>
                      <span className='create-order-review-detail'>
                        {formatDetailLines(item.diamondDetails)}
                      </span>
                      <span className='create-order-review-detail'>
                        {formatDetailLines(item.stoneDetails)}
                      </span>
                      <strong>
                        {formatMoney(Math.round(Number(price || 0) * 100))}
                      </strong>
                    </div>
                  ))}
                  <div className='create-order-review-row create-order-review-table-total'>
                    <strong>Totals</strong>
                    <strong>
                      {formatWeight(
                        selectedItems.some(
                          ({ item }) => item.grossWeightMilli !== null,
                        )
                          ? selectedItems.reduce(
                              (sum, { item }) =>
                                sum + (item.grossWeightMilli ?? 0),
                              0,
                            )
                          : null,
                      )}
                    </strong>
                    <strong>
                      {formatWeight(
                        selectedItems.some(
                          ({ item }) => item.netWeightMilli !== null,
                        )
                          ? selectedItems.reduce(
                              (sum, { item }) =>
                                sum + (item.netWeightMilli ?? 0),
                              0,
                            )
                          : null,
                      )}
                    </strong>
                    <strong>
                      {formatDetailTotal(selectedItems, 'diamondDetails')}
                    </strong>
                    <strong>
                      {formatDetailTotal(selectedItems, 'stoneDetails')}
                    </strong>
                    <strong>{formatMoney(totalPaise)}</strong>
                  </div>
                </div>
                <div className='create-order-review-total'>
                  <span>Final order total</span>
                  <strong>{formatMoney(finalTotalPaise)}</strong>
                </div>
                <label
                  className='create-order-review-notes-label'
                  htmlFor='create-order-review-notes'
                >
                  Notes
                </label>
                <textarea
                  id='create-order-review-notes'
                  className='create-order-review-notes'
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  placeholder='Add any notes for this order…'
                />
              </section>
            )}
          </div>
        </div>

        {error && (
          <div className='create-order-error' role='alert'>
            {error}
          </div>
        )}

        {!showMoreItems && (
          <footer className='create-order-footer'>
            <span>
              {step === 1
                ? 'Start by selecting a customer.'
                : step === 2
                  ? `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} selected`
                  : `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} · ${formatMoney(step >= 3 ? finalTotalPaise : totalPaise)}`}
            </span>
            <div>
              {initialItems.length > 0 ? (
                <button
                  type='button'
                  className='create-order-cancel-button'
                  onClick={
                    step >= 3
                      ? () => {
                          setError(null);
                          setStep((current) => (current - 1) as 1 | 2 | 3 | 4);
                        }
                      : onClose
                  }
                  disabled={saving}
                >
                  {step >= 3 ? 'Back' : 'Cancel'}
                </button>
              ) : (
                <button
                  type='button'
                  className='create-order-cancel-button'
                  onClick={
                    step === 1
                      ? onClose
                      : () => {
                          setError(null);
                          setStep((current) => (current - 1) as 1 | 2 | 3 | 4);
                        }
                  }
                  disabled={saving}
                >
                  {step === 1 ? 'Cancel' : 'Back'}
                </button>
              )}
              {step < 4 ? (
                <button
                  type='button'
                  className='create-order-submit-button'
                  onClick={continueToNextStep}
                  disabled={saving || loading}
                >
                  Continue <span aria-hidden='true'>→</span>
                </button>
              ) : (
                <button
                  type='submit'
                  className='create-order-submit-button'
                  disabled={saving || loading || !reviewReady}
                >
                  {saving ? 'Creating…' : 'Create confirmed order'}
                </button>
              )}
            </div>
          </footer>
        )}
      </form>
      {showCustomRates && customRateDraft && pricingContext && (
        <div
          className='create-order-custom-backdrop'
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowCustomRates(false);
          }}
        >
          <section
            className='create-order-custom-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='create-order-custom-title'
          >
            <header className='create-order-custom-modal-header'>
              <div>
                <h2 id='create-order-custom-title'>Custom price rules</h2>
                <p>
                  Changes apply only to the {customizeSelected.length} selected
                  item{customizeSelected.length === 1 ? '' : 's'}. Existing
                  overrides are preserved unless you edit a field.
                </p>
              </div>
              <button
                type='button'
                className='create-order-custom-close'
                onClick={() => setShowCustomRates(false)}
                aria-label='Close custom price rules'
              >
                ×
              </button>
            </header>
            <div className='create-order-custom-modal-body'>
              {customRateHasMixedValues && (
                <div className='create-order-custom-mixed-notice' role='status'>
                  <span
                    className='create-order-custom-mixed-icon'
                    aria-hidden='true'
                  >
                    i
                  </span>
                  <div>
                    <strong>
                      Some selected items have different pricing values.
                    </strong>
                    <p>
                      If you want to override these values with one common
                      value, enter it below. Leave a field unchanged to preserve
                      each item's existing value.
                    </p>
                  </div>
                </div>
              )}
              <section className='create-order-custom-section'>
                <h3>Gold pricing</h3>
                <div className='create-order-custom-grid create-order-custom-grid-two'>
                  <label className='create-order-custom-field'>
                    <span>Gold rate</span>
                    <div className='create-order-settings-input'>
                      <span>₹/g</span>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.goldRate}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('goldRate', e.target.value)
                        }
                      />
                    </div>
                  </label>
                  <div className='create-order-custom-field'>
                    <span>Gold purity by item</span>
                    <div className='create-order-purity-list'>
                      {(() => {
                        const groups = new Map<string, number[]>();
                        customizeSelected.forEach((id) => {
                          const source = pricingContext.items.find(
                            (item) => item.inventoryItemId === id,
                          );
                          const key =
                            (
                              source?.purityName || 'Purity not specified'
                            ).trim() || 'Purity not specified';
                          groups.set(key, [...(groups.get(key) || []), id]);
                        });
                        return [...groups.entries()].map(([purity, ids]) => {
                          const values = ids.map(
                            (id) => customRateDraft.purityByItem[id] ?? '',
                          );
                          const first = values[0] ?? '';
                          const same = values.every((value) => value === first);
                          const fieldKey = `purity:${purity}`;
                          return (
                            <div
                              className='create-order-purity-row create-order-purity-group'
                              key={purity}
                            >
                              <div className='create-order-purity-value'>
                                {purity}
                              </div>
                              <label className='create-order-settings-input'>
                                <input
                                  aria-label={`${purity} purity percentage`}
                                  inputMode='decimal'
                                  value={same ? first : ''}
                                  placeholder={same ? '' : 'Different values'}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setCustomRateDraft((current) => {
                                      if (!current) return current;
                                      const nextPurityByItem = {
                                        ...current.purityByItem,
                                      };
                                      ids.forEach((id) => {
                                        nextPurityByItem[id] = value;
                                      });
                                      return {
                                        ...current,
                                        purityByItem: nextPurityByItem,
                                      };
                                    });
                                    setCustomRateDirty((current) =>
                                      current.includes(fieldKey)
                                        ? current
                                        : [...current, fieldKey],
                                    );
                                  }}
                                />
                                <span>%</span>
                              </label>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              </section>
              <section className='create-order-custom-section'>
                <h3>Wastage</h3>
                <div className='create-order-wastage-cards'>
                  <div
                    className={`create-order-wastage-card ${customRateDraft.wastageMode === 'percent' ? 'is-selected' : ''}`}
                  >
                    <button
                      type='button'
                      className='create-order-wastage-select'
                      onClick={() =>
                        changeCustomDraft('wastageMode', 'percent')
                      }
                    >
                      <span className='create-order-wastage-card-heading'>
                        <strong>Percentage</strong>
                        <span>
                          {customRateDraft.wastageMode === 'percent'
                            ? '✓'
                            : '○'}
                        </span>
                      </span>
                    </button>
                    <small>Wastage calculated as a percentage</small>
                    <div className='create-order-settings-input'>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.wastagePercent}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('wastagePercent', e.target.value)
                        }
                      />
                      <span>%</span>
                    </div>
                  </div>
                  <div
                    className={`create-order-wastage-card ${customRateDraft.wastageMode === 'per_g' ? 'is-selected' : ''}`}
                  >
                    <button
                      type='button'
                      className='create-order-wastage-select'
                      onClick={() => changeCustomDraft('wastageMode', 'per_g')}
                    >
                      <span className='create-order-wastage-card-heading'>
                        <strong>Fixed per gram</strong>
                        <span>
                          {customRateDraft.wastageMode === 'per_g' ? '✓' : '○'}
                        </span>
                      </span>
                    </button>
                    <small>Fixed wastage amount per gram</small>
                    <div className='create-order-settings-input'>
                      <span>₹/g</span>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.wastagePerGram}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('wastagePerGram', e.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>
              </section>
              {(() => {
                const diamondMap = new Map<
                  string,
                  { key: string; label: string }
                >();
                const stoneMap = new Map<
                  string,
                  { key: string; label: string; unit: 'ct' | 'g' }
                >();
                customizeSelected.forEach((id) => {
                  const source = pricingContext.items.find(
                    (item) => item.inventoryItemId === id,
                  );
                  source?.diamonds.forEach((diamond) => {
                    const key = String(
                      diamond.combinationId ?? diamond.shapeId,
                    );
                    diamondMap.set(key, {
                      key,
                      label: `${diamond.shape} ${diamond.quality || ''}`.trim(),
                    });
                  });
                  source?.stones.forEach((stone) => {
                    const key = String(stone.stoneTypeId);
                    stoneMap.set(key, {
                      key,
                      label: stone.stone,
                      unit: stone.weightUnit,
                    });
                  });
                });
                const diamondRows = [...diamondMap.values()];
                const stoneRows = [...stoneMap.values()];
                return (
                  <>
                    <section className='create-order-custom-section'>
                      <h3>Diamond prices</h3>
                      {diamondRows.length ? (
                        <div className='create-order-custom-grid create-order-custom-grid-two'>
                          {diamondRows.map((diamond) => (
                            <label
                              className='create-order-custom-field'
                              key={diamond.key}
                            >
                              <span>{diamond.label} (₹/ct)</span>
                              <div className='create-order-settings-input'>
                                <span>₹/ct</span>
                                <input
                                  inputMode='decimal'
                                  value={
                                    customRateDraft.diamondRates[diamond.key] ??
                                    ''
                                  }
                                  placeholder='Different values'
                                  onChange={(e) =>
                                    changeCustomDraft(
                                      `diamond:${diamond.key}`,
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className='create-order-custom-muted'>
                          No diamond components in the selected items.
                        </p>
                      )}
                    </section>
                    <section className='create-order-custom-section'>
                      <h3>Stone prices</h3>
                      {stoneRows.length ? (
                        <div className='create-order-custom-grid create-order-custom-grid-two'>
                          {stoneRows.map((stone) => (
                            <label
                              className='create-order-custom-field'
                              key={stone.key}
                            >
                              <span>
                                {stone.label} (₹/
                                {stone.unit === 'ct' ? 'ct' : 'g'})
                              </span>
                              <div className='create-order-settings-input'>
                                <span>₹/{stone.unit}</span>
                                <input
                                  inputMode='decimal'
                                  value={
                                    customRateDraft.stoneRates[stone.key] ?? ''
                                  }
                                  placeholder='Different values'
                                  onChange={(e) =>
                                    changeCustomDraft(
                                      `stone:${stone.key}`,
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className='create-order-custom-muted'>
                          No stone components in the selected items.
                        </p>
                      )}
                    </section>
                  </>
                );
              })()}
              <section className='create-order-custom-section'>
                <h3>Other charges</h3>
                <div className='create-order-custom-grid create-order-custom-grid-three'>
                  <label className='create-order-custom-field'>
                    <span>Certification (₹/ct)</span>
                    <div className='create-order-settings-input'>
                      <span>₹/ct</span>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.certification}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('certification', e.target.value)
                        }
                      />
                    </div>
                  </label>
                  <label className='create-order-custom-field'>
                    <span>GST</span>
                    <div className='create-order-settings-input'>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.gst}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('gst', e.target.value)
                        }
                      />
                      <span>%</span>
                    </div>
                  </label>
                  <label className='create-order-custom-field'>
                    <span>Extra cost</span>
                    <div className='create-order-settings-input'>
                      <span>₹</span>
                      <input
                        inputMode='decimal'
                        value={customRateDraft.extraCost}
                        placeholder='Different values'
                        onChange={(e) =>
                          changeCustomDraft('extraCost', e.target.value)
                        }
                      />
                    </div>
                  </label>
                </div>
              </section>
            </div>
            <footer className='create-order-custom-modal-footer'>
              <span>
                {customRateDirty.length
                  ? `${customRateDirty.length} field${customRateDirty.length === 1 ? '' : 's'} changed`
                  : 'Edit only the values you want to override.'}
              </span>
              <div>
                <button
                  type='button'
                  className='create-order-cancel-button'
                  onClick={() => setShowCustomRates(false)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='create-order-submit-button'
                  onClick={applyCustomRates}
                  disabled={!customRateDirty.length}
                >
                  Apply custom rates
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
