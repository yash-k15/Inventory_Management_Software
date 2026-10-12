import { useState } from 'react';
import InventoryScreen from './features/inventory/InventoryScreen';
import AddItemScreen from './features/inventory/AddItemScreen';
import './App.css';

type View = 'inventory' | 'add-item';

function App() {
  const [view, setView] = useState<View>('inventory');
  const [notice, setNotice] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  function handleCreated(itemNumber: string) {
    setNotice(`Jewelry item ${itemNumber} was saved successfully.`);
    setView('inventory');
  }

  function openAddItem() {
    setNotice(null);
    setView('add-item');
  }

  return (
    <div
      className={`app-shell ${
        isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''
      }`}
    >
      <aside className='app-sidebar'>
        <div className='app-brand'>
          <button
            type='button'
            className='app-sidebar-toggle'
            aria-label={
              isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            }
            aria-expanded={!isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              {isSidebarCollapsed ? (
                <path d='M9 5l7 7-7 7' />
              ) : (
                <>
                  <rect x='3.5' y='4' width='17' height='16' rx='2' />
                  <path d='M9 4v16' />
                </>
              )}
            </svg>
          </button>

          <div className='app-brand-mark' aria-label='Anmol Diamonds'>
            AD
          </div>

          <div className='app-brand-text'>
            <span className='app-brand-name'>Anmol</span>
            <span className='app-brand-name'>Diamonds</span>
          </div>
        </div>

        <nav className='app-nav' aria-label='Main navigation'>
          <button
            type='button'
            className={`app-nav-link ${
              view === 'inventory' ? 'app-nav-link--active' : ''
            }`}
            aria-current={view === 'inventory' ? 'page' : undefined}
            onClick={() => setView('inventory')}
            title={isSidebarCollapsed ? 'Inventory' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <rect x='3.5' y='3.5' width='6' height='6' rx='1' />
              <rect x='14.5' y='3.5' width='6' height='6' rx='1' />
              <rect x='3.5' y='14.5' width='6' height='6' rx='1' />
              <rect x='14.5' y='14.5' width='6' height='6' rx='1' />
            </svg>
            <span className='app-nav-label'>Inventory</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${
              view === 'add-item' ? 'app-nav-link--active' : ''
            }`}
            aria-current={view === 'add-item' ? 'page' : undefined}
            onClick={openAddItem}
            title={isSidebarCollapsed ? 'Add jewelry item' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <path d='M12 5v14M5 12h14' />
            </svg>
            <span className='app-nav-label'>Add jewelry item</span>
          </button>
        </nav>

        <div className='app-sidebar-footer'>
          <span>Jewelry catalog</span>
          <span>Anmol Diamonds</span>
        </div>
      </aside>

      <div className='app-main'>
        <main className='app-content' id='inventory'>
          {notice && view === 'inventory' && (
            <p role='status' className='app-success-message'>
              {notice}
            </p>
          )}

          {view === 'inventory' ? (
            <InventoryScreen onAddItem={openAddItem} />
          ) : (
            <AddItemScreen
              onCancel={() => setView('inventory')}
              onCreated={handleCreated}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
