import { useState } from 'react';
import InventoryScreen from './features/inventory/InventoryScreen';
import AddItemScreen from './features/inventory/AddItemScreen';
import ItemDetailsScreen from './features/inventory/ItemDetailsScreen';
import CustomersScreen from './features/customers/CustomersScreen';
import ExhibitionsScreen from './features/exhibitions/ExhibitionsScreen';
import './App.css';

type View =
  | 'inventory'
  | 'customers'
  | 'exhibitions'
  | 'add-item'
  | 'item-details'
  | 'edit-item';

function App() {
  const [view, setView] = useState<View>('inventory');
  const [notice, setNotice] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);

  function openAddItem() {
    setNotice(null);
    setView('add-item');
  }

  function openItemDetails(itemId: number) {
    setNotice(null);
    setSelectedItemId(itemId);
    setView('item-details');
  }

  const openEditItem = () => {
    if (selectedItemId === null) return;
    setNotice(null);
    setView('edit-item');
  };

  const handleUpdated = (itemNumber: string) => {
    setNotice(`Jewelry item ${itemNumber} was updated successfully.`);
    setView('item-details');
  };

  return (
    <div className={`app-shell ${isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}>
      <aside className='app-sidebar'>
        <div className='app-brand'>
          <button
            type='button'
            className='app-sidebar-toggle'
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
          <div className='app-brand-mark' aria-label='Anmol Diamonds'>AD</div>
          <div className='app-brand-text'>
            <span className='app-brand-name'>Anmol</span>
            <span className='app-brand-name'>Diamonds</span>
          </div>
        </div>

        <nav className='app-nav' aria-label='Main navigation'>
          <button
            type='button'
            className={`app-nav-link ${view === 'inventory' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'inventory' ? 'page' : undefined}
            onClick={() => setView('inventory')}
            title={isSidebarCollapsed ? 'Inventory' : undefined}
          >
            <svg className='app-nav-icon' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <rect x='3.5' y='3.5' width='6' height='6' rx='1' />
              <rect x='14.5' y='3.5' width='6' height='6' rx='1' />
              <rect x='3.5' y='14.5' width='6' height='6' rx='1' />
              <rect x='14.5' y='14.5' width='6' height='6' rx='1' />
            </svg>
            <span className='app-nav-label'>Inventory</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'customers' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'customers' ? 'page' : undefined}
            onClick={() => setView('customers')}
            title={isSidebarCollapsed ? 'Customers' : undefined}
          >
            <svg className='app-nav-icon' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <circle cx='9' cy='8' r='3.5' />
              <path d='M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20' />
              <path d='M16 4.8a3.5 3.5 0 0 1 0 6.4' />
              <path d='M18 14a5.5 5.5 0 0 1 3.5 5.1V20' />
            </svg>
            <span className='app-nav-label'>Customers</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'exhibitions' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'exhibitions' ? 'page' : undefined}
            onClick={() => { setNotice(null); setView('exhibitions'); }}
            title={isSidebarCollapsed ? 'Exhibitions' : undefined}
          >
            <svg className='app-nav-icon' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
              <rect x='3.5' y='5' width='17' height='15.5' rx='2' />
              <path d='M7.5 3v4M16.5 3v4M3.5 9.5h17M7.5 13h3M7.5 16.5h6' />
            </svg>
            <span className='app-nav-label'>Exhibitions</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'add-item' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'add-item' ? 'page' : undefined}
            onClick={openAddItem}
            title={isSidebarCollapsed ? 'Add jewelry item' : undefined}
          >
            <svg className='app-nav-icon' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
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
            <p role='status' className='app-success-message'>{notice}</p>
          )}
          {view === 'inventory' && (
            <InventoryScreen onAddItem={openAddItem} onViewItem={openItemDetails} />
          )}
          {view === 'customers' && <CustomersScreen />}
          {view === 'exhibitions' && <ExhibitionsScreen />}
          {view === 'add-item' && (
            <AddItemScreen
              onCancel={() => setView('inventory')}
              onCreated={(itemNumber) => {
                setNotice(`Jewelry item ${itemNumber} was created successfully.`);
                setView('inventory');
              }}
            />
          )}
          {view === 'edit-item' && selectedItemId !== null && (
            <AddItemScreen
              itemId={selectedItemId}
              onCancel={() => setView('item-details')}
              onUpdated={handleUpdated}
              onCreated={() => {}}
            />
          )}
          {view === 'item-details' && selectedItemId !== null && (
            <ItemDetailsScreen itemId={selectedItemId} onBack={() => setView('inventory')} onEdit={openEditItem} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
