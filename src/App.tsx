import { useState } from 'react';
import InventoryScreen from './features/inventory/InventoryScreen';
import AddItemScreen from './features/inventory/AddItemScreen';
import ItemDetailsScreen from './features/inventory/ItemDetailsScreen';
import CustomersScreen from './features/customers/CustomersScreen';
import ExhibitionsScreen from './features/exhibitions/ExhibitionsScreen';
import ExhibitionWorkspace from './features/exhibitions/ExhibitionWorkspace';
import SettingsScreen from './features/settings/SettingsScreen';
import OrdersScreen from './features/orders/OrdersScreen';
import PaymentsScreen from './features/payments/PaymentsScreen';
import './App.css';

type View =
  | 'inventory'
  | 'customers'
  | 'exhibitions'
  | 'exhibition-workspace'
  | 'orders'
  | 'payments'
  | 'add-item'
  | 'item-details'
  | 'edit-item'
  | 'settings';

function App() {
  const [view, setView] = useState<View>('inventory');
  const [notice, setNotice] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedExhibitionId, setSelectedExhibitionId] = useState<
    number | null
  >(null);

  function canLeaveSettings() {
    if (view !== 'settings' || !settingsDirty) return true;
    const shouldLeave = window.confirm(
      'You have an unfinished Settings edit. Leave this screen and discard it?',
    );
    if (shouldLeave) setSettingsDirty(false);
    return shouldLeave;
  }

  function openAddItem() {
    if (!canLeaveSettings()) return;
    setNotice(null);
    setView('add-item');
  }

  function openItemDetails(itemId: number) {
    setNotice(null);
    setSelectedItemId(itemId);
    setView('item-details');
  }

  function openExhibitionWorkspace(exhibitionId: number) {
    setNotice(null);
    setSelectedExhibitionId(exhibitionId);
    setView('exhibition-workspace');
  }

  function openExhibitions() {
    if (!canLeaveSettings()) return;
    setNotice(null);
    setView('exhibitions');
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
    <div
      className={`app-shell ${isSidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`}
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
            className={`app-nav-link ${view === 'inventory' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'inventory' ? 'page' : undefined}
            onClick={() => {
              if (canLeaveSettings()) setView('inventory');
            }}
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
            className={`app-nav-link ${view === 'customers' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'customers' ? 'page' : undefined}
            onClick={() => {
              if (canLeaveSettings()) setView('customers');
            }}
            title={isSidebarCollapsed ? 'Customers' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <circle cx='9' cy='8' r='3.5' />
              <path d='M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20' />
              <path d='M16 4.8a3.5 3.5 0 0 1 0 6.4' />
              <path d='M18 14a5.5 5.5 0 0 1 3.5 5.1V20' />
            </svg>
            <span className='app-nav-label'>Customers</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'exhibitions' || view === 'exhibition-workspace' ? 'app-nav-link--active' : ''}`}
            aria-current={
              view === 'exhibitions' || view === 'exhibition-workspace'
                ? 'page'
                : undefined
            }
            onClick={openExhibitions}
            title={isSidebarCollapsed ? 'Exhibitions' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <rect x='3.5' y='5' width='17' height='15.5' rx='2' />
              <path d='M7.5 3v4M16.5 3v4M3.5 9.5h17M7.5 13h3M7.5 16.5h6' />
            </svg>
            <span className='app-nav-label'>Exhibitions</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'orders' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'orders' ? 'page' : undefined}
            onClick={() => {
              if (canLeaveSettings()) {
                setNotice(null);
                setView('orders');
              }
            }}
            title={isSidebarCollapsed ? 'Orders' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <path d='M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z' />
              <path d='M9 8h6M9 12h6M9 16h3' />
            </svg>
            <span className='app-nav-label'>Orders</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'payments' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'payments' ? 'page' : undefined}
            onClick={() => {
              if (canLeaveSettings()) {
                setNotice(null);
                setView('payments');
              }
            }}
            title={isSidebarCollapsed ? 'Payments' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <rect x='2.5' y='5' width='19' height='14' rx='2' />
              <path d='M2.5 10h19M6.5 15h4' />
            </svg>
            <span className='app-nav-label'>Payments</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'settings' ? 'app-nav-link--active' : ''}`}
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => setView('settings')}
            title={isSidebarCollapsed ? 'Settings' : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              <circle cx='12' cy='12' r='3' />
              <path d='m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z' />
            </svg>
            <span className='app-nav-label'>Settings</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'add-item' ? 'app-nav-link--active' : ''}`}
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
          {view === 'inventory' && (
            <InventoryScreen
              onAddItem={openAddItem}
              onViewItem={openItemDetails}
            />
          )}
          {view === 'orders' && <OrdersScreen />}
          {view === 'customers' && <CustomersScreen />}
          {view === 'settings' && (
            <SettingsScreen onDirtyChange={setSettingsDirty} />
          )}
          {view === 'exhibitions' && (
            <ExhibitionsScreen onOpenExhibition={openExhibitionWorkspace} />
          )}
          {view === 'exhibition-workspace' && selectedExhibitionId !== null && (
            <ExhibitionWorkspace
              exhibitionId={selectedExhibitionId}
              onBack={openExhibitions}
            />
          )}
          {view === 'payments' && (
            <PaymentsScreen
              onAddPayment={() => {
                // Modal wiring will be added in the next step.
              }}
            />
          )}
          {view === 'add-item' && (
            <AddItemScreen
              onCancel={() => setView('inventory')}
              onCreated={(itemNumber) => {
                setNotice(
                  `Jewelry item ${itemNumber} was created successfully.`,
                );
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
            <ItemDetailsScreen
              itemId={selectedItemId}
              onBack={() => setView('inventory')}
              onEdit={openEditItem}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
