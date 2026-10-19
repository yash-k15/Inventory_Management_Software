import { useEffect, type ReactNode } from 'react';
import './FilterPanel.css';

type FilterPanelProps = {
  isOpen: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
  resetLabel?: string;
  applyLabel?: string;
  subtitle?: string;
};

function FilterPanel({
  isOpen,
  title,
  children,
  onClose,
  onReset,
  onApply,
  resetLabel = 'Reset',
  applyLabel = 'Apply filters',
  subtitle = 'Refine your results using the options below.',
}: FilterPanelProps) {
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className='filter-panel-overlay'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className='filter-panel'
        role='dialog'
        aria-modal='true'
        aria-labelledby='filter-panel-title'
      >
        <header className='filter-panel-header'>
          <div>
            <h2 id='filter-panel-title'>{title}</h2>
            <p>{subtitle}</p>
          </div>

          <button
            type='button'
            className='filter-panel-close'
            aria-label='Close filters'
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className='filter-panel-content'>{children}</div>

        <footer className='filter-panel-footer'>
          <button
            type='button'
            className='filter-panel-reset'
            onClick={onReset}
          >
            {resetLabel}
          </button>

          <button
            type='button'
            className='filter-panel-apply'
            onClick={() => {
              onApply();
              onClose();
            }}
          >
            {applyLabel}
          </button>
        </footer>
      </aside>
    </div>
  );
}

export default FilterPanel;
