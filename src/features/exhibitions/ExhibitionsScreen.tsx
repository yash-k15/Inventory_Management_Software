import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  getExhibitionCategoryCounts,
  getExhibitions,
} from './exhibition.queries';
import type {
  Exhibition,
  ExhibitionCategoryCount,
  ExhibitionInput,
  ExhibitionStatusFilter,
} from './exhibition.types';
import './ExhibitionsScreen.css';

type Notice = { kind: 'success' | 'error'; message: string };
type ModalMode = { kind: 'create' } | { kind: 'edit'; exhibition: Exhibition };

const EMPTY_INPUT: ExhibitionInput = {
  name: '',
  location: '',
  startDate: '',
  endDate: '',
  notes: '',
};

const FILTERS: { value: ExhibitionStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
];

function toInput(exhibition: Exhibition): ExhibitionInput {
  return {
    name: exhibition.name,
    location: exhibition.location ?? '',
    startDate: exhibition.startDate,
    endDate: exhibition.endDate,
    notes: exhibition.notes ?? '',
  };
}

function formatMonth(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' })
    .format(parsed).toUpperCase();
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

function getDateRange(exhibition: Exhibition): string {
  const start = new Date(`${exhibition.startDate}T12:00:00`);
  const end = new Date(`${exhibition.endDate}T12:00:00`);
  const sameMonth = start.getMonth() === end.getMonth()
    && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(start)}`;
  }
  return `${formatDate(exhibition.startDate)} – ${formatDate(exhibition.endDate)}`;
}

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
}

function ExhibitionFormModal({
  mode,
  onClose,
  onSave,
}: {
  mode: ModalMode;
  onClose: () => void;
  onSave: (input: ExhibitionInput, exhibitionId?: number) => Promise<void>;
}) {
  const [input, setInput] = useState<ExhibitionInput>(
    mode.kind === 'edit' ? toInput(mode.exhibition) : EMPTY_INPUT,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof ExhibitionInput, value: string) =>
    setInput((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (input.endDate < input.startDate) {
      setError('The end date cannot be before the start date.');
      return;
    }
    setSaving(true);
    try {
      await onSave(input, mode.kind === 'edit' ? mode.exhibition.id : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, saving]);

  return (
    <div className="exhibition-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="exhibition-modal" role="dialog" aria-modal="true"
        aria-labelledby="exhibition-modal-title">
        <header className="exhibition-modal-header">
          <div>
            <span className="exhibition-eyebrow">EXHIBITION PLANNER</span>
            <h2 id="exhibition-modal-title">
              {mode.kind === 'create' ? 'Add exhibition' : 'Edit exhibition'}
            </h2>
            <p>Keep the event details up to date for your team.</p>
          </div>
          <button type="button" className="exhibition-modal-close"
            aria-label="Close dialog" onClick={onClose} disabled={saving}>×</button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className="exhibition-modal-body">
            {error && <p className="exhibition-form-error" role="alert">{error}</p>}
            <label className="exhibition-field exhibition-field--full">
              Exhibition name <span>*</span>
              <input autoFocus required maxLength={120} value={input.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="e.g. Mumbai Festive Fair" />
            </label>
            <label className="exhibition-field exhibition-field--full">
              Location
              <input maxLength={200} value={input.location}
                onChange={(event) => update('location', event.target.value)}
                placeholder="Venue, city" />
            </label>
            <div className="exhibition-form-grid">
              <label className="exhibition-field">
                Start date <span>*</span>
                <input type="date" required value={input.startDate}
                  onChange={(event) => update('startDate', event.target.value)} />
              </label>
              <label className="exhibition-field">
                End date <span>*</span>
                <input type="date" required min={input.startDate || undefined}
                  value={input.endDate}
                  onChange={(event) => update('endDate', event.target.value)} />
              </label>
            </div>
            <label className="exhibition-field exhibition-field--full">
              Notes
              <textarea rows={3} maxLength={2000} value={input.notes}
                onChange={(event) => update('notes', event.target.value)}
                placeholder="Optional planning notes" />
            </label>
          </div>
          <footer className="exhibition-modal-footer">
            <span className="exhibition-footer-hint">Status is determined automatically from the dates.</span>
            <div>
              <button type="button" className="exhibition-button exhibition-button--secondary"
                disabled={saving} onClick={onClose}>Cancel</button>
              <button type="submit" className="exhibition-button exhibition-button--primary"
                disabled={saving}>{saving ? 'Saving…' : mode.kind === 'create' ? 'Create exhibition' : 'Save changes'}</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function ExhibitionsScreen() {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [matchingExhibitions, setMatchingExhibitions] = useState<Exhibition[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<ExhibitionCategoryCount[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ExhibitionStatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<ModalMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Exhibition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadExhibitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [result, matching] = await Promise.all([
        getExhibitions({ search, status: statusFilter }),
        getExhibitions({ search, status: 'all' }),
      ]);
      setExhibitions(result);
      setMatchingExhibitions(matching);
      const counts = await getExhibitionCategoryCounts(result.map((item) => item.id));
      setCategoryCounts(counts);
    } catch (err) {
      console.error('Failed to load exhibitions:', err);
      setError('Unable to load exhibitions. Please check the database connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void loadExhibitions(); }, [loadExhibitions]);

  const countsByExhibition = useMemo(() => {
    const grouped: Record<number, ExhibitionCategoryCount[]> = {};
    for (const row of categoryCounts) {
      (grouped[row.exhibitionId] ??= []).push(row);
    }
    return grouped;
  }, [categoryCounts]);

  const filterCounts = useMemo(() => ({
    all: matchingExhibitions.length,
    upcoming: matchingExhibitions.filter((item) => item.status === 'Planned').length,
    active: matchingExhibitions.filter((item) => item.status === 'Active').length,
    past: matchingExhibitions.filter((item) => item.status === 'Closed').length,
  }), [matchingExhibitions]);

  const saveExhibition = async (input: ExhibitionInput, exhibitionId?: number) => {
    const payload = {
      name: input.name.trim(),
      location: input.location.trim() || null,
      startDate: input.startDate,
      endDate: input.endDate,
      notes: input.notes.trim() || null,
    };
    if (exhibitionId === undefined) {
      await invoke('create_exhibition', { input: payload });
    } else {
      await invoke('update_exhibition', { exhibitionId, input: payload });
    }
    setModal(null);
    setNotice({
      kind: 'success',
      message: exhibitionId === undefined ? 'Exhibition created successfully.' : 'Exhibition updated successfully.',
    });
    await loadExhibitions();
  };

  const deleteExhibition = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await invoke('delete_exhibition', { exhibitionId: deleteTarget.id });
      setNotice({ kind: 'success', message: `${deleteTarget.name} was deleted.` });
      setDeleteTarget(null);
      await loadExhibitions();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setNotice({ kind: 'error', message: message || 'Unable to delete this exhibition.' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="exhibitions-screen">
      <header className="exhibitions-page-header">
        <div>
          <h1 className="exhibitions-page-title">Exhibitions</h1>
          <p className="exhibitions-page-description">Plan what you bring and review what clients selected.</p>
        </div>
      </header>

      <div className="exhibitions-toolbar">
        <label className="exhibitions-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 4 4" /></svg>
          <input type="search" aria-label="Search exhibitions" placeholder="Search exhibitions..."
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="exhibitions-filter-tabs" aria-label="Filter exhibitions">
          {FILTERS.map((filter) => (
            <button key={filter.value} type="button"
              className={statusFilter === filter.value ? 'is-active' : ''}
              aria-pressed={statusFilter === filter.value}
              onClick={() => setStatusFilter(filter.value)}>
              {filter.label}<span>{filterCounts[filter.value]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="exhibition-button exhibition-button--primary exhibitions-add-button"
          onClick={() => setModal({ kind: 'create' })}><span aria-hidden="true">+</span> Add exhibition</button>
      </div>

      {notice && <div className={`exhibitions-notice exhibitions-notice--${notice.kind}`} role="status">
        <span>{notice.message}</span>
        <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button>
      </div>}

      {error && <div className="exhibitions-error" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => void loadExhibitions()}>Retry</button>
      </div>}

      {loading ? <div className="exhibitions-empty-state">Loading exhibitions…</div>
        : exhibitions.length === 0 ? <div className="exhibitions-empty-state">
          <span className="exhibitions-empty-icon">✳</span>
          <h2>{search ? 'No matching exhibitions' : 'No exhibitions yet'}</h2>
          <p>{search ? 'Try another search term or change the status filter.' : 'Add your next exhibition to start planning its inventory.'}</p>
          {!search && <button type="button" className="exhibition-button exhibition-button--primary"
            onClick={() => setModal({ kind: 'create' })}>Add exhibition</button>}
        </div> : <div className="exhibitions-list">
          {exhibitions.map((exhibition) => {
            const categories = countsByExhibition[exhibition.id] ?? [];
            const today = new Date();
            const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const canDelete = exhibition.startDate > todayIso;
            return (
              <article className="exhibition-card" key={exhibition.id}>
                <div className="exhibition-card-intro">
                  <div className="exhibition-card-topline">
                    <span className="exhibition-month">{formatMonth(exhibition.startDate)}</span>
                    <span className={`exhibition-status exhibition-status--${exhibition.status.toLowerCase()}`}>
                      {exhibition.status === 'Planned' ? 'Upcoming' : exhibition.status === 'Closed' ? 'Past' : 'Active'}
                    </span>
                  </div>
                  <h2>{exhibition.name}</h2>
                  <p className="exhibition-card-dates">{getDateRange(exhibition)}</p>
                  {exhibition.location && <p className="exhibition-card-location">{exhibition.location}</p>}
                  {exhibition.notes && <p className="exhibition-card-notes">{exhibition.notes}</p>}
                  <div className="exhibition-card-actions">
                    <button type="button" onClick={() => setModal({ kind: 'edit', exhibition })}>Edit details</button>
                    {canDelete && <button type="button" className="is-danger" onClick={() => setDeleteTarget(exhibition)}>Delete</button>}
                  </div>
                </div>
                <div className="exhibition-card-inventory">
                  <div className="exhibition-inventory-total"><strong>{exhibition.registeredItems}</strong><span>registered items</span></div>
                  <div className="exhibition-category-grid">
                    {categories.slice(0, 6).map((category) => (
                      <div className="exhibition-category-tile" key={category.categoryId}>
                        <strong>{category.itemCount}</strong><span>{category.categoryName}</span>
                      </div>
                    ))}
                    {categories.length === 0 && <p className="exhibition-no-items">No inventory registered yet.</p>}
                    {categories.length > 6 && <span className="exhibition-more-categories">+{categories.length - 6} more categories</span>}
                  </div>
                </div>
                <div className="exhibition-card-summary">
                  {exhibition.status === 'Planned' ? <>
                    <span className="exhibition-summary-eyebrow">STARTS IN</span>
                    <div className="exhibition-countdown"><strong>{daysUntil(exhibition.startDate)}</strong><span>days</span></div>
                    <p>Customer selections are managed through the exhibition workflow.</p>
                  </> : <>
                    <span className="exhibition-summary-eyebrow">SELECTIONS</span>
                    <div className="exhibition-summary-stats">
                      <div><strong>{exhibition.customersWithSelections}</strong><span>Clients who selected</span></div>
                      <div><strong>{exhibition.totalSelections}</strong><span>Total selections</span></div>
                      <div><strong>{exhibition.customersWithSelections
                        ? (exhibition.totalSelections / exhibition.customersWithSelections).toFixed(1) : '0.0'}</strong><span>Avg per client</span></div>
                    </div>
                    <p>Active selections only. Items selected by different clients are counted per selection.</p>
                  </>}
                </div>
              </article>
            );
          })}
        </div>}

      {modal && <ExhibitionFormModal mode={modal} onClose={() => setModal(null)} onSave={saveExhibition} />}

      {deleteTarget && <div className="exhibition-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) setDeleteTarget(null);
      }}>
        <section className="exhibition-confirm-modal" role="alertdialog" aria-modal="true"
          aria-labelledby="delete-exhibition-title">
          <div className="exhibition-confirm-icon">!</div>
          <h2 id="delete-exhibition-title">Delete this exhibition?</h2>
          <p><strong>{deleteTarget.name}</strong> will be permanently removed. Only future exhibitions without linked business records can be deleted.</p>
          <div className="exhibition-confirm-actions">
            <button type="button" className="exhibition-button exhibition-button--secondary"
              disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button type="button" className="exhibition-button exhibition-button--danger"
              disabled={deleting} onClick={() => void deleteExhibition()}>{deleting ? 'Deleting…' : 'Delete exhibition'}</button>
          </div>
        </section>
      </div>}
    </section>
  );
}
