import { useEffect, useState } from 'react';
import { getExhibitions } from './exhibition.queries';
import type { Exhibition } from './exhibition.types';
import './ExhibitionWorkspace.css';

type WorkspaceTab = 'overview' | 'inventory' | 'selections' | 'customers';

const TABS: { id: WorkspaceTab; label: string; countKey?: 'registeredItems' | 'totalSelections' | 'customersAttended' }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'inventory', label: 'Inventory', countKey: 'registeredItems' },
  { id: 'selections', label: 'Selections', countKey: 'totalSelections' },
  { id: 'customers', label: 'Customers', countKey: 'customersAttended' },
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

function formatDateRange(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (start === end) return formatDate(start);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
  if (sameMonth) {
    return `${startDate.getDate()}–${endDate.getDate()} ${new Intl.DateTimeFormat('en-IN', {
      month: 'short',
      year: 'numeric',
    }).format(startDate)}`;
  }
  if (sameYear) {
    return `${new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
    }).format(startDate)} – ${formatDate(end)}`;
  }
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
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  if (today < start) return null;
  if (today > end) return totalDays;
  return Math.floor((today.getTime() - start.getTime()) / 86400000) + 1;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          if (!match) setError('This exhibition could not be found. It may have been deleted.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load this exhibition.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadExhibition();
    return () => {
      cancelled = true;
    };
  }, [exhibitionId]);

  if (loading) {
    return (
      <section className='exhibition-workspace-state' aria-live='polite'>
        <p className='exhibition-workspace-back'>
          <button type='button' onClick={onBack}>← Exhibitions</button>
        </p>
        <p>Loading exhibition…</p>
      </section>
    );
  }

  if (error || !exhibition) {
    return (
      <section className='exhibition-workspace-state' role='alert'>
        <p className='exhibition-workspace-back'>
          <button type='button' onClick={onBack}>← Exhibitions</button>
        </p>
        <h1>Unable to open exhibition</h1>
        <p>{error ?? 'This exhibition is no longer available.'}</p>
        <button type='button' className='exhibition-workspace-secondary' onClick={onBack}>
          Back to exhibitions
        </button>
      </section>
    );
  }

  const dayProgress = getDayProgress(exhibition);

  return (
    <section className='exhibition-workspace'>
      <button type='button' className='exhibition-workspace-back' onClick={onBack}>
        <span aria-hidden='true'>←</span> Exhibitions
      </button>

      <header className='exhibition-workspace-header'>
        <div className='exhibition-workspace-heading'>
          <div className='exhibition-workspace-title-line'>
            <h1>{exhibition.name}</h1>
            <span className={`exhibition-workspace-status exhibition-workspace-status--${exhibition.status.toLowerCase()}`}>
              {displayStatus(exhibition.status)}
            </span>
          </div>
          <p className='exhibition-workspace-subtitle'>
            {[exhibition.location?.trim(), formatDateRange(exhibition.startDate, exhibition.endDate)]
              .filter(Boolean)
              .join(' · ')}
            {dayProgress !== null && exhibition.status === 'Active' && (
              <> · Day {dayProgress} of {exhibition.totalDays}</>
            )}
          </p>
          <p className='exhibition-workspace-summary'>
            {exhibition.registeredItems} {exhibition.registeredItems === 1 ? 'item' : 'items'} registered
            {' · '}{exhibition.customersAttended} {exhibition.customersAttended === 1 ? 'customer' : 'customers'} attended
            {' · '}{exhibition.totalSelections} active selections
          </p>
        </div>
      </header>

      <nav className='exhibition-workspace-tabs' aria-label='Exhibition workspace sections'>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type='button'
            className={`exhibition-workspace-tab ${activeTab === tab.id ? 'is-active' : ''}`}
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.countKey && (
              <span className='exhibition-workspace-tab-count'>
                {exhibition[tab.countKey]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className='exhibition-workspace-content' aria-live='polite'>
        <div className='exhibition-workspace-placeholder'>
          <span className='exhibition-workspace-placeholder-mark' aria-hidden='true'>
            {activeTab === 'overview' ? '◇' : activeTab === 'inventory' ? '▦' : activeTab === 'selections' ? '⌁' : '♧'}
          </span>
          <h2>{TABS.find((tab) => tab.id === activeTab)?.label}</h2>
          <p>
            {activeTab === 'overview' && 'Exhibition overview will be implemented in the next step.'}
            {activeTab === 'inventory' && 'Registered inventory and barcode registration will be implemented in a later step.'}
            {activeTab === 'selections' && 'Customer selection and barcode scanning workflows will be implemented in a later step.'}
            {activeTab === 'customers' && 'Exhibition attendees and their selections will be implemented in a later step.'}
          </p>
        </div>
      </div>
    </section>
  );
}
