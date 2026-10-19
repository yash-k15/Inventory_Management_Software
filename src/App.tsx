import { useState } from 'react';
import InventoryScreen from './features/inventory/InventoryScreen';
import AddItemScreen from './features/inventory/AddItemScreen';
import ItemDetailsScreen from './features/inventory/ItemDetailsScreen';
import CustomersScreen from './features/customers/CustomersScreen';
import CustomerDetailsScreen from './features/customers/CustomerDetailsScreen';
import ExhibitionsScreen from './features/exhibitions/ExhibitionsScreen';
import ExhibitionWorkspace from './features/exhibitions/ExhibitionWorkspace';
import SettingsScreen from './features/settings/SettingsScreen';
import OrdersScreen from './features/orders/OrdersScreen';
import PaymentsScreen from './features/payments/PaymentsScreen';
import Sidebar, { type SidebarView } from './components/Sidebar/Sidebar';
import './App.css';

function App() {
  const [view, setView] = useState<SidebarView>('inventory');
  const [notice, setNotice] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedExhibitionId, setSelectedExhibitionId] = useState<
    number | null
  >(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    null,
  );

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
      <Sidebar
        view={view}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() =>
          setIsSidebarCollapsed((collapsed) => !collapsed)
        }
        onNavigate={(nextView: SidebarView) => {
          if (!canLeaveSettings()) return;
          setNotice(null);
          setSelectedCustomerId(null);
          setView(nextView);
        }}
        onAddItem={openAddItem}
        onOpenExhibitions={openExhibitions}
      />

      <div className='app-main'>
        <main className='app-content' id='inventory'>
          <div className='app-content-inner'>
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
            {view === 'customers' && selectedCustomerId === null && (
              <CustomersScreen
                onViewCustomerHistory={(customerId) => {
                  setSelectedCustomerId(customerId);
                  setNotice(null);
                }}
              />
            )}

            {view === 'customers' && selectedCustomerId !== null && (
              <CustomerDetailsScreen
                customerId={selectedCustomerId}
                onBack={() => setSelectedCustomerId(null)}
              />
            )}
            {view === 'settings' && (
              <SettingsScreen onDirtyChange={setSettingsDirty} />
            )}
            {view === 'exhibitions' && (
              <ExhibitionsScreen onOpenExhibition={openExhibitionWorkspace} />
            )}
            {view === 'exhibition-workspace' &&
              selectedExhibitionId !== null && (
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
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
