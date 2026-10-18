import './Sidebar.css';

export type SidebarView =
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

interface SidebarProps {
  view: SidebarView;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  onNavigate: (view: SidebarView) => void;
  onAddItem: () => void;
  onOpenExhibitions: () => void;
}

function Sidebar({
  view,
  isCollapsed,
  onToggleCollapsed,
  onNavigate,
  onAddItem,
  onOpenExhibitions,
}: SidebarProps) {
  const navItems = [
    {
      label: 'Inventory',
      view: 'inventory' as const,
      icon: (
        <>
          <rect x='3.5' y='3.5' width='6' height='6' rx='1' />
          <rect x='14.5' y='3.5' width='6' height='6' rx='1' />
          <rect x='3.5' y='14.5' width='6' height='6' rx='1' />
          <rect x='14.5' y='14.5' width='6' height='6' rx='1' />
        </>
      ),
    },
    {
      label: 'Customers',
      view: 'customers' as const,
      icon: (
        <>
          <circle cx='9' cy='8' r='3.5' />
          <path d='M2.5 20v-1.5a6.5 6.5 0 0 1 13 0V20' />
          <path d='M16 4.8a3.5 3.5 0 0 1 0 6.4' />
          <path d='M18 14a5.5 5.5 0 0 1 3.5 5.1V20' />
        </>
      ),
    },
    {
      label: 'Exhibitions',
      view: 'exhibitions' as const,
      icon: (
        <>
          <rect x='3.5' y='5' width='17' height='15.5' rx='2' />
          <path d='M7.5 3v4M16.5 3v4M3.5 9.5h17M7.5 13h3M7.5 16.5h6' />
        </>
      ),
    },
    {
      label: 'Orders',
      view: 'orders' as const,
      icon: (
        <>
          <path d='M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17Z' />
          <path d='M9 8h6M9 12h6M9 16h3' />
        </>
      ),
    },
    {
      label: 'Payments',
      view: 'payments' as const,
      icon: (
        <>
          <rect x='2.5' y='5' width='19' height='14' rx='2' />
          <path d='M2.5 10h19M6.5 15h4' />
        </>
      ),
    },
    {
      label: 'Settings',
      view: 'settings' as const,
      icon: (
        <>
          <circle cx='12' cy='12' r='3' />
          <path d='m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z' />
        </>
      ),
    },
  ];

  function isActive(itemView: SidebarView) {
    if (itemView === 'exhibitions') {
      return view === 'exhibitions' || view === 'exhibition-workspace';
    }

    if (itemView === 'inventory') {
      return (
        view === 'inventory' || view === 'item-details' || view === 'edit-item'
      );
    }

    return view === itemView;
  }

  function handleNavigation(itemView: SidebarView) {
    if (itemView === 'exhibitions') {
      onOpenExhibitions();
      return;
    }

    if (itemView === 'inventory') {
      onNavigate('inventory');
      return;
    }

    onNavigate(itemView);
  }

  return (
    <aside className='app-sidebar'>
      <div className='app-brand'>
        <button
          type='button'
          className='app-sidebar-toggle'
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          onClick={onToggleCollapsed}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox='0 0 24 24' fill='none' aria-hidden='true'>
            {isCollapsed ? (
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
        {navItems.map((item) => (
          <button
            key={item.view}
            type='button'
            className={`app-nav-link ${
              isActive(item.view) ? 'app-nav-link--active' : ''
            }`}
            aria-current={isActive(item.view) ? 'page' : undefined}
            onClick={() => handleNavigation(item.view)}
            title={isCollapsed ? item.label : undefined}
          >
            <svg
              className='app-nav-icon'
              viewBox='0 0 24 24'
              fill='none'
              aria-hidden='true'
            >
              {item.icon}
            </svg>
            <span className='app-nav-label'>{item.label}</span>
          </button>
        ))}

        <button
          type='button'
          className={`app-nav-link ${
            view === 'add-item' ? 'app-nav-link--active' : ''
          }`}
          aria-current={view === 'add-item' ? 'page' : undefined}
          onClick={onAddItem}
          title={isCollapsed ? 'Add jewelry item' : undefined}
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
  );
}

export default Sidebar;
