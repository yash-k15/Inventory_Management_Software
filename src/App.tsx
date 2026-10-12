import { useState } from 'react';
import InventoryScreen from './features/inventory/InventoryScreen';
import AddItemScreen from './features/inventory/AddItemScreen';
import './App.css';

type View = 'inventory' | 'add-item';

function App() {
  const [view, setView] = useState<View>('inventory');
  const [notice, setNotice] = useState<string | null>(null);

  function handleCreated(itemNumber: string) {
    setNotice(`Jewelry item ${itemNumber} was saved successfully.`);
    setView('inventory');
  }

  return (
    <div className='app-shell'>
      <aside className='app-sidebar'>
        <div className='app-brand'>
          <div className='app-brand-mark' aria-hidden='true'>
            A
          </div>
          <p className='app-brand-name'>Jewelry Inventory</p>
        </div>

        <nav className='app-nav' aria-label='Main navigation'>
          <button
            type='button'
            className={`app-nav-link ${view === 'inventory' ? 'app-nav-link--active' : ''}`}
            onClick={() => setView('inventory')}
          >
            <span aria-hidden='true'>▦</span>
            <span>Inventory</span>
          </button>

          <button
            type='button'
            className={`app-nav-link ${view === 'add-item' ? 'app-nav-link--active' : ''}`}
            onClick={() => {
              setNotice(null);
              setView('add-item');
            }}
          >
            <span aria-hidden='true'>＋</span>
            <span>Add Jewelry Item</span>
          </button>
        </nav>
      </aside>

      <div className='app-main'>
        <header className='app-topbar'>
          <div>
            <h1 className='app-topbar-title'>Inventory Management</h1>
            <p className='app-topbar-subtitle'>
              Jewelry catalog and item details
            </p>
          </div>

          {view === 'inventory' && (
            <button
              type='button'
              className='app-button app-button--primary'
              onClick={() => {
                setNotice(null);
                setView('add-item');
              }}
            >
              + Add Jewelry Item
            </button>
          )}
        </header>

        <main className='app-content' id='inventory'>
          {notice && view === 'inventory' && (
            <p role='status' className='app-success-message'>
              {notice}
            </p>
          )}

          {view === 'inventory' ? (
            <InventoryScreen onAddItem={() => setView('add-item')} />
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
