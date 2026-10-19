import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import {
  createExhibition,
  deleteExhibition,
  getExhibitions,
  updateExhibition,
} from './exhibition.queries';
import type {
  Exhibition,
  ExhibitionFilter,
  ExhibitionInput,
} from './exhibition.types';
import './ExhibitionsScreen.css';

type Notice = { kind: 'success' | 'error'; message: string };
type ModalState =
  | { mode: 'create' }
  | { mode: 'edit'; exhibition: Exhibition }
  | null;
type DeleteTarget = Exhibition | null;

const EMPTY_INPUT: ExhibitionInput = {
  name: '',
  location: '',
  startDate: '',
  endDate: '',
  notes: '',
};

const FILTERS: { value: ExhibitionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
];

function displayStatus(status: Exhibition['status']) {
  if (status === 'Planned') return 'Upcoming';
  if (status === 'Closed') return 'Past';
  return 'Active';
}

function formatDateForInput(date: string) {
  if (!date) return '';
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(date);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date;
}

function parseIndianDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDate(date: string) {
  if (!date) return '—';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatDateRange(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (start === end) return formatDate(start);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    return `${startDate.getDate()}–${endDate.getDate()} ${new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(startDate)}`;
  }
  if (sameYear) {
    return `${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(startDate)} – ${formatDate(end)}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function ExhibitionModal({
  modal,
  saving,
  onClose,
  onSave,
}: {
  modal: Exclude<ModalState, null>;
  saving: boolean;
  onClose: () => void;
  onSave: (input: ExhibitionInput) => Promise<void>;
}) {
  const initial = modal.mode === 'edit' ? modal.exhibition : null;
  const [form, setForm] = useState<ExhibitionInput>(() =>
    initial
      ? {
          name: initial.name,
          location: initial.location ?? '',
          startDate: initial.startDate,
          endDate: initial.endDate,
          notes: initial.notes ?? '',
        }
      : EMPTY_INPUT,
  );
  const [startDateText, setStartDateText] = useState(() =>
    formatDateForInput(initial?.startDate ?? ''),
  );
  const [endDateText, setEndDateText] = useState(() =>
    formatDateForInput(initial?.endDate ?? ''),
  );
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const startDate = parseIndianDate(startDateText);
    const endDate = parseIndianDate(endDateText);
    if (!startDate || !endDate) {
      setFormError(
        'Enter both dates in DD/MM/YYYY format (for example, 07/01/2027).',
      );
      return;
    }
    if (endDate < startDate) {
      setFormError('The end date must be on or after the start date.');
      return;
    }
    try {
      await onSave({ ...form, startDate, endDate });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div
      className='exhibitions-modal-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className='exhibitions-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='exhibition-modal-title'
      >
        <header className='exhibitions-modal-header'>
          <div>
            <span className='exhibitions-eyebrow'>EXHIBITION MANAGEMENT</span>
            <h2 id='exhibition-modal-title'>
              {modal.mode === 'create' ? 'Add exhibition' : 'Edit exhibition'}
            </h2>
            <p>
              Keep the exhibition details accurate for inventory and customer
              selections.
            </p>
          </div>
          <button
            type='button'
            className='exhibitions-icon-button'
            aria-label='Close dialog'
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className='exhibitions-modal-body'>
            {formError && (
              <p className='exhibitions-form-error' role='alert'>
                {formError}
              </p>
            )}
            <label className='exhibitions-field'>
              <span>
                Exhibition name <b>*</b>
              </span>
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder='e.g. Mumbai Jewellery Exhibition'
                autoFocus
              />
            </label>
            <label className='exhibitions-field'>
              <span>Location</span>
              <input
                maxLength={160}
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
                placeholder='Venue or city'
              />
            </label>
            <div className='exhibitions-date-grid'>
              <label className='exhibitions-field'>
                <span>
                  Start date <b>*</b>
                </span>
                <input
                  type='text'
                  required
                  inputMode='numeric'
                  placeholder='DD/MM/YYYY'
                  maxLength={10}
                  value={startDateText}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStartDateText(value);
                    const parsed = parseIndianDate(value);
                    if (parsed)
                      setForm((current) => ({ ...current, startDate: parsed }));
                  }}
                  aria-describedby='exhibition-date-format'
                />
              </label>
              <label className='exhibitions-field'>
                <span>
                  End date <b>*</b>
                </span>
                <input
                  type='text'
                  required
                  inputMode='numeric'
                  placeholder='DD/MM/YYYY'
                  maxLength={10}
                  value={endDateText}
                  onChange={(event) => {
                    const value = event.target.value;
                    setEndDateText(value);
                    const parsed = parseIndianDate(value);
                    if (parsed)
                      setForm((current) => ({ ...current, endDate: parsed }));
                  }}
                  aria-describedby='exhibition-date-format'
                />
              </label>
            </div>
            <p id='exhibition-date-format' className='exhibitions-date-hint'>
              Use DD/MM/YYYY format.
            </p>
            <label className='exhibitions-field'>
              <span>Notes</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder='Optional internal notes'
              />
            </label>
          </div>
          <footer className='exhibitions-modal-footer'>
            <span className='exhibitions-footer-hint'>
              Status is determined automatically from the dates.
            </span>
            <div>
              <button
                type='button'
                className='exhibitions-secondary-button'
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type='submit'
                className='exhibitions-primary-button'
                disabled={saving}
              >
                {saving
                  ? 'Saving…'
                  : modal.mode === 'create'
                    ? 'Create exhibition'
                    : 'Save changes'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function ExhibitionsScreen({
  onOpenExhibition,
}: {
  onOpenExhibition: (exhibitionId: number) => void;
}) {
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ExhibitionFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getExhibitions({ search, status: 'all' });
      setExhibitions(result);
    } catch (err) {
      console.error('Failed to load exhibitions:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load exhibitions. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(
    () => ({
      all: exhibitions.length,
      upcoming: exhibitions.filter((item) => item.status === 'Planned').length,
      active: exhibitions.filter((item) => item.status === 'Active').length,
      past: exhibitions.filter((item) => item.status === 'Closed').length,
    }),
    [exhibitions],
  );

  const filteredExhibitions = useMemo(() => {
    if (filter === 'all') return exhibitions;

    const statusByFilter: Record<
      Exclude<ExhibitionFilter, 'all'>,
      Exhibition['status']
    > = {
      upcoming: 'Planned',
      active: 'Active',
      past: 'Closed',
    };

    return exhibitions.filter(
      (exhibition) => exhibition.status === statusByFilter[filter],
    );
  }, [exhibitions, filter]);

  async function handleSave(input: ExhibitionInput) {
    setSaving(true);
    try {
      if (modal?.mode === 'edit')
        await updateExhibition(modal.exhibition.id, input);
      else await createExhibition(input);
      setModal(null);
      setNotice({
        kind: 'success',
        message:
          modal?.mode === 'edit'
            ? 'Exhibition updated successfully.'
            : 'Exhibition created successfully.',
      });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message || 'Unable to save the exhibition.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteExhibition(deleteTarget.id);
      setNotice({
        kind: 'success',
        message: `${deleteTarget.name} was deleted.`,
      });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const message = raw.includes('Only future exhibitions can be deleted')
        ? 'Only exhibitions that have not started yet can be deleted.'
        : raw ||
          'Unable to delete this exhibition. It may have linked selections, orders or payments.';
      setNotice({ kind: 'error', message });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className='exhibitions-screen'>
      {notice && (
        <div
          className={`exhibitions-notice exhibitions-notice--${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{notice.kind === 'success' ? '✓' : '!'}</span>
          <p>{notice.message}</p>
          <button
            type='button'
            aria-label='Dismiss message'
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <header className='exhibitions-page-header'>
        <div>
          <span className='exhibitions-eyebrow'>
            EVENTS & CUSTOMER SELECTIONS
          </span>
          <h1>Exhibitions</h1>
          <p>
            Plan events, register inventory, and keep customer selections
            organized.
          </p>
        </div>
        <button
          type='button'
          className='exhibitions-primary-button'
          onClick={() => {
            setNotice(null);
            setModal({ mode: 'create' });
          }}
        >
          <span aria-hidden='true'>+</span> Add exhibition
        </button>
      </header>

      <div className='exhibitions-toolbar'>
        <label className='exhibitions-search'>
          <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            <circle cx='10.8' cy='10.8' r='6.8' />
            <path d='m16 16 4.5 4.5' />
          </svg>
          <span className='sr-only'>Search exhibitions</span>
          <input
            type='search'
            placeholder='Search exhibitions or locations…'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type='button'
              aria-label='Clear search'
              onClick={() => setSearch('')}
            >
              ×
            </button>
          )}
        </label>
        <div
          className='exhibitions-filter-tabs'
          role='group'
          aria-label='Exhibition status filter'
        >
          {FILTERS.map((item) => (
            <button
              key={item.value}
              type='button'
              className={filter === item.value ? 'is-active' : ''}
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
              <span>{counts[item.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className='exhibitions-list-heading'>
        <span>
          {loading
            ? 'Loading exhibitions…'
            : `${filteredExhibitions.length} ${filteredExhibitions.length === 1 ? 'exhibition' : 'exhibitions'}`}
        </span>
        <button
          type='button'
          className='exhibitions-quiet-button'
          onClick={() => void load()}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className='exhibitions-state exhibitions-error' role='alert'>
          <p>{error}</p>
          <button
            type='button'
            className='exhibitions-secondary-button'
            onClick={() => void load()}
          >
            Try again
          </button>
        </div>
      )}
      {!error && loading && (
        <div className='exhibitions-state'>Loading exhibitions…</div>
      )}
      {!error && !loading && filteredExhibitions.length === 0 && (
        <div className='exhibitions-empty'>
          <div className='exhibitions-empty-icon' aria-hidden='true'>
            ◇
          </div>
          <h2>
            {search
              ? 'No matching exhibitions'
              : filter === 'all'
                ? 'No exhibitions yet'
                : `No ${FILTERS.find((item) => item.value === filter)?.label.toLowerCase()} exhibitions`}
          </h2>
          <p>
            {search
              ? 'Try a different search term.'
              : 'Create an exhibition to start organizing registered inventory and customer selections.'}
          </p>
          {!search && (
            <button
              type='button'
              className='exhibitions-primary-button'
              onClick={() => setModal({ mode: 'create' })}
            >
              + Add exhibition
            </button>
          )}
        </div>
      )}

      {!error && !loading && filteredExhibitions.length > 0 && (
        <div className='exhibitions-list'>
          {filteredExhibitions.map((exhibition) => {
            const isUpcoming = exhibition.status === 'Planned';
            const avgPerClient = exhibition.customersWithSelections
              ? (
                  exhibition.totalSelections /
                  exhibition.customersWithSelections
                ).toFixed(1)
              : '—';
            return (
              <article
                className='exhibition-row exhibition-row--clickable'
                key={exhibition.id}
                role='link'
                tabIndex={0}
                aria-label={`Open ${exhibition.name}`}
                onClick={() => onOpenExhibition(exhibition.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenExhibition(exhibition.id);
                  }
                }}
              >
                <section className='exhibition-row-info'>
                  <div className='exhibition-row-meta'>
                    <span className='exhibition-month'>
                      {new Intl.DateTimeFormat('en-IN', {
                        month: 'short',
                        year: 'numeric',
                      })
                        .format(new Date(`${exhibition.startDate}T00:00:00`))
                        .toUpperCase()}
                    </span>
                    <span
                      className={`exhibition-status exhibition-status--${exhibition.status.toLowerCase()}`}
                    >
                      {displayStatus(exhibition.status)}
                    </span>
                  </div>
                  <h2>{exhibition.name}</h2>
                  <p>
                    {formatDateRange(exhibition.startDate, exhibition.endDate)}
                  </p>
                  <p className='exhibition-row-location'>
                    {exhibition.location?.trim() || 'Location not specified'}
                  </p>
                  <div className='exhibition-row-actions'>
                    <button
                      type='button'
                      className='exhibitions-card-action'
                      onClick={(event) => {
                        event.stopPropagation();
                        setNotice(null);
                        setModal({ mode: 'edit', exhibition });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type='button'
                      className='exhibitions-card-action exhibitions-card-action--danger'
                      onClick={(event) => {
                        event.stopPropagation();
                        setNotice(null);
                        setDeleteTarget(exhibition);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </section>
                <section className='exhibition-row-inventory'>
                  <div className='exhibition-total'>
                    <strong>{exhibition.registeredItems}</strong>
                    <span>total items</span>
                  </div>
                  {exhibition.categories.length ? (
                    <div className='exhibition-category-tiles'>
                      {exhibition.categories.map((category) => (
                        <div
                          className='exhibition-category-tile'
                          key={category.categoryId}
                        >
                          <strong>{category.itemCount}</strong>
                          <span>{category.categoryName}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className='exhibition-muted'>
                      No inventory registered yet.
                    </p>
                  )}
                </section>
                <section className='exhibition-row-selection'>
                  {isUpcoming ? (
                    <>
                      <span className='exhibition-selection-label'>
                        STARTS IN
                      </span>
                      <div className='exhibition-countdown'>
                        <strong>
                          {Math.max(
                            0,
                            Math.ceil(
                              (new Date(
                                `${exhibition.startDate}T00:00:00`,
                              ).getTime() -
                                new Date(new Date().toDateString()).getTime()) /
                                86400000,
                            ),
                          )}
                        </strong>
                        <span>days</span>
                      </div>
                      <p>Selections open when the exhibition starts.</p>
                    </>
                  ) : (
                    <>
                      <span className='exhibition-selection-label'>
                        SELECTIONS
                      </span>
                      <div className='exhibition-selection-metrics'>
                        <div>
                          <strong>{exhibition.customersWithSelections}</strong>
                          <span>Clients</span>
                        </div>
                        <div>
                          <strong>{exhibition.totalSelections}</strong>
                          <span>Total selections</span>
                        </div>
                        <div>
                          <strong>{avgPerClient}</strong>
                          <span>Avg per client</span>
                        </div>
                      </div>
                      <p>Live count; updates as clients make selections.</p>
                    </>
                  )}
                </section>
              </article>
            );
          })}
        </div>
      )}
      {modal && (
        <ExhibitionModal
          modal={modal}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}

      {deleteTarget && (
        <div
          className='exhibitions-modal-backdrop'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting)
              setDeleteTarget(null);
          }}
        >
          <section
            className='exhibitions-modal exhibitions-delete-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='exhibition-delete-title'
          >
            <header className='exhibitions-modal-header'>
              <div>
                <span className='exhibitions-eyebrow'>
                  EXHIBITION MANAGEMENT
                </span>
                <h2 id='exhibition-delete-title'>Delete exhibition?</h2>
                <p>This action cannot be undone.</p>
              </div>
              <button
                type='button'
                className='exhibitions-icon-button'
                aria-label='Close dialog'
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                ×
              </button>
            </header>
            <div className='exhibitions-modal-body'>
              <strong>{deleteTarget.name}</strong>
              <p>
                Deletion is allowed only before the exhibition starts and will
                be blocked if historical records depend on it.
              </p>
            </div>
            <footer className='exhibitions-modal-footer'>
              <span className='exhibitions-footer-hint'>
                When in doubt, keep the exhibition record.
              </span>
              <div>
                <button
                  type='button'
                  className='exhibitions-secondary-button'
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='exhibitions-danger-button'
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? 'Deleting…' : 'Delete exhibition'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
