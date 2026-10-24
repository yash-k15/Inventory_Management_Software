import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDatabase } from '../../db';
import './SettingsScreen.css';

type Section = 'pricing' | 'categories' | 'reference';
type Notice = { kind: 'success' | 'error'; text: string };
type RateKey = 'gold_per_g_paise' | 'certification_per_ct_paise';
type Purity = {
  id: number;
  name: string;
  percentBp: number;
  isArchived: number;
};
type Shape = { id: number; code: string; name: string; isArchived: number };
type Combination = {
  id: number;
  shapeId: number;
  shapeCode: string;
  shapeName: string;
  quality: string;
  ratePerCtPaise: number;
  isArchived: number;
};
type StoneType = {
  id: number;
  name: string;
  tagLabel: string;
  weightUnit: 'ct' | 'g';
  ratePaisePerUnit: number;
  isArchived: number;
};
type GoldType = { id: number; name: string; isArchived: number };
type Category = {
  id: number;
  name: string;
  seriesId: number;
  prefix: string;
  nextNumber: number;
  numberWidth: number;
  rangeEnd: number | null;
  sortOrder: number;
  isArchived: number;
};
type ReferenceKind = 'purity' | 'shape' | 'combination' | 'stone' | 'gold';
type ReferenceDraft = {
  kind: ReferenceKind;
  id?: number;
  name: string;
  percent: string;
  shapeId: string;
  quality: string;
  rate: string;
  tagLabel: string;
  weightUnit: 'ct' | 'g';
};
type CategoryDraft = {
  id?: number;
  name: string;
  prefix: string;
  nextNumber: string;
  numberWidth: string;
  rangeEnd: string;
  sortOrder: string;
};

type Props = { onDirtyChange: (dirty: boolean) => void };

const moneyInput = (paise: number) => (paise / 100).toFixed(2);
const parseNumericInput = (value: string) =>
  Number(value.replace(/,/g, '').trim());
const formatIndianInput = (value: string) => {
  const raw = value.replace(/,/g, '').trim();
  if (!raw || !Number.isFinite(Number(raw))) return value;
  const [whole, decimal] = raw.split('.');
  const grouped = Number(whole || '0').toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  });
  return decimal !== undefined ? `${grouped}.${decimal}` : grouped;
};
const formatMoney = (paise: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(paise / 100);

function SettingsScreen({ onDirtyChange }: Props) {
  const [section, setSection] = useState<Section>('pricing');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [goldRate, setGoldRate] = useState('0.00');
  const [savedGoldRate, setSavedGoldRate] = useState('0.00');
  const [certificationRate, setCertificationRate] = useState('0.00');
  const [savedCertificationRate, setSavedCertificationRate] = useState('0.00');
  const [wastagePercentValue, setWastagePercentValue] = useState('8');
  const [wastagePerGramValue, setWastagePerGramValue] = useState('0.00');
  const [savedWastagePercent, setSavedWastagePercent] = useState('8');
  const [savedWastagePerGram, setSavedWastagePerGram] = useState('0.00');
  const [wastagePricingMethod, setWastagePricingMethod] = useState<'percent' | 'per_gram'>('percent');
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [editingRate, setEditingRate] = useState<RateKey | 'wastage' | null>(
    null,
  );
  const [gstRate, setGstRate] = useState('3');
  const [businessState, setBusinessState] = useState('Maharashtra');
  const [gstEditing, setGstEditing] = useState(false);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [stones, setStones] = useState<StoneType[]>([]);
  const [goldTypes, setGoldTypes] = useState<GoldType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft | null>(
    null,
  );
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const [
        rates,
        settings,
        purityRows,
        shapeRows,
        combinationRows,
        stoneRows,
        goldRows,
        categoryRows,
      ] = await Promise.all([
        db.select<{ rate_key: string; value: number }[]>(
          'SELECT rate_key, value FROM global_rate',
        ),
        db.select<{ key: string; value: string | null }[]>(
          'SELECT key, value FROM app_setting',
        ),
        db.select<Purity[]>(
          'SELECT id, name, percent_bp AS percentBp, is_archived AS isArchived FROM purity ORDER BY is_archived, name',
        ),
        db.select<Shape[]>(
          'SELECT id, code, name, is_archived AS isArchived FROM diamond_shape ORDER BY sort_order, name',
        ),
        db.select<Combination[]>(
          'SELECT dc.id, dc.shape_id AS shapeId, ds.code AS shapeCode, ds.name AS shapeName, dc.quality, dc.rate_per_ct_paise AS ratePerCtPaise, dc.is_archived AS isArchived FROM diamond_combination dc JOIN diamond_shape ds ON ds.id = dc.shape_id ORDER BY dc.is_archived, ds.sort_order, dc.quality',
        ),
        db.select<StoneType[]>(
          'SELECT id, name, tag_label AS tagLabel, weight_unit AS weightUnit, rate_paise_per_unit AS ratePaisePerUnit, is_archived AS isArchived FROM stone_type ORDER BY is_archived, sort_order, name',
        ),
        db.select<GoldType[]>(
          'SELECT id, name, is_archived AS isArchived FROM gold_type ORDER BY is_archived, sort_order, name',
        ),
        db.select<Category[]>(
          'SELECT c.id, c.name, c.series_id AS seriesId, s.prefix, s.next_number AS nextNumber, s.number_width AS numberWidth, s.range_end AS rangeEnd, c.sort_order AS sortOrder, c.is_archived AS isArchived FROM category c LEFT JOIN item_series s ON s.id = c.series_id ORDER BY c.is_archived, c.sort_order, c.name',
        ),
      ]);
      const rate = (key: string) =>
        rates.find((row) => row.rate_key === key)?.value ?? 0;
      const setting = (key: string) =>
        settings.find((row) => row.key === key)?.value;
      setGoldRate(formatIndianInput(moneyInput(rate('gold_per_g_paise'))));
      setSavedGoldRate(formatIndianInput(moneyInput(rate('gold_per_g_paise'))));
      setCertificationRate(
        formatIndianInput(moneyInput(rate('certification_per_ct_paise'))),
      );
      setSavedCertificationRate(
        formatIndianInput(moneyInput(rate('certification_per_ct_paise'))),
      );
      setWastagePercentValue(String(rate('wastage_percent_bp') / 100));
      setSavedWastagePercent(String(rate('wastage_percent_bp') / 100));
      setWastagePerGramValue(
        formatIndianInput(moneyInput(rate('wastage_per_g_paise'))),
      );
      setSavedWastagePerGram(
        formatIndianInput(moneyInput(rate('wastage_per_g_paise'))),
      );
      setGstRate(String(Number(setting('gst_rate_bp') ?? '300') / 100));
      setBusinessState(setting('business_state') ?? 'Maharashtra');
      setWastagePricingMethod(
        setting('wastage_pricing_method') === 'per_gram' ? 'per_gram' : 'percent',
      );
      setPurities(purityRows);
      setShapes(shapeRows);
      setCombinations(combinationRows);
      setStones(stoneRows);
      setGoldTypes(goldRows);
      setCategories(categoryRows);
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error ? error.message : 'Could not load Settings.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onDirtyChange(
      Boolean(editingRate || gstEditing || referenceDraft || categoryDraft),
    );
  }, [editingRate, gstEditing, referenceDraft, categoryDraft, onDirtyChange]);

  async function saveRate(key: RateKey, value: string) {
    const numeric = parseNumericInput(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setNotice({ kind: 'error', text: 'Enter a valid non-negative rate.' });
      return;
    }
    setBusy(true);
    try {
      const db = await getDatabase();
      await db.execute(
        "UPDATE global_rate SET value = ?, updated_at = datetime('now','localtime') WHERE rate_key = ?",
        [Math.round(numeric * 100), key],
      );
      setEditingRate(null);
      setNotice({ kind: 'success', text: 'Rate saved.' });
      await load();
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not save rate.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function selectWastagePricingMethod(mode: 'percent' | 'per_gram') {
    setWastagePricingMethod(mode);
    try {
      const db = await getDatabase();
      await db.execute(
        `INSERT INTO app_setting (key, value) VALUES ('wastage_pricing_method', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [mode],
      );
      setNotice({
        kind: 'success',
        text: mode === 'percent'
          ? 'Global wastage rule set to percentage.'
          : 'Global wastage rule set to fixed charge per gram.',
      });
    } catch (error) {
      setNotice({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not update the global wastage rule.',
      });
    }
  }

  async function saveWastage(mode: 'percent' | 'per_gram', value: string) {
    const numeric = parseNumericInput(value);
    if (
      !Number.isFinite(numeric) ||
      numeric < 0 ||
      (mode === 'percent' && numeric > 100)
    ) {
      setNotice({
        kind: 'error',
        text:
          mode === 'percent'
            ? 'Wastage must be between 0 and 100%.'
            : 'Enter a valid non-negative wastage rate.',
      });
      return;
    }
    setBusy(true);
    try {
      const db = await getDatabase();
      const rateKey =
        mode === 'percent' ? 'wastage_percent_bp' : 'wastage_per_g_paise';
      await db.execute(
        "UPDATE global_rate SET value = ?, updated_at = datetime('now','localtime') WHERE rate_key = ?",
        [Math.round(numeric * 100), rateKey],
      );
      setNotice({
        kind: 'success',
        text:
          mode === 'percent'
            ? 'Global wastage percentage saved.'
            : 'Global wastage charge saved.',
      });
      await load();
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not save wastage settings.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function saveGst(event: FormEvent) {
    event.preventDefault();
    const numeric = parseNumericInput(gstRate);
    if (
      !Number.isFinite(numeric) ||
      numeric < 0 ||
      numeric > 100 ||
      !businessState.trim()
    ) {
      setNotice({
        kind: 'error',
        text: 'Enter a valid GST percentage and state.',
      });
      return;
    }
    setBusy(true);
    try {
      await invoke('save_gst_settings', {
        gstRateBp: Math.round(numeric * 100),
        businessState: businessState.trim(),
      });
      setGstEditing(false);
      setNotice({ kind: 'success', text: 'GST settings saved.' });
      await load();
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not save GST settings.',
      });
    } finally {
      setBusy(false);
    }
  }

  function openReference(
    kind: ReferenceKind,
    row?: Purity | Shape | Combination | StoneType | GoldType,
  ) {
    // Each reference-data modal starts with its own clean error state.
    setReferenceError(null);
    if (kind === 'purity') {
      const item = row as Purity | undefined;
      setReferenceDraft({
        kind,
        id: item?.id,
        name: item?.name ?? '',
        percent: item ? String(item.percentBp / 100) : '',
        shapeId: '',
        quality: '',
        rate: '',
        tagLabel: '',
        weightUnit: 'ct',
      });
    } else if (kind === 'shape') {
      const item = row as Shape | undefined;
      setReferenceDraft({
        kind,
        id: item?.id,
        name: item?.name ?? '',
        percent: '',
        shapeId: '',
        quality: '',
        rate: '',
        tagLabel: item?.code ?? '',
        weightUnit: 'ct',
      });
    } else if (kind === 'combination') {
      const item = row as Combination | undefined;
      setReferenceDraft({
        kind,
        id: item?.id,
        name: '',
        percent: '',
        shapeId: String(
          item?.shapeId ?? shapes.find((shape) => !shape.isArchived)?.id ?? '',
        ),
        quality: item?.quality ?? '',
        rate: item ? moneyInput(item.ratePerCtPaise) : '0',
        tagLabel: '',
        weightUnit: 'ct',
      });
    } else if (kind === 'stone') {
      const item = row as StoneType | undefined;
      setReferenceDraft({
        kind,
        id: item?.id,
        name: item?.name ?? '',
        percent: '',
        shapeId: '',
        quality: '',
        rate: item ? moneyInput(item.ratePaisePerUnit) : '0',
        tagLabel: item?.tagLabel ?? '',
        weightUnit: item?.weightUnit ?? 'ct',
      });
    } else {
      const item = row as GoldType | undefined;
      setReferenceDraft({
        kind,
        id: item?.id,
        name: item?.name ?? '',
        percent: '',
        shapeId: '',
        quality: '',
        rate: '',
        tagLabel: '',
        weightUnit: 'ct',
      });
    }
  }

  async function saveReference(event: FormEvent) {
    event.preventDefault();
    if (!referenceDraft) return;
    const draft = referenceDraft;
    setReferenceError(null);
    const name = draft.name.trim();
    if (draft.kind !== 'combination' && !name) {
      setReferenceError('Name is required.');
      return;
    }
    setBusy(true);
    try {
      const db = await getDatabase();
      if (draft.kind === 'purity') {
        const duplicate = await db.select<{ id: number }[]>(
          'SELECT id FROM purity WHERE lower(trim(name)) = lower(trim(?)) AND id != COALESCE(?, -1)',
          [name, draft.id ?? -1],
        );
        if (duplicate.length)
          throw new Error('A purity with this name already exists.');
        const percent = parseNumericInput(draft.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100)
          throw new Error('Purity must be greater than 0% and at most 100%.');
        if (draft.id)
          await db.execute(
            'UPDATE purity SET name = ?, percent_bp = ? WHERE id = ?',
            [name, Math.round(percent * 100), draft.id],
          );
        else
          await db.execute(
            'INSERT INTO purity (name, percent_bp) VALUES (?, ?)',
            [name, Math.round(percent * 100)],
          );
      } else if (draft.kind === 'shape') {
        const duplicateName = await db.select<{ id: number }[]>(
          'SELECT id FROM diamond_shape WHERE lower(trim(name)) = lower(trim(?)) AND id != COALESCE(?, -1)',
          [name, draft.id ?? -1],
        );
        if (duplicateName.length)
          throw new Error('A diamond shape with this name already exists.');
        const code = draft.tagLabel.trim().toUpperCase();
        if (!code) throw new Error('Diamond shape code is required.');
        const duplicateCode = await db.select<{ id: number }[]>(
          'SELECT id FROM diamond_shape WHERE upper(trim(code)) = upper(trim(?)) AND id != COALESCE(?, -1)',
          [code, draft.id ?? -1],
        );
        if (duplicateCode.length)
          throw new Error('This diamond shape code is already in use.');
        if (draft.id)
          await db.execute(
            'UPDATE diamond_shape SET code = ?, name = ? WHERE id = ?',
            [code, name, draft.id],
          );
        else
          await db.execute(
            'INSERT INTO diamond_shape (code, name, sort_order) VALUES (?, ?, ?)',
            [code, name, shapes.length + 1],
          );
      } else if (draft.kind === 'combination') {
        const shapeId = Number(draft.shapeId);
        const quality = draft.quality.trim();
        const rate = parseNumericInput(draft.rate);
        if (!shapeId || !quality || !Number.isFinite(rate) || rate < 0)
          throw new Error(
            'Select a diamond shape, enter a quality and a valid rate.',
          );
        const duplicateCombination = await db.select<{ id: number }[]>(
          'SELECT id FROM diamond_combination WHERE shape_id = ? AND lower(trim(quality)) = lower(trim(?)) AND id != COALESCE(?, -1)',
          [shapeId, quality, draft.id ?? -1],
        );
        if (duplicateCombination.length)
          throw new Error('This shape and quality combination already exists.');
        if (draft.id)
          await db.execute(
            "UPDATE diamond_combination SET shape_id = ?, quality = ?, rate_per_ct_paise = ?, updated_at = datetime('now','localtime') WHERE id = ?",
            [shapeId, quality, Math.round(rate * 100), draft.id],
          );
        else
          await db.execute(
            'INSERT INTO diamond_combination (shape_id, quality, rate_per_ct_paise) VALUES (?, ?, ?)',
            [shapeId, quality, Math.round(rate * 100)],
          );
      } else if (draft.kind === 'stone') {
        const rate = parseNumericInput(draft.rate);
        const tagLabel = draft.tagLabel.trim();
        if (!tagLabel || !Number.isFinite(rate) || rate < 0)
          throw new Error(
            'Tag label and a valid non-negative rate are required.',
          );
        const duplicateStoneName = await db.select<{ id: number }[]>(
          'SELECT id FROM stone_type WHERE lower(trim(name)) = lower(trim(?)) AND id != COALESCE(?, -1)',
          [name, draft.id ?? -1],
        );
        if (duplicateStoneName.length)
          throw new Error('A stone type with this name already exists.');
        const duplicateStoneLabel = await db.select<{ id: number }[]>(
          'SELECT id FROM stone_type WHERE upper(trim(tag_label)) = upper(trim(?)) AND id != COALESCE(?, -1)',
          [tagLabel, draft.id ?? -1],
        );
        if (duplicateStoneLabel.length)
          throw new Error('This stone tag label is already in use.');
        if (draft.id)
          await db.execute(
            "UPDATE stone_type SET name = ?, tag_label = ?, weight_unit = ?, rate_paise_per_unit = ?, updated_at = datetime('now','localtime') WHERE id = ?",
            [
              name,
              tagLabel,
              draft.weightUnit,
              Math.round(rate * 100),
              draft.id,
            ],
          );
        else
          await db.execute(
            'INSERT INTO stone_type (name, tag_label, weight_unit, rate_paise_per_unit) VALUES (?, ?, ?, ?)',
            [name, tagLabel, draft.weightUnit, Math.round(rate * 100)],
          );
      } else {
        if (draft.id)
          await db.execute('UPDATE gold_type SET name = ? WHERE id = ?', [
            name,
            draft.id,
          ]);
        else
          await db.execute('INSERT INTO gold_type (name) VALUES (?)', [name]);
      }
      setReferenceDraft(null);
      setNotice({ kind: 'success', text: 'Reference data saved.' });
      await load();
    } catch (error) {
      setReferenceError(
        error instanceof Error
          ? error.message
          : 'Could not save reference data. Check for duplicate names or values.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryDraft) return;
    const draft = categoryDraft;
    const name = draft.name.trim();
    const next = Number(draft.nextNumber);
    const width = Number(draft.numberWidth);
    const end = draft.rangeEnd.trim() ? Number(draft.rangeEnd) : null;
    const order = Number(draft.sortOrder);
    if (
      !name ||
      !Number.isSafeInteger(next) ||
      next < 1 ||
      !Number.isInteger(width) ||
      width < 0 ||
      (end !== null && (!Number.isSafeInteger(end) || end < next)) ||
      !Number.isFinite(order)
    ) {
      setNotice({
        kind: 'error',
        text: 'Check the category name and numbering values. Next number must be at least 1 and range end cannot be below it.',
      });
      return;
    }
    if (categoryDraft.id) {
      const current = categories.find((item) => item.id === categoryDraft.id);
      if (current && next < current.nextNumber) {
        setNotice({
          kind: 'error',
          text: 'Next number cannot move backwards. Item numbers are never reused.',
        });
        return;
      }
    }
    setBusy(true);
    try {
      await invoke('save_category_settings', {
        categoryId: draft.id ?? null,
        name,
        prefix: draft.prefix.trim(),
        nextNumber: next,
        numberWidth: width,
        rangeEnd: end,
        sortOrder: order,
      });
      setCategoryDraft(null);
      setNotice({ kind: 'success', text: 'Category numbering saved.' });
      await load();
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Could not save category. Check for duplicate names or prefixes.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive(
    table:
      | 'purity'
      | 'diamond_shape'
      | 'diamond_combination'
      | 'stone_type'
      | 'gold_type'
      | 'category',
    id: number,
    archived: number,
    label: string,
  ) {
    const action = archived ? 'restore' : 'archive';
    if (
      !window.confirm(
        `${action === 'archive' ? 'Archive' : 'Restore'} ${label}? ${action === 'archive' ? 'It will no longer be available for new items or selections, but historical records will be retained.' : 'It will become available for new items or selections again.'}`,
      )
    )
      return;
    setBusy(true);
    try {
      const db = await getDatabase();
      if (!archived) {
        const dependencyQuery: Partial<Record<typeof table, string>> = {
          purity: 'SELECT COUNT(*) AS count FROM item WHERE purity_id = ?',
          diamond_shape:
            'SELECT (SELECT COUNT(*) FROM item_diamond WHERE shape_id = ?) + (SELECT COUNT(*) FROM diamond_combination WHERE shape_id = ? AND is_archived = 0) AS count',
          diamond_combination:
            'SELECT COUNT(*) AS count FROM item_diamond WHERE combination_id = ?',
          stone_type:
            'SELECT COUNT(*) AS count FROM item_stone WHERE stone_type_id = ?',
          gold_type:
            'SELECT COUNT(*) AS count FROM item WHERE gold_type_id = ?',
        };
        const query = dependencyQuery[table];
        if (query) {
          const params = table === 'diamond_shape' ? [id, id] : [id];
          const rows = await db.select<{ count: number }[]>(query, params);
          if ((rows[0]?.count ?? 0) > 0) {
            throw new Error(
              'This record is used by inventory items or active combinations. Reassign or archive dependent records first so existing items remain editable.',
            );
          }
        }
      }
      await db.execute(`UPDATE ${table} SET is_archived = ? WHERE id = ?`, [
        archived ? 0 : 1,
        id,
      ]);
      setNotice({
        kind: 'success',
        text: `${label} ${action === 'archive' ? 'archived' : 'restored'}.`,
      });
      await load();
    } catch (error) {
      setNotice({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : `Could not ${action} ${label}. Existing records may depend on it.`,
      });
    } finally {
      setBusy(false);
    }
  }

  const startCategoryEdit = (row?: Category) =>
    setCategoryDraft(
      row
        ? {
            id: row.id,
            name: row.name,
            prefix: row.prefix ?? '',
            nextNumber: String(row.nextNumber),
            numberWidth: String(row.numberWidth),
            rangeEnd: row.rangeEnd == null ? '' : String(row.rangeEnd),
            sortOrder: String(row.sortOrder),
          }
        : {
            name: '',
            prefix: '',
            nextNumber: '1',
            numberWidth: '3',
            rangeEnd: '',
            sortOrder: String(categories.length + 1),
          },
    );

  if (loading)
    return (
      <div className='settings-screen'>
        <p className='settings-loading'>Loading Settings…</p>
      </div>
    );

  return (
    <div className='settings-screen'>
      <header className='settings-heading'>
        <div>
          <p className='settings-eyebrow'>APPLICATION CONFIGURATION</p>
          <h1 className='app-page-title'>Settings</h1>
          <p className='app-page-description'>
            Pricing rules and reference data used when adding inventory,
            estimating jewelry cost and preparing customer selections.
          </p>
        </div>
      </header>
      {notice && (
        <div
          className={`settings-notice settings-notice--${notice.kind}`}
          role='status'
        >
          <span>{notice.text}</span>
          <button
            type='button'
            aria-label='Dismiss message'
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      <nav className='settings-tabs' aria-label='Settings sections'>
        <button
          className={section === 'pricing' ? 'is-active' : ''}
          onClick={() => setSection('pricing')}
          type='button'
        >
          Pricing &amp; rates
        </button>
        <button
          className={section === 'categories' ? 'is-active' : ''}
          onClick={() => setSection('categories')}
          type='button'
        >
          Categories &amp; numbering
        </button>
        <button
          className={section === 'reference' ? 'is-active' : ''}
          onClick={() => setSection('reference')}
          type='button'
        >
          Reference data
        </button>
      </nav>

      {section === 'pricing' && (
        <div className='settings-content settings-pricing-content'>
          <aside className='settings-prototype-note'>
            <span className='settings-prototype-note__icon' aria-hidden='true'>
              i
            </span>
            <p>
              <strong>These are default rates.</strong> A customer selection can
              override them for that selection only. Editing a rate here never
              changes a negotiated selection price or an existing order.{' '}
            </p>
          </aside>

          <section className='settings-card settings-gold-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Gold</h2>
                <p>
                  One global rate applies to every purity. Purity only sets the
                  actual gold percentage.
                </p>
              </div>
            </div>
            <div className='settings-gold-rate-area'>
              <div className='settings-gold-input-block'>
                <label className='settings-field-caption'>
                  Gold rate (global){' '}
                </label>
                <form
                  className='settings-inline-edit settings-prototype-input'
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveRate('gold_per_g_paise', goldRate);
                  }}
                >
                  <span className='settings-input-prefix'>₹</span>
                  <input
                    type='text'
                    inputMode='decimal'
                    aria-label='Gold rate per gram'
                    value={goldRate}
                    onChange={(e) => setGoldRate(e.target.value)}
                    onBlur={() => setGoldRate(formatIndianInput(goldRate))}
                  />
                  <span className='settings-input-unit'>per gram</span>
                  {parseNumericInput(goldRate) !==
                    parseNumericInput(savedGoldRate) && (
                    <button
                      className='settings-button settings-button--primary'
                      disabled={busy}
                    >
                      Save
                    </button>
                  )}
                </form>
                <small>
                  Saved value:{' '}
                  {formatMoney(Math.round(parseNumericInput(goldRate) * 100))} ·{' '}
                  <span className='settings-not-set'>Not set</span>
                </small>
              </div>
              <div className='settings-rate-help'>
                <span>Last updated: not set yet.</span>
                <span>
                  Changing this rate does not alter negotiated selection prices
                  or existing orders.
                </span>
              </div>
            </div>
            <div className='settings-subsection-heading'>
              <strong>Purity reference</strong>
              <button
                type='button'
                className='settings-button'
                onClick={() => openReference('purity')}
              >
                + Add purity
              </button>
            </div>
            <div className='settings-table-wrap'>
              <table className='settings-table'>
                <thead>
                  <tr>
                    <th>Purity</th>
                    <th>Actual gold</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {purities.map((row) => (
                    <tr
                      key={row.id}
                      className={row.isArchived ? 'is-archived' : ''}
                    >
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td className='settings-number-cell'>
                        {(row.percentBp / 100).toFixed(2)} %
                      </td>
                      <td>
                        <span
                          className={`settings-status ${row.isArchived ? 'settings-status--archived' : ''}`}
                        >
                          {row.isArchived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className='settings-row-actions'>
                        <button
                          className='settings-text-action'
                          type='button'
                          disabled={busy || !!row.isArchived}
                          onClick={() => openReference('purity', row)}
                        >
                          Edit
                        </button>
                        <button
                          className='settings-text-action settings-text-action--danger'
                          type='button'
                          disabled={busy}
                          onClick={() =>
                            void toggleArchive(
                              'purity',
                              row.id,
                              row.isArchived,
                              row.name,
                            )
                          }
                        >
                          {row.isArchived ? 'Restore' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className='settings-card settings-wastage-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Wastage</h2>
                <p>
                  Configure global defaults. Neither method is automatically
                  selected; choose global percentage, global fixed charge, or a
                  local custom value when pricing an item or selection.
                </p>
              </div>
            </div>
            <div className='settings-wastage-options'>
              <form
                className={`settings-wastage-option${wastagePricingMethod === 'percent' ? ' is-selected' : ''}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveWastage('percent', wastagePercentValue);
                }}
              >
                <label className='settings-wastage-choice'>
                  <input
                    type='radio'
                    name='global-wastage-pricing-method'
                    checked={wastagePricingMethod === 'percent'}
                    onChange={() => void selectWastagePricingMethod('percent')}
                  />
                  <strong>Global percentage</strong>
                </label>
                <span className='settings-field-caption'>
                  Percentage of gold weight
                </span>
                <span className='settings-unit-input'>
                  <input
                    type='text'
                    inputMode='decimal'
                    aria-label='Global wastage percentage'
                    value={wastagePercentValue}
                    onChange={(e) => setWastagePercentValue(e.target.value)}
                    onBlur={() =>
                      setWastagePercentValue(
                        formatIndianInput(wastagePercentValue),
                      )
                    }
                  />
                  <span>%</span>
                </span>
                {parseNumericInput(wastagePercentValue) !==
                  parseNumericInput(savedWastagePercent) && (
                  <button
                    className='settings-button settings-button--primary'
                    disabled={busy}
                  >
                    Save percentage
                  </button>
                )}
              </form>
              <form
                className={`settings-wastage-option${wastagePricingMethod === 'per_gram' ? ' is-selected' : ''}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveWastage('per_gram', wastagePerGramValue);
                }}
              >
                <label className='settings-wastage-choice'>
                  <input
                    type='radio'
                    name='global-wastage-pricing-method'
                    checked={wastagePricingMethod === 'per_gram'}
                    onChange={() => void selectWastagePricingMethod('per_gram')}
                  />
                  <strong>Global fixed charge</strong>
                </label>
                <span className='settings-field-caption'>Charge per gram</span>
                <span className='settings-unit-input'>
                  <span>₹</span>
                  <input
                    type='text'
                    inputMode='decimal'
                    aria-label='Global wastage charge per gram'
                    value={wastagePerGramValue}
                    onChange={(e) => setWastagePerGramValue(e.target.value)}
                    onBlur={() =>
                      setWastagePerGramValue(
                        formatIndianInput(wastagePerGramValue),
                      )
                    }
                  />
                  <span>per gram</span>
                </span>
                {parseNumericInput(wastagePerGramValue) !==
                  parseNumericInput(savedWastagePerGram) && (
                  <button
                    className='settings-button settings-button--primary'
                    disabled={busy}
                  >
                    Save fixed charge
                  </button>
                )}
              </form>
            </div>
          </section>

          <section className='settings-card settings-table-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Diamond pricing</h2>
                <p>
                  Rate per carat for each shape and quality combination.
                  Reference shapes and qualities are managed in Reference Data.
                </p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('combination')}
              >
                + Add combination
              </button>
            </div>
            <div className='settings-table-wrap'>
              <table className='settings-table'>
                <thead>
                  <tr>
                    <th>Shape + quality</th>
                    <th>Rate per carat</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {combinations.map((row) => (
                    <tr
                      key={row.id}
                      className={row.isArchived ? 'is-archived' : ''}
                    >
                      <td>
                        <strong>
                          {row.shapeName} + {row.quality}
                        </strong>
                      </td>
                      <td className='settings-number-cell'>
                        {formatMoney(row.ratePerCtPaise)}
                      </td>
                      <td>
                        <span
                          className={`settings-status ${row.isArchived ? 'settings-status--archived' : ''}`}
                        >
                          {row.isArchived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className='settings-row-actions'>
                        <button
                          type='button'
                          className='settings-text-action'
                          disabled={busy || !!row.isArchived}
                          onClick={() => openReference('combination', row)}
                        >
                          Edit
                        </button>
                        <button
                          type='button'
                          className='settings-text-action settings-text-action--danger'
                          disabled={busy}
                          onClick={() =>
                            void toggleArchive(
                              'diamond_combination',
                              row.id,
                              row.isArchived,
                              `${row.shapeCode} ${row.quality}`,
                            )
                          }
                        >
                          {row.isArchived ? 'Restore' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className='settings-card settings-table-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Other stones</h2>
                <p>
                  Rate per unit for each stone type. The unit is set per stone.
                </p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('stone')}
              >
                + Add stone
              </button>
            </div>
            <div className='settings-table-wrap'>
              <table className='settings-table'>
                <thead>
                  <tr>
                    <th>Stone type</th>
                    <th>Unit</th>
                    <th>Rate per unit</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {stones.map((row) => (
                    <tr
                      key={row.id}
                      className={row.isArchived ? 'is-archived' : ''}
                    >
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{row.weightUnit === 'ct' ? 'Carat' : 'Gram'}</td>
                      <td className='settings-number-cell'>
                        {formatMoney(row.ratePaisePerUnit)} / {row.weightUnit}
                      </td>
                      <td>
                        <span
                          className={`settings-status ${row.isArchived ? 'settings-status--archived' : ''}`}
                        >
                          {row.isArchived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      <td className='settings-row-actions'>
                        <button
                          type='button'
                          className='settings-text-action'
                          disabled={busy || !!row.isArchived}
                          onClick={() => openReference('stone', row)}
                        >
                          Edit
                        </button>
                        <button
                          type='button'
                          className='settings-text-action settings-text-action--danger'
                          disabled={busy}
                          onClick={() =>
                            void toggleArchive(
                              'stone_type',
                              row.id,
                              row.isArchived,
                              row.name,
                            )
                          }
                        >
                          {row.isArchived ? 'Restore' : 'Archive'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className='settings-bottom-grid'>
            <section className='settings-card settings-certification-card'>
              <div className='settings-card-heading'>
                <div>
                  <h2>Certification</h2>
                  <p>
                    Charged per carat of certified diamond and added to the
                    estimated jewelry cost.
                  </p>
                </div>
              </div>
              <label className='settings-field-caption'>
                Certification charge{' '}
              </label>
              <form
                className='settings-inline-edit settings-prototype-input'
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRate(
                    'certification_per_ct_paise',
                    certificationRate,
                  );
                }}
              >
                <span className='settings-input-prefix'>₹</span>
                <input
                  type='text'
                  inputMode='decimal'
                  aria-label='Certification charge per diamond carat'
                  value={certificationRate}
                  onChange={(e) => setCertificationRate(e.target.value)}
                  onBlur={() =>
                    setCertificationRate(formatIndianInput(certificationRate))
                  }
                />
                <span className='settings-input-unit'>per diamond carat</span>
                {parseNumericInput(certificationRate) !==
                  parseNumericInput(savedCertificationRate) && (
                  <button
                    className='settings-button settings-button--primary'
                    disabled={busy}
                  >
                    Save
                  </button>
                )}
              </form>
            </section>
            <section className='settings-card settings-gst-card'>
              <div className='settings-card-heading'>
                <div>
                  <h2>GST</h2>
                  <p>
                    Domestic jewelry GST. The split follows where the
                    transaction takes place.
                  </p>
                </div>
              </div>
              {gstEditing ? (
                <form
                  className='settings-gst-form'
                  onSubmit={(e) => void saveGst(e)}
                >
                  <label>
                    GST rate (%)
                    <input
                      type='text'
                      inputMode='decimal'
                      value={gstRate}
                      onChange={(e) => setGstRate(e.target.value)}
                    />
                  </label>
                  <label>
                    Business state
                    <input
                      value={businessState}
                      onChange={(e) => setBusinessState(e.target.value)}
                      required
                    />
                  </label>
                  <div className='settings-form-actions'>
                    <button
                      className='settings-button settings-button--primary'
                      disabled={busy}
                    >
                      Save GST
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      onClick={() => {
                        setGstEditing(false);
                        void load();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <label className='settings-field-caption'>GST rate</label>
                  <button
                    type='button'
                    className='settings-gst-rate-display'
                    onClick={() => setGstEditing(true)}
                  >
                    <strong>{Number(gstRate).toFixed(2)}</strong>
                    <span>%</span>
                    <em>Edit</em>
                  </button>
                  <div className='settings-gst-splits'>
                    <div>
                      <strong>{businessState || 'Maharashtra'}</strong>
                      <span>
                        CGST {(Number(gstRate) / 2).toFixed(2)}% + SGST{' '}
                        {(Number(gstRate) / 2).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <strong>Outside {businessState || 'Maharashtra'}</strong>
                      <span>IGST {Number(gstRate).toFixed(2)}%</span>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      {section === 'categories' && (
        <section className='settings-card settings-table-card'>
          <div className='settings-card-heading'>
            <div>
              <h2>Categories &amp; item numbering</h2>
              <p>
                Each category has its own sequence. Item numbers already issued
                are never changed or reused.
              </p>
            </div>
            <button
              type='button'
              className='settings-button settings-button--primary'
              onClick={() => startCategoryEdit()}
            >
              + Add category
            </button>
          </div>
          <div className='settings-table-wrap'>
            <table className='settings-table'>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Prefix</th>
                  <th>Next number</th>
                  <th>Width</th>
                  <th>Range end</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr
                    key={row.id}
                    className={row.isArchived ? 'is-archived' : ''}
                  >
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>
                      <code>
                        <strong>{row.prefix}</strong>
                      </code>
                    </td>
                    <td>
                      <strong>{`${row.prefix}${String(row.nextNumber).padStart(row.numberWidth, '0')}`}</strong>
                    </td>
                    <td>{row.numberWidth}</td>
                    <td>{row.rangeEnd ?? 'Open'}</td>
                    <td>
                      <span
                        className={`settings-status ${row.isArchived ? 'settings-status--archived' : ''}`}
                      >
                        {row.isArchived ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    <td className='settings-row-actions'>
                      <button
                        type='button'
                        className='settings-button'
                        disabled={busy || !!row.isArchived}
                        onClick={() => startCategoryEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        type='button'
                        className='settings-button'
                        disabled={busy}
                        onClick={() =>
                          void toggleArchive(
                            'category',
                            row.id,
                            row.isArchived,
                            row.name,
                          )
                        }
                      >
                        {row.isArchived ? 'Restore' : 'Archive'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {section === 'reference' && (
        <div className='settings-reference-grid'>
          <section className='settings-card settings-reference-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Purity</h2>
                <p>Gold purity percentage</p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('purity')}
              >
                + Add
              </button>
            </div>
            <div className='settings-reference-list'>
              {purities.map((row) => (
                <div
                  className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`}
                  key={row.id}
                >
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      {(row.percentBp / 100).toFixed(2)}% gold content
                    </span>
                  </div>
                  <div>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy || !!row.isArchived}
                      onClick={() => openReference('purity', row)}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy}
                      onClick={() =>
                        void toggleArchive(
                          'purity',
                          row.id,
                          row.isArchived,
                          row.name,
                        )
                      }
                    >
                      {row.isArchived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className='settings-card settings-reference-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Diamond shapes</h2>
                <p>Codes printed on jewelry tags</p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('shape')}
              >
                + Add
              </button>
            </div>
            <div className='settings-reference-list'>
              {shapes.map((row) => (
                <div
                  className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`}
                  key={row.id}
                >
                  <div>
                    <strong>
                      {row.code} · {row.name}
                    </strong>
                    <span>
                      {row.isArchived
                        ? 'Archived'
                        : 'Available for combinations'}
                    </span>
                  </div>
                  <div>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy || !!row.isArchived}
                      onClick={() => openReference('shape', row)}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy}
                      onClick={() =>
                        void toggleArchive(
                          'diamond_shape',
                          row.id,
                          row.isArchived,
                          row.code,
                        )
                      }
                    >
                      {row.isArchived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className='settings-card settings-reference-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Diamond combinations</h2>
                <p>Quality and rate per carat</p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('combination')}
              >
                + Add
              </button>
            </div>
            <div className='settings-reference-list'>
              {combinations.map((row) => (
                <div
                  className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`}
                  key={row.id}
                >
                  <div>
                    <strong>
                      {row.shapeCode} · {row.quality}
                    </strong>
                    <span>
                      {row.shapeName} · {formatMoney(row.ratePerCtPaise)} / ct
                    </span>
                  </div>
                  <div>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy || !!row.isArchived}
                      onClick={() => openReference('combination', row)}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy}
                      onClick={() =>
                        void toggleArchive(
                          'diamond_combination',
                          row.id,
                          row.isArchived,
                          `${row.shapeCode} ${row.quality}`,
                        )
                      }
                    >
                      {row.isArchived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className='settings-card settings-reference-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Stone types</h2>
                <p>Tag label, unit, and rate</p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('stone')}
              >
                + Add
              </button>
            </div>
            <div className='settings-reference-list'>
              {stones.map((row) => (
                <div
                  className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`}
                  key={row.id}
                >
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      {row.tagLabel} · {formatMoney(row.ratePaisePerUnit)} /{' '}
                      {row.weightUnit}
                    </span>
                  </div>
                  <div>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy || !!row.isArchived}
                      onClick={() => openReference('stone', row)}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy}
                      onClick={() =>
                        void toggleArchive(
                          'stone_type',
                          row.id,
                          row.isArchived,
                          row.name,
                        )
                      }
                    >
                      {row.isArchived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className='settings-card settings-reference-card'>
            <div className='settings-card-heading'>
              <div>
                <h2>Gold types</h2>
                <p>Available gold colors</p>
              </div>
              <button
                type='button'
                className='settings-button settings-button--primary'
                onClick={() => openReference('gold')}
              >
                + Add
              </button>
            </div>
            <div className='settings-reference-list'>
              {goldTypes.map((row) => (
                <div
                  className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`}
                  key={row.id}
                >
                  <div>
                    <strong>{row.name}</strong>
                    <span>
                      {row.isArchived ? 'Archived' : 'Available for inventory'}
                    </span>
                  </div>
                  <div>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy || !!row.isArchived}
                      onClick={() => openReference('gold', row)}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='settings-button'
                      disabled={busy}
                      onClick={() =>
                        void toggleArchive(
                          'gold_type',
                          row.id,
                          row.isArchived,
                          row.name,
                        )
                      }
                    >
                      {row.isArchived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {referenceDraft && (
        <div
          className='settings-modal-backdrop'
          role='presentation'
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setReferenceError(null);
              setReferenceDraft(null);
            }
          }}
        >
          <section
            className='settings-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='settings-reference-title'
          >
            <header>
              <div>
                <h2 id='settings-reference-title'>
                  {referenceDraft.id ? 'Edit' : 'Add'}{' '}
                  {referenceDraft.kind === 'purity'
                    ? 'purity'
                    : referenceDraft.kind === 'shape'
                      ? 'diamond shape'
                      : referenceDraft.kind === 'combination'
                        ? 'diamond combination'
                        : referenceDraft.kind === 'stone'
                          ? 'stone type'
                          : 'gold type'}
                </h2>
                <p>
                  Save this record independently. Existing historical records
                  are retained.
                </p>
              </div>
              <button
                type='button'
                aria-label='Close'
                disabled={busy}
                onClick={() => {
                  setReferenceError(null);
                  setReferenceDraft(null);
                }}
              >
                ×
              </button>
            </header>
            <form onSubmit={(e) => void saveReference(e)}>
              <div className='settings-modal-body'>
                {referenceDraft.kind !== 'combination' && (
                  <label>
                    {referenceDraft.kind === 'shape' ? 'Full name' : 'Name'}
                    <input
                      autoFocus
                      value={referenceDraft.name}
                      onChange={(e) =>
                        setReferenceDraft({
                          ...referenceDraft,
                          name: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                )}
                {referenceDraft.kind === 'shape' && (
                  <label>
                    Tag code
                    <input
                      value={referenceDraft.tagLabel}
                      onChange={(e) =>
                        setReferenceDraft({
                          ...referenceDraft,
                          tagLabel: e.target.value,
                        })
                      }
                      placeholder='e.g. RD'
                      required
                    />
                  </label>
                )}
                {referenceDraft.kind === 'purity' && (
                  <label>
                    Gold content (%)
                    <input
                      type='text'
                      inputMode='decimal'
                      min='0.01'
                      max='100'
                      step='0.01'
                      value={referenceDraft.percent}
                      onBlur={() =>
                        setReferenceDraft({
                          ...referenceDraft,
                          percent: formatIndianInput(referenceDraft.percent),
                        })
                      }
                      onChange={(e) =>
                        setReferenceDraft({
                          ...referenceDraft,
                          percent: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                )}
                {referenceDraft.kind === 'combination' && (
                  <>
                    <label>
                      Diamond shape
                      <select
                        value={referenceDraft.shapeId}
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            shapeId: e.target.value,
                          })
                        }
                        required
                      >
                        <option value=''>Select shape</option>
                        {shapes
                          .filter((shape) => !shape.isArchived)
                          .map((shape) => (
                            <option key={shape.id} value={shape.id}>
                              {shape.code} — {shape.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Quality / combination
                      <input
                        autoFocus
                        value={referenceDraft.quality}
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            quality: e.target.value,
                          })
                        }
                        placeholder='e.g. EF-VVS'
                        required
                      />
                    </label>
                    <label>
                      Rate per carat (₹)
                      <input
                        type='text'
                        inputMode='decimal'
                        min='0'
                        step='0.01'
                        value={referenceDraft.rate}
                        onBlur={() =>
                          setReferenceDraft({
                            ...referenceDraft,
                            rate: formatIndianInput(referenceDraft.rate),
                          })
                        }
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            rate: e.target.value,
                          })
                        }
                        required
                      />
                    </label>
                  </>
                )}
                {referenceDraft.kind === 'stone' && (
                  <>
                    <label>
                      Tag label
                      <input
                        value={referenceDraft.tagLabel}
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            tagLabel: e.target.value,
                          })
                        }
                        placeholder='e.g. R ST'
                        required
                      />
                    </label>
                    <label>
                      Weight unit
                      <select
                        value={referenceDraft.weightUnit}
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            weightUnit: e.target.value as 'ct' | 'g',
                          })
                        }
                      >
                        <option value='ct'>Carats (ct)</option>
                        <option value='g'>Grams (g)</option>
                      </select>
                    </label>
                    <label>
                      Rate per {referenceDraft.weightUnit} (₹)
                      <input
                        type='text'
                        inputMode='decimal'
                        min='0'
                        step='0.01'
                        value={referenceDraft.rate}
                        onBlur={() =>
                          setReferenceDraft({
                            ...referenceDraft,
                            rate: formatIndianInput(referenceDraft.rate),
                          })
                        }
                        onChange={(e) =>
                          setReferenceDraft({
                            ...referenceDraft,
                            rate: e.target.value,
                          })
                        }
                        required
                      />
                    </label>
                  </>
                )}
                {referenceDraft.kind === 'gold' && (
                  <p className='settings-modal-help'>
                    Gold type is descriptive; the global gold rate is configured
                    separately.
                  </p>
                )}
              </div>
              {referenceError && (
                <div className='settings-modal-error' role='alert'>
                  <span>{referenceError}</span>
                  <button
                    type='button'
                    className='settings-modal-error-close'
                    aria-label='Dismiss error'
                    onClick={() => setReferenceError(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              <footer>
                <button
                  type='button'
                  className='settings-button'
                  disabled={busy}
                  onClick={() => {
                    setReferenceError(null);
                    setReferenceDraft(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  className='settings-button settings-button--primary'
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {categoryDraft && (
        <div
          className='settings-modal-backdrop'
          role='presentation'
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setCategoryDraft(null);
          }}
        >
          <section
            className='settings-modal settings-category-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='settings-category-title'
          >
            <header>
              <div>
                <h2 id='settings-category-title'>
                  {categoryDraft.id ? 'Edit category' : 'Add category'}
                </h2>
                <p>
                  {categoryDraft.id
                    ? `Editing ${categories.find((item) => item.id === categoryDraft.id)?.name ?? 'category'}`
                    : 'Create a category and configure its item numbering.'}
                </p>
              </div>
              <button
                type='button'
                aria-label='Close'
                disabled={busy}
                onClick={() => setCategoryDraft(null)}
              >
                ×
              </button>
            </header>
            <form onSubmit={(e) => void saveCategory(e)}>
              <div className='settings-modal-body settings-category-form'>
                <label className='settings-category-name'>
                  Name
                  <input
                    autoFocus
                    value={categoryDraft.name}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        name: e.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Prefix
                  <input
                    value={categoryDraft.prefix}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        prefix: e.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Width
                  <input
                    type='text'
                    inputMode='numeric'
                    value={categoryDraft.numberWidth}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        numberWidth: e.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Next number
                  <input
                    type='text'
                    inputMode='numeric'
                    value={categoryDraft.nextNumber}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        nextNumber: e.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Range end (optional)
                  <input
                    type='text'
                    inputMode='numeric'
                    value={categoryDraft.rangeEnd}
                    onChange={(e) =>
                      setCategoryDraft({
                        ...categoryDraft,
                        rangeEnd: e.target.value,
                      })
                    }
                    placeholder='999'
                  />
                </label>
                <div className='settings-number-preview'>
                  <span>NEXT ITEM NUMBER · PREVIEW</span>
                  <strong>
                    {categoryDraft.prefix}
                    {String(
                      Math.max(1, Number(categoryDraft.nextNumber) || 1),
                    ).padStart(
                      Math.max(
                        0,
                        Math.min(12, Number(categoryDraft.numberWidth) || 0),
                      ),
                      '0',
                    )}
                  </strong>
                  <p>
                    Preview only. Nothing is reserved or created until an item
                    is saved.
                  </p>
                </div>
                <p className='settings-category-help'>
                  Existing item numbers never change when you edit a category.
                  Prefixes must be unique.
                </p>
              </div>
              <footer className='settings-category-footer'>
                {categoryDraft.id && (
                  <button
                    type='button'
                    className='settings-button settings-button--danger'
                    disabled={busy}
                    onClick={() => {
                      const row = categories.find(
                        (item) => item.id === categoryDraft.id,
                      );
                      if (row) {
                        void toggleArchive(
                          'category',
                          row.id,
                          row.isArchived,
                          row.name,
                        );
                        setCategoryDraft(null);
                      }
                    }}
                  >
                    Archive
                  </button>
                )}
                <div className='settings-category-footer-actions'>
                  <button
                    type='button'
                    className='settings-button'
                    disabled={busy}
                    onClick={() => setCategoryDraft(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    className='settings-button settings-button--primary'
                    disabled={busy}
                  >
                    {busy ? 'Saving…' : 'Save category'}
                  </button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default SettingsScreen;
