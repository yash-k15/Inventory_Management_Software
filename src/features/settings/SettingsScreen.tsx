import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDatabase } from '../../db';
import './SettingsScreen.css';

type Section = 'pricing' | 'categories' | 'reference';
type Notice = { kind: 'success' | 'error'; text: string };
type RateKey = 'gold_per_g_paise' | 'certification_per_ct_paise';
type RateDraft = { key: RateKey; title: string; unit: string; value: string };
type Purity = { id: number; name: string; percentBp: number; isArchived: number };
type Shape = { id: number; code: string; name: string; isArchived: number };
type Combination = { id: number; shapeId: number; shapeCode: string; shapeName: string; quality: string; ratePerCtPaise: number; isArchived: number };
type StoneType = { id: number; name: string; tagLabel: string; weightUnit: 'ct' | 'g'; ratePaisePerUnit: number; isArchived: number };
type GoldType = { id: number; name: string; isArchived: number };
type Category = { id: number; name: string; seriesId: number; prefix: string; nextNumber: number; numberWidth: number; rangeEnd: number | null; sortOrder: number; isArchived: number };
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

const moneyInput = (paise: number) => (paise / 100).toFixed(2);
const formatMoney = (paise: number) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2,
}).format(paise / 100);

function SettingsScreen() {
  const [section, setSection] = useState<Section>('pricing');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [goldRate, setGoldRate] = useState('0.00');
  const [certificationRate, setCertificationRate] = useState('0.00');
  const [wastageMode, setWastageMode] = useState<'percent' | 'per_gram'>('percent');
  const [wastageValue, setWastageValue] = useState('8');
  const [editingRate, setEditingRate] = useState<RateKey | 'wastage' | null>(null);
  const [gstRate, setGstRate] = useState('3');
  const [businessState, setBusinessState] = useState('Maharashtra');
  const [gstEditing, setGstEditing] = useState(false);
  const [purities, setPurities] = useState<Purity[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [combinations, setCombinations] = useState<Combination[]>([]);
  const [stones, setStones] = useState<StoneType[]>([]);
  const [goldTypes, setGoldTypes] = useState<GoldType[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const [rates, settings, purityRows, shapeRows, combinationRows, stoneRows, goldRows, categoryRows] = await Promise.all([
        db.select<{ rate_key: string; value: number }[]>('SELECT rate_key, value FROM global_rate'),
        db.select<{ key: string; value: string | null }[]>('SELECT key, value FROM app_setting'),
        db.select<Purity[]>('SELECT id, name, percent_bp AS percentBp, is_archived AS isArchived FROM purity ORDER BY is_archived, name'),
        db.select<Shape[]>('SELECT id, code, name, is_archived AS isArchived FROM diamond_shape ORDER BY sort_order, name'),
        db.select<Combination[]>('SELECT dc.id, dc.shape_id AS shapeId, ds.code AS shapeCode, ds.name AS shapeName, dc.quality, dc.rate_per_ct_paise AS ratePerCtPaise, dc.is_archived AS isArchived FROM diamond_combination dc JOIN diamond_shape ds ON ds.id = dc.shape_id ORDER BY dc.is_archived, ds.sort_order, dc.quality'),
        db.select<StoneType[]>('SELECT id, name, tag_label AS tagLabel, weight_unit AS weightUnit, rate_paise_per_unit AS ratePaisePerUnit, is_archived AS isArchived FROM stone_type ORDER BY is_archived, sort_order, name'),
        db.select<GoldType[]>('SELECT id, name, is_archived AS isArchived FROM gold_type ORDER BY is_archived, sort_order, name'),
        db.select<Category[]>('SELECT c.id, c.name, c.series_id AS seriesId, s.prefix, s.next_number AS nextNumber, s.number_width AS numberWidth, s.range_end AS rangeEnd, c.sort_order AS sortOrder, c.is_archived AS isArchived FROM category c LEFT JOIN item_series s ON s.id = c.series_id ORDER BY c.is_archived, c.sort_order, c.name'),
      ]);
      const rate = (key: string) => rates.find((row) => row.rate_key === key)?.value ?? 0;
      const setting = (key: string) => settings.find((row) => row.key === key)?.value;
      setGoldRate(moneyInput(rate('gold_per_g_paise')));
      setCertificationRate(moneyInput(rate('certification_per_ct_paise')));
      const mode = setting('wastage_mode');
      setWastageMode(mode === 'per_gram' ? 'per_gram' : 'percent');
      setWastageValue(mode === 'per_gram'
        ? moneyInput(rate('wastage_per_g_paise'))
        : String(rate('wastage_percent_bp') / 100));
      setGstRate(String(Number(setting('gst_rate_bp') ?? '300') / 100));
      setBusinessState(setting('business_state') ?? 'Maharashtra');
      setPurities(purityRows);
      setShapes(shapeRows);
      setCombinations(combinationRows);
      setStones(stoneRows);
      setGoldTypes(goldRows);
      setCategories(categoryRows);
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not load Settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveRate(key: RateKey, value: string) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      setNotice({ kind: 'error', text: 'Enter a valid non-negative rate.' });
      return;
    }
    setBusy(true);
    try {
      const db = await getDatabase();
      await db.execute('UPDATE global_rate SET value = ?, updated_at = datetime(\'now\',\'localtime\') WHERE rate_key = ?', [Math.round(numeric * 100), key]);
      setEditingRate(null);
      setNotice({ kind: 'success', text: 'Rate saved.' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save rate.' });
    } finally { setBusy(false); }
  }

  async function saveWastage(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(wastageValue);
    if (!Number.isFinite(numeric) || numeric < 0 || (wastageMode === 'percent' && numeric > 100)) {
      setNotice({ kind: 'error', text: wastageMode === 'percent' ? 'Wastage must be between 0 and 100%.' : 'Enter a valid non-negative wastage rate.' });
      return;
    }
    setBusy(true);
    try {
      await invoke('save_wastage_settings', {
        mode: wastageMode,
        value: Math.round(numeric * 100),
      });
      setEditingRate(null);
      setNotice({ kind: 'success', text: 'Wastage settings saved.' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save wastage settings.' });
    } finally { setBusy(false); }
  }

  async function saveGst(event: FormEvent) {
    event.preventDefault();
    const numeric = Number(gstRate);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100 || !businessState.trim()) {
      setNotice({ kind: 'error', text: 'Enter a valid GST percentage and state.' });
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
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save GST settings.' });
    } finally { setBusy(false); }
  }

  function openReference(kind: ReferenceKind, row?: Purity | Shape | Combination | StoneType | GoldType) {
    if (kind === 'purity') {
      const item = row as Purity | undefined;
      setReferenceDraft({ kind, id: item?.id, name: item?.name ?? '', percent: item ? String(item.percentBp / 100) : '', shapeId: '', quality: '', rate: '', tagLabel: '', weightUnit: 'ct' });
    } else if (kind === 'shape') {
      const item = row as Shape | undefined;
      setReferenceDraft({ kind, id: item?.id, name: item?.name ?? '', percent: '', shapeId: '', quality: '', rate: '', tagLabel: item?.code ?? '', weightUnit: 'ct' });
    } else if (kind === 'combination') {
      const item = row as Combination | undefined;
      setReferenceDraft({ kind, id: item?.id, name: '', percent: '', shapeId: String(item?.shapeId ?? shapes.find((shape) => !shape.isArchived)?.id ?? ''), quality: item?.quality ?? '', rate: item ? moneyInput(item.ratePerCtPaise) : '0', tagLabel: '', weightUnit: 'ct' });
    } else if (kind === 'stone') {
      const item = row as StoneType | undefined;
      setReferenceDraft({ kind, id: item?.id, name: item?.name ?? '', percent: '', shapeId: '', quality: '', rate: item ? moneyInput(item.ratePaisePerUnit) : '0', tagLabel: item?.tagLabel ?? '', weightUnit: item?.weightUnit ?? 'ct' });
    } else {
      const item = row as GoldType | undefined;
      setReferenceDraft({ kind, id: item?.id, name: item?.name ?? '', percent: '', shapeId: '', quality: '', rate: '', tagLabel: '', weightUnit: 'ct' });
    }
  }

  async function saveReference(event: FormEvent) {
    event.preventDefault();
    if (!referenceDraft) return;
    const draft = referenceDraft;
    const name = draft.name.trim();
    if (draft.kind !== 'combination' && !name) {
      setNotice({ kind: 'error', text: 'Name is required.' });
      return;
    }
    setBusy(true);
    try {
      const db = await getDatabase();
      if (draft.kind === 'purity') {
        const percent = Number(draft.percent);
        if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error('Purity must be greater than 0% and at most 100%.');
        if (draft.id) await db.execute('UPDATE purity SET name = ?, percent_bp = ? WHERE id = ?', [name, Math.round(percent * 100), draft.id]);
        else await db.execute('INSERT INTO purity (name, percent_bp) VALUES (?, ?)', [name, Math.round(percent * 100)]);
      } else if (draft.kind === 'shape') {
        const code = draft.tagLabel.trim().toUpperCase();
        if (!code) throw new Error('Diamond shape code is required.');
        if (draft.id) await db.execute('UPDATE diamond_shape SET code = ?, name = ? WHERE id = ?', [code, name, draft.id]);
        else await db.execute('INSERT INTO diamond_shape (code, name, sort_order) VALUES (?, ?, ?)', [code, name, shapes.length + 1]);
      } else if (draft.kind === 'combination') {
        const shapeId = Number(draft.shapeId);
        const quality = draft.quality.trim();
        const rate = Number(draft.rate);
        if (!shapeId || !quality || !Number.isFinite(rate) || rate < 0) throw new Error('Select a diamond shape, enter a quality and a valid rate.');
        if (draft.id) await db.execute('UPDATE diamond_combination SET shape_id = ?, quality = ?, rate_per_ct_paise = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [shapeId, quality, Math.round(rate * 100), draft.id]);
        else await db.execute('INSERT INTO diamond_combination (shape_id, quality, rate_per_ct_paise) VALUES (?, ?, ?)', [shapeId, quality, Math.round(rate * 100)]);
      } else if (draft.kind === 'stone') {
        const rate = Number(draft.rate);
        if (!draft.tagLabel.trim() || !Number.isFinite(rate) || rate < 0) throw new Error('Tag label and a valid non-negative rate are required.');
        if (draft.id) await db.execute('UPDATE stone_type SET name = ?, tag_label = ?, weight_unit = ?, rate_paise_per_unit = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [name, draft.tagLabel.trim(), draft.weightUnit, Math.round(rate * 100), draft.id]);
        else await db.execute('INSERT INTO stone_type (name, tag_label, weight_unit, rate_paise_per_unit) VALUES (?, ?, ?, ?)', [name, draft.tagLabel.trim(), draft.weightUnit, Math.round(rate * 100)]);
      } else {
        if (draft.id) await db.execute('UPDATE gold_type SET name = ? WHERE id = ?', [name, draft.id]);
        else await db.execute('INSERT INTO gold_type (name) VALUES (?)', [name]);
      }
      setReferenceDraft(null);
      setNotice({ kind: 'success', text: 'Reference data saved.' });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save reference data. Check for duplicate names or values.' });
    } finally { setBusy(false); }
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
    if (!name || !Number.isSafeInteger(next) || next < 1 || !Number.isInteger(width) || width < 0 || (end !== null && (!Number.isSafeInteger(end) || end < next)) || !Number.isFinite(order)) {
      setNotice({ kind: 'error', text: 'Check the category name and numbering values. Next number must be at least 1 and range end cannot be below it.' });
      return;
    }
    if (categoryDraft.id) {
      const current = categories.find((item) => item.id === categoryDraft.id);
      if (current && next < current.nextNumber) {
        setNotice({ kind: 'error', text: 'Next number cannot move backwards. Item numbers are never reused.' });
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
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : 'Could not save category. Check for duplicate names or prefixes.' });
    } finally { setBusy(false); }
  }

  async function toggleArchive(table: 'purity' | 'diamond_shape' | 'diamond_combination' | 'stone_type' | 'gold_type' | 'category', id: number, archived: number, label: string) {
    const action = archived ? 'restore' : 'archive';
    if (!window.confirm(`${action === 'archive' ? 'Archive' : 'Restore'} ${label}? ${action === 'archive' ? 'It will no longer be available for new items or selections, but historical records will be retained.' : 'It will become available for new items or selections again.'}`)) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      await db.execute(`UPDATE ${table} SET is_archived = ? WHERE id = ?`, [archived ? 0 : 1, id]);
      setNotice({ kind: 'success', text: `${label} ${action === 'archive' ? 'archived' : 'restored'}.` });
      await load();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : `Could not ${action} ${label}. Existing records may depend on it.` });
    } finally { setBusy(false); }
  }

  const startCategoryEdit = (row?: Category) => setCategoryDraft(row
    ? { id: row.id, name: row.name, prefix: row.prefix ?? '', nextNumber: String(row.nextNumber), numberWidth: String(row.numberWidth), rangeEnd: row.rangeEnd == null ? '' : String(row.rangeEnd), sortOrder: String(row.sortOrder) }
    : { name: '', prefix: '', nextNumber: '1', numberWidth: '3', rangeEnd: '', sortOrder: String(categories.length + 1) });

  if (loading) return <div className='settings-screen'><p className='settings-loading'>Loading Settings…</p></div>;

  return (
    <div className='settings-screen'>
      <header className='settings-heading'>
        <div><p className='settings-eyebrow'>APPLICATION CONFIGURATION</p><h1 className='app-page-title'>Settings</h1><p className='app-page-description'>Manage pricing defaults, item numbering, and jewelry reference data.</p></div>
      </header>
      {notice && <div className={`settings-notice settings-notice--${notice.kind}`} role='status'><span>{notice.text}</span><button type='button' aria-label='Dismiss message' onClick={() => setNotice(null)}>×</button></div>}
      <nav className='settings-tabs' aria-label='Settings sections'>
        <button className={section === 'pricing' ? 'is-active' : ''} onClick={() => setSection('pricing')} type='button'>Pricing &amp; rates</button>
        <button className={section === 'categories' ? 'is-active' : ''} onClick={() => setSection('categories')} type='button'>Categories &amp; numbering</button>
        <button className={section === 'reference' ? 'is-active' : ''} onClick={() => setSection('reference')} type='button'>Reference data</button>
      </nav>

      {section === 'pricing' && <div className='settings-content'>
        <section className='settings-card'>
          <div className='settings-card-heading'><div><h2>Gold &amp; service rates</h2><p>Global defaults used when a selection has no negotiated override.</p></div></div>
          <div className='settings-rate-list'>
            <div className='settings-rate-row'><div><strong>Gold rate</strong><span>Per gram of pure gold</span></div>{editingRate === 'gold_per_g_paise' ? <form className='settings-inline-edit' onSubmit={(e) => { e.preventDefault(); void saveRate('gold_per_g_paise', goldRate); }}><label><span>₹</span><input autoFocus type='number' min='0' step='0.01' value={goldRate} onChange={(e) => setGoldRate(e.target.value)} /></label><button className='settings-button settings-button--primary' disabled={busy}>Save</button><button type='button' className='settings-button' onClick={() => { setEditingRate(null); void load(); }}>Cancel</button></form> : <div className='settings-rate-value'><strong>{formatMoney(Math.round(Number(goldRate) * 100))}</strong><button type='button' className='settings-button' onClick={() => setEditingRate('gold_per_g_paise')}>Edit</button></div>}</div>
            <div className='settings-rate-row'><div><strong>Wastage</strong><span>Choose a percentage of gold value or a fixed amount per gram.</span></div>{editingRate === 'wastage' ? <form className='settings-inline-edit settings-wastage-edit' onSubmit={(e) => void saveWastage(e)}><select value={wastageMode} onChange={(e) => setWastageMode(e.target.value as 'percent' | 'per_gram')}><option value='percent'>Percentage</option><option value='per_gram'>Per gram</option></select><label><span>{wastageMode === 'percent' ? '%' : '₹'}</span><input autoFocus type='number' min='0' max={wastageMode === 'percent' ? 100 : undefined} step='0.01' value={wastageValue} onChange={(e) => setWastageValue(e.target.value)} /></label><button className='settings-button settings-button--primary' disabled={busy}>Save</button><button type='button' className='settings-button' onClick={() => { setEditingRate(null); void load(); }}>Cancel</button></form> : <div className='settings-rate-value'><strong>{wastageMode === 'percent' ? `${wastageValue}%` : `${formatMoney(Math.round(Number(wastageValue) * 100))} / g`}</strong><button type='button' className='settings-button' onClick={() => setEditingRate('wastage')}>Edit</button></div>}</div>
            <div className='settings-rate-row'><div><strong>Certification charge</strong><span>Per diamond carat</span></div>{editingRate === 'certification_per_ct_paise' ? <form className='settings-inline-edit' onSubmit={(e) => { e.preventDefault(); void saveRate('certification_per_ct_paise', certificationRate); }}><label><span>₹</span><input autoFocus type='number' min='0' step='0.01' value={certificationRate} onChange={(e) => setCertificationRate(e.target.value)} /></label><button className='settings-button settings-button--primary' disabled={busy}>Save</button><button type='button' className='settings-button' onClick={() => { setEditingRate(null); void load(); }}>Cancel</button></form> : <div className='settings-rate-value'><strong>{formatMoney(Math.round(Number(certificationRate) * 100))}</strong><button type='button' className='settings-button' onClick={() => setEditingRate('certification_per_ct_paise')}>Edit</button></div>}</div>
          </div>
        </section>
        <section className='settings-card'>
          <div className='settings-card-heading'><div><h2>GST configuration</h2><p>Tax is calculated at order confirmation and frozen with the order price.</p></div>{!gstEditing && <button type='button' className='settings-button' onClick={() => setGstEditing(true)}>Edit</button>}</div>
          {gstEditing ? <form className='settings-gst-form' onSubmit={(e) => void saveGst(e)}><label>GST rate (%)<input type='number' min='0' max='100' step='0.01' value={gstRate} onChange={(e) => setGstRate(e.target.value)} /></label><label>Business state<input value={businessState} onChange={(e) => setBusinessState(e.target.value)} required /></label><div className='settings-form-actions'><button className='settings-button settings-button--primary' disabled={busy}>Save GST settings</button><button type='button' className='settings-button' onClick={() => { setGstEditing(false); void load(); }}>Cancel</button></div></form> : <div className='settings-gst-summary'><div><span>GST rate</span><strong>{gstRate}%</strong></div><div><span>Business state</span><strong>{businessState}</strong></div><p>For Maharashtra customers, GST is split equally into CGST and SGST. For customers in other states, IGST applies.</p></div>}
        </section>
        <section className='settings-card settings-info-card'><span className='settings-info-icon'>i</span><div><strong>Pricing behavior</strong><p>Changing a global rate affects future calculations only. Negotiated selection rates remain specific to that selection, and confirmed order pricing stays unchanged.</p></div></section>
      </div>}

      {section === 'categories' && <section className='settings-card settings-table-card'>
        <div className='settings-card-heading'><div><h2>Categories &amp; item numbering</h2><p>Each category has its own sequence. Item numbers already issued are never changed or reused.</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => startCategoryEdit()}>+ Add category</button></div>
        <div className='settings-table-wrap'><table className='settings-table'><thead><tr><th>Category</th><th>Prefix</th><th>Next number</th><th>Width</th><th>Range end</th><th>Status</th><th></th></tr></thead><tbody>{categories.map((row) => <tr key={row.id} className={row.isArchived ? 'is-archived' : ''}><td><strong>{row.name}</strong></td><td><code>{row.prefix}</code></td><td>{row.nextNumber}</td><td>{row.numberWidth}</td><td>{row.rangeEnd ?? 'Open'}</td><td><span className={`settings-status ${row.isArchived ? 'settings-status--archived' : ''}`}>{row.isArchived ? 'Archived' : 'Active'}</span></td><td className='settings-row-actions'><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => startCategoryEdit(row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('category', row.id, row.isArchived, row.name)}>{row.isArchived ? 'Restore' : 'Archive'}</button></td></tr>)}</tbody></table></div>
      </section>}

      {section === 'reference' && <div className='settings-reference-grid'>
        <section className='settings-card settings-reference-card'><div className='settings-card-heading'><div><h2>Purity</h2><p>Gold purity percentage</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => openReference('purity')}>+ Add</button></div><div className='settings-reference-list'>{purities.map((row) => <div className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`} key={row.id}><div><strong>{row.name}</strong><span>{(row.percentBp / 100).toFixed(2)}% gold content</span></div><div><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => openReference('purity', row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('purity', row.id, row.isArchived, row.name)}>{row.isArchived ? 'Restore' : 'Archive'}</button></div></div>)}</div></section>
        <section className='settings-card settings-reference-card'><div className='settings-card-heading'><div><h2>Diamond shapes</h2><p>Codes printed on jewelry tags</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => openReference('shape')}>+ Add</button></div><div className='settings-reference-list'>{shapes.map((row) => <div className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`} key={row.id}><div><strong>{row.code} · {row.name}</strong><span>{row.isArchived ? 'Archived' : 'Available for combinations'}</span></div><div><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => openReference('shape', row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('diamond_shape', row.id, row.isArchived, row.code)}>{row.isArchived ? 'Restore' : 'Archive'}</button></div></div>)}</div></section>
        <section className='settings-card settings-reference-card'><div className='settings-card-heading'><div><h2>Diamond combinations</h2><p>Quality and rate per carat</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => openReference('combination')}>+ Add</button></div><div className='settings-reference-list'>{combinations.map((row) => <div className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`} key={row.id}><div><strong>{row.shapeCode} · {row.quality}</strong><span>{row.shapeName} · {formatMoney(row.ratePerCtPaise)} / ct</span></div><div><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => openReference('combination', row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('diamond_combination', row.id, row.isArchived, `${row.shapeCode} ${row.quality}`)}>{row.isArchived ? 'Restore' : 'Archive'}</button></div></div>)}</div></section>
        <section className='settings-card settings-reference-card'><div className='settings-card-heading'><div><h2>Stone types</h2><p>Tag label, unit, and rate</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => openReference('stone')}>+ Add</button></div><div className='settings-reference-list'>{stones.map((row) => <div className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`} key={row.id}><div><strong>{row.name}</strong><span>{row.tagLabel} · {formatMoney(row.ratePaisePerUnit)} / {row.weightUnit}</span></div><div><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => openReference('stone', row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('stone_type', row.id, row.isArchived, row.name)}>{row.isArchived ? 'Restore' : 'Archive'}</button></div></div>)}</div></section>
        <section className='settings-card settings-reference-card'><div className='settings-card-heading'><div><h2>Gold types</h2><p>Available gold colors</p></div><button type='button' className='settings-button settings-button--primary' onClick={() => openReference('gold')}>+ Add</button></div><div className='settings-reference-list'>{goldTypes.map((row) => <div className={`settings-reference-row ${row.isArchived ? 'is-archived' : ''}`} key={row.id}><div><strong>{row.name}</strong><span>{row.isArchived ? 'Archived' : 'Available for inventory'}</span></div><div><button type='button' className='settings-button' disabled={busy || !!row.isArchived} onClick={() => openReference('gold', row)}>Edit</button><button type='button' className='settings-button' disabled={busy} onClick={() => void toggleArchive('gold_type', row.id, row.isArchived, row.name)}>{row.isArchived ? 'Restore' : 'Archive'}</button></div></div>)}</div></section>
      </div>}

      {referenceDraft && <div className='settings-modal-backdrop' role='presentation' onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setReferenceDraft(null); }}><section className='settings-modal' role='dialog' aria-modal='true' aria-labelledby='settings-reference-title'><header><div><h2 id='settings-reference-title'>{referenceDraft.id ? 'Edit' : 'Add'} {referenceDraft.kind === 'purity' ? 'purity' : referenceDraft.kind === 'shape' ? 'diamond shape' : referenceDraft.kind === 'combination' ? 'diamond combination' : referenceDraft.kind === 'stone' ? 'stone type' : 'gold type'}</h2><p>Save this record independently. Existing historical records are retained.</p></div><button type='button' aria-label='Close' disabled={busy} onClick={() => setReferenceDraft(null)}>×</button></header><form onSubmit={(e) => void saveReference(e)}><div className='settings-modal-body'>
        {referenceDraft.kind !== 'combination' && <label>{referenceDraft.kind === 'shape' ? 'Full name' : 'Name'}<input autoFocus value={referenceDraft.name} onChange={(e) => setReferenceDraft({ ...referenceDraft, name: e.target.value })} required /></label>}
        {referenceDraft.kind === 'shape' && <label>Tag code<input value={referenceDraft.tagLabel} onChange={(e) => setReferenceDraft({ ...referenceDraft, tagLabel: e.target.value })} placeholder='e.g. RD' required /></label>}
        {referenceDraft.kind === 'purity' && <label>Gold content (%)<input type='number' min='0.01' max='100' step='0.01' value={referenceDraft.percent} onChange={(e) => setReferenceDraft({ ...referenceDraft, percent: e.target.value })} required /></label>}
        {referenceDraft.kind === 'combination' && <><label>Diamond shape<select value={referenceDraft.shapeId} onChange={(e) => setReferenceDraft({ ...referenceDraft, shapeId: e.target.value })} required><option value=''>Select shape</option>{shapes.filter((shape) => !shape.isArchived).map((shape) => <option key={shape.id} value={shape.id}>{shape.code} — {shape.name}</option>)}</select></label><label>Quality / combination<input autoFocus value={referenceDraft.quality} onChange={(e) => setReferenceDraft({ ...referenceDraft, quality: e.target.value })} placeholder='e.g. EF-VVS' required /></label><label>Rate per carat (₹)<input type='number' min='0' step='0.01' value={referenceDraft.rate} onChange={(e) => setReferenceDraft({ ...referenceDraft, rate: e.target.value })} required /></label></>}
        {referenceDraft.kind === 'stone' && <><label>Tag label<input value={referenceDraft.tagLabel} onChange={(e) => setReferenceDraft({ ...referenceDraft, tagLabel: e.target.value })} placeholder='e.g. R ST' required /></label><label>Weight unit<select value={referenceDraft.weightUnit} onChange={(e) => setReferenceDraft({ ...referenceDraft, weightUnit: e.target.value as 'ct' | 'g' })}><option value='ct'>Carats (ct)</option><option value='g'>Grams (g)</option></select></label><label>Rate per {referenceDraft.weightUnit} (₹)<input type='number' min='0' step='0.01' value={referenceDraft.rate} onChange={(e) => setReferenceDraft({ ...referenceDraft, rate: e.target.value })} required /></label></>}
        {referenceDraft.kind === 'gold' && <p className='settings-modal-help'>Gold type is descriptive; the global gold rate is configured separately.</p>}
      </div><footer><button type='button' className='settings-button' disabled={busy} onClick={() => setReferenceDraft(null)}>Cancel</button><button type='submit' className='settings-button settings-button--primary' disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></footer></form></section></div>}

      {categoryDraft && <div className='settings-modal-backdrop' role='presentation' onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setCategoryDraft(null); }}><section className='settings-modal' role='dialog' aria-modal='true' aria-labelledby='settings-category-title'><header><div><h2 id='settings-category-title'>{categoryDraft.id ? 'Edit category numbering' : 'Add category'}</h2><p>Category details and numbering settings are saved together.</p></div><button type='button' aria-label='Close' disabled={busy} onClick={() => setCategoryDraft(null)}>×</button></header><form onSubmit={(e) => void saveCategory(e)}><div className='settings-modal-body settings-category-form'><label>Category name<input autoFocus value={categoryDraft.name} onChange={(e) => setCategoryDraft({ ...categoryDraft, name: e.target.value })} required /></label><label>Prefix<input value={categoryDraft.prefix} onChange={(e) => setCategoryDraft({ ...categoryDraft, prefix: e.target.value })} /></label><label>Next number<input type='number' min='1' step='1' value={categoryDraft.nextNumber} onChange={(e) => setCategoryDraft({ ...categoryDraft, nextNumber: e.target.value })} required /></label><label>Number width<input type='number' min='0' step='1' value={categoryDraft.numberWidth} onChange={(e) => setCategoryDraft({ ...categoryDraft, numberWidth: e.target.value })} required /></label><label>Range end (optional)<input type='number' min={categoryDraft.nextNumber} step='1' value={categoryDraft.rangeEnd} onChange={(e) => setCategoryDraft({ ...categoryDraft, rangeEnd: e.target.value })} placeholder='No limit' /></label><label>Sort order<input type='number' step='1' value={categoryDraft.sortOrder} onChange={(e) => setCategoryDraft({ ...categoryDraft, sortOrder: e.target.value })} required /></label><p className='settings-number-preview'>Preview: <strong>{categoryDraft.prefix}{String(Math.max(1, Number(categoryDraft.nextNumber) || 1)).padStart(Math.max(0, Math.min(12, Number(categoryDraft.numberWidth) || 0)), '0')}</strong></p></div><footer><button type='button' className='settings-button' disabled={busy} onClick={() => setCategoryDraft(null)}>Cancel</button><button type='submit' className='settings-button settings-button--primary' disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button></footer></form></section></div>}
    </div>
  );
}

export default SettingsScreen;
