import InventoryScreen from './features/inventory/InventoryScreen';

import './App.css';

function App() {
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
          <a
            className='app-nav-link app-nav-link--active'
            href='#inventory'
            aria-current='page'
          >
            <span aria-hidden='true'>▦</span>
            <span>Inventory</span>
          </a>
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
        </header>

        <main className='app-content' id='inventory'>
          <InventoryScreen />
        </main>
      </div>
    </div>
  );
}

export default App;
