import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import AddCustomerModalRedesigned, {
  type NewCustomerInput,
} from './AddCustomerModal';
import EditCustomerModal from './EditCustomerModal';
import {
  getCustomerContacts,
  getCustomerRecentPurchases,
  getCustomers,
} from './customer.queries';
import type {
  Customer,
  CustomerArchiveFilter,
  CustomerContact,
  CustomerRecentPurchase,
} from './customer.types';
import './CustomersScreen.css';

type Notice = { id: number; kind: 'success' | 'error'; message: string };
type MergeField = 'businessName' | 'email' | 'city' | 'address' | 'notes';
type MergeChoices = Record<MergeField, 'keep' | 'duplicate'>;

type MergeCustomerSelectProps = {
  options: Customer[];
  value: number | null;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: number | null) => void;
};

type CustomersScreenProps = {
  onViewCustomerHistory: (customerId: number) => void;
};

function MergeCustomerSelect({
  options,
  value,
  placeholder,
  ariaLabel,
  onChange,
}: MergeCustomerSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((customer) => customer.id === value);

  const updateMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
    const spaceAbove = rect.top - gap - 12;
    const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      100,
      Math.min(240, openAbove ? spaceAbove : spaceBelow),
    );
    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      maxHeight,
      ...(openAbove
        ? { bottom: window.innerHeight - rect.top + gap }
        : { top: rect.bottom + gap }),
    });
  }, []);

  const choose = (customer: Customer) => {
    onChange(customer.id);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      )
        return;
      setIsOpen(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setActiveIndex(
          Math.max(
            0,
            options.findIndex((item) => item.id === value),
          ),
        );
        setIsOpen(true);
      } else if (options.length) {
        setActiveIndex((current) =>
          event.key === 'ArrowDown'
            ? (current + 1) % options.length
            : (current - 1 + options.length) % options.length,
        );
      }
      return;
    }
    if (event.key === 'Enter' && isOpen && options[activeIndex]) {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  };

  return (
    <div className={`merge-select ${isOpen ? 'is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type='button'
        className='merge-select-trigger'
        aria-label={ariaLabel}
        aria-haspopup='listbox'
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleKeyDown}
      >
        <span className={!selected ? 'is-placeholder' : ''}>
          {selected
            ? `${selected.businessName}${ariaLabel === 'Duplicate customer' && selected.city?.trim() ? ` — ${selected.city}` : ''}`
            : placeholder}
        </span>
        <svg
          width='18'
          height='18'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.8'
          strokeLinecap='round'
          strokeLinejoin='round'
          aria-hidden='true'
        >
          <path d='m7 10 5 5 5-5' />
        </svg>
      </button>
      {isOpen &&
        createPortal(
          <div
            className='merge-select-options'
            role='listbox'
            aria-label={ariaLabel}
            style={menuStyle}
            ref={menuRef}
          >
            {options.map((customer, index) => (
              <button
                type='button'
                role='option'
                aria-selected={customer.id === value}
                className={`merge-select-option ${customer.id === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                key={customer.id}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(customer)}
              >
                <span>
                  {customer.businessName}
                  {ariaLabel === 'Duplicate customer' && customer.city?.trim()
                    ? ` — ${customer.city}`
                    : ''}
                </span>
                {customer.id === value && (
                  <span className='merge-select-check' aria-hidden='true'>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

export default function CustomersScreenRedesigned({
  onViewCustomerHistory,
}: CustomersScreenProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [archiveStatus, setArchiveStatus] =
    useState<CustomerArchiveFilter>('active');
  const [expandedCustomerId, setExpandedCustomerId] = useState<number | null>(
    null,
  );
  const [contactsByCustomer, setContactsByCustomer] = useState<
    Record<number, CustomerContact[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [, setLoadingContactsId] = useState<number | null>(null);
  const [recentPurchasesByCustomer, setRecentPurchasesByCustomer] = useState<
    Record<number, CustomerRecentPurchase[]>
  >({});
  const [loadingPurchasesId, setLoadingPurchasesId] = useState<number | null>(
    null,
  );
  const [purchaseErrorsByCustomer, setPurchaseErrorsByCustomer] = useState<
    Record<number, string>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [, setContactError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<number | null>(
    null,
  );
  const [customerArchiveTarget, setCustomerArchiveTarget] =
    useState<Customer | null>(null);
  const [isUpdatingArchiveStatus, setIsUpdatingArchiveStatus] = useState(false);
  const [customerDeleteTarget, setCustomerDeleteTarget] =
    useState<Customer | null>(null);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
  const [mergeStep, setMergeStep] = useState<1 | 2 | 3>(1);
  const [mergeCustomerOptions, setMergeCustomerOptions] = useState<Customer[]>(
    [],
  );
  const [mergeKeepId, setMergeKeepId] = useState<number | null>(null);
  const [mergeDuplicateId, setMergeDuplicateId] = useState<number | null>(null);
  const [mergeChoices, setMergeChoices] = useState<MergeChoices>({
    businessName: 'keep',
    email: 'keep',
    city: 'keep',
    address: 'keep',
    notes: 'keep',
  });
  const [isMergingCustomers, setIsMergingCustomers] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [noticeId, setNoticeId] = useState(0);

  const loadCustomers = useCallback(
    async (nextSearch = search, nextArchiveStatus = archiveStatus) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getCustomers({
          search: nextSearch,
          archiveStatus: nextArchiveStatus,
        });
        setCustomers(result);
        if (
          expandedCustomerId !== null &&
          !result.some((customer) => customer.id === expandedCustomerId)
        ) {
          setExpandedCustomerId(null);
          setContactError(null);
        }
      } catch (err) {
        console.error('Failed to load customers:', err);
        setError('Unable to load customers. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [search, archiveStatus, expandedCustomerId],
  );

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const showNotice = (kind: Notice['kind'], message: string) => {
    const nextId = noticeId + 1;
    setNoticeId(nextId);
    setNotice({ id: nextId, kind, message });
  };

  const handleSaveCustomer = async (customer: NewCustomerInput) => {
    try {
      await invoke('create_customer', {
        input: {
          businessName: customer.businessName,
          email: customer.email,
          city: customer.city,
          address: customer.address,
          notes: customer.notes,
          contacts: customer.contacts.map((contact) => ({
            name: contact.name,
            phone1: contact.phone1,
            phone2: contact.phone2,
            notes: contact.notes,
            isPrimary: contact.isPrimary,
          })),
        },
      });

      // Explicitly refresh with the active filter and cleared search.
      // Do not rely on state changes to trigger useEffect: the values may
      // already be '', and 'active', in which case React has nothing to change.
      setSearch('');
      setArchiveStatus('active');
      setExpandedCustomerId(null);
      setContactError(null);
      setContactsByCustomer({});
      setIsAddModalOpen(false);
      setNotice(null);

      setLoading(true);
      setError(null);
      try {
        const refreshed = await getCustomers({
          search: '',
          archiveStatus: 'active',
        });
        setCustomers(refreshed);
        showNotice(
          'success',
          `${customer.businessName} was added successfully.`,
        );
      } catch (refreshError) {
        console.error(
          'Customer saved, but the list could not be refreshed:',
          refreshError,
        );
        showNotice(
          'error',
          `${customer.businessName} was saved, but the list could not refresh. Use Refresh to try again.`,
        );
        setError('Unable to refresh customers. Please try again.');
      } finally {
        setLoading(false);
      }
    } catch (err) {
      console.error('Failed to save customer:', err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        message || 'Unable to save the customer. Please try again.',
      );
    }
  };

  const openEditCustomer = async (customerId: number) => {
    setNotice(null);
    setContactError(null);
    setEditingCustomerId(customerId);

    if (contactsByCustomer[customerId]) return;

    setLoadingContactsId(customerId);
    try {
      const contacts = await getCustomerContacts(customerId);
      setContactsByCustomer((current) => ({
        ...current,
        [customerId]: contacts,
      }));
    } catch (err) {
      console.error('Failed to load contacts for editing:', err);
      setEditingCustomerId(null);
      showNotice(
        'error',
        'Unable to load this customer’s contacts. Please try again.',
      );
    } finally {
      setLoadingContactsId(null);
    }
  };

  const handleUpdateCustomer = async (
    customerId: number,
    customerInput: NewCustomerInput,
  ) => {
    try {
      await invoke('update_customer', {
        customerId,
        input: {
          businessName: customerInput.businessName,
          email: customerInput.email,
          city: customerInput.city,
          address: customerInput.address,
          notes: customerInput.notes,
          contacts: customerInput.contacts.map((contact) => ({
            name: contact.name,
            phone1: contact.phone1,
            phone2: contact.phone2,
            notes: contact.notes,
            isPrimary: contact.isPrimary,
          })),
        },
      });

      const updatedContacts = await getCustomerContacts(customerId);
      setContactsByCustomer((current) => ({
        ...current,
        [customerId]: updatedContacts,
      }));
      const refreshed = await getCustomers({ search, archiveStatus });
      setCustomers(refreshed);
      setEditingCustomerId(null);
      setExpandedCustomerId(customerId);
      showNotice(
        'success',
        `${customerInput.businessName} was updated successfully.`,
      );
    } catch (err) {
      console.error('Failed to update customer:', err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        message || 'Unable to update the customer. Please try again.',
      );
    }
  };

  const handleSetCustomerArchived = async () => {
    if (!customerArchiveTarget || isUpdatingArchiveStatus) return;

    const customer = customerArchiveTarget;
    const archived = customer.isArchived !== 1;
    setIsUpdatingArchiveStatus(true);

    try {
      await invoke('set_customer_archived', {
        customerId: customer.id,
        archived,
      });

      setCustomerArchiveTarget(null);
      setExpandedCustomerId(null);
      const refreshed = await getCustomers({ search, archiveStatus });
      setCustomers(refreshed);
      showNotice(
        'success',
        archived
          ? `${customer.businessName} was archived successfully.`
          : `${customer.businessName} was restored successfully.`,
      );
    } catch (err) {
      console.error('Failed to update customer archive status:', err);
      const message = err instanceof Error ? err.message : String(err);
      showNotice(
        'error',
        message || 'Unable to update this customer. Please try again.',
      );
    } finally {
      setIsUpdatingArchiveStatus(false);
    }
  };

  const openMergeCustomers = async (customerId: number) => {
    setNotice(null);
    try {
      const allCustomers = await getCustomers({
        search: '',
        archiveStatus: 'all',
      });
      setMergeCustomerOptions(allCustomers);
    } catch (err) {
      console.error('Failed to load customers for merging:', err);
      showNotice(
        'error',
        'Unable to load customers for merging. Please try again.',
      );
      return;
    }
    setMergeKeepId(customerId);
    setMergeDuplicateId(null);
    setMergeChoices({
      businessName: 'keep',
      email: 'keep',
      city: 'keep',
      address: 'keep',
      notes: 'keep',
    });
    setMergeStep(1);
  };

  const closeMergeCustomers = () => {
    if (isMergingCustomers) return;
    setMergeStep(1);
    setMergeKeepId(null);
    setMergeDuplicateId(null);
  };

  const handleMergeCustomers = async () => {
    if (mergeKeepId === null || mergeDuplicateId === null || isMergingCustomers)
      return;
    const keep = mergeCustomerOptions.find(
      (customer) => customer.id === mergeKeepId,
    );
    const duplicate = mergeCustomerOptions.find(
      (customer) => customer.id === mergeDuplicateId,
    );
    if (!keep || !duplicate) {
      showNotice(
        'error',
        'One of the selected customers is no longer in the list. Refresh and try again.',
      );
      closeMergeCustomers();
      return;
    }
    const value = (field: MergeField) =>
      mergeChoices[field] === 'keep' ? keep[field] : duplicate[field];
    setIsMergingCustomers(true);
    try {
      await invoke('merge_customers', {
        input: {
          keepCustomerId: keep.id,
          duplicateCustomerId: duplicate.id,
          businessName: value('businessName')?.trim() || '',
          email: value('email'),
          city: value('city'),
          address: value('address'),
          notes: value('notes'),
        },
      });
      setMergeStep(1);
      setMergeKeepId(null);
      setMergeDuplicateId(null);
      setExpandedCustomerId(null);
      setContactsByCustomer({});
      const refreshed = await getCustomers({ search, archiveStatus });
      setCustomers(refreshed);
      showNotice(
        'success',
        `${duplicate.businessName} was merged into ${value('businessName') || keep.businessName}.`,
      );
    } catch (err) {
      console.error('Failed to merge customers:', err);
      const message =
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      showNotice(
        'error',
        message || 'Unable to merge these customers. No changes were saved.',
      );
    } finally {
      setIsMergingCustomers(false);
    }
  };

  const handleDeleteArchivedCustomer = async () => {
    if (!customerDeleteTarget || isDeletingCustomer) return;

    const customer = customerDeleteTarget;
    setIsDeletingCustomer(true);

    try {
      await invoke('delete_archived_customer', {
        customerId: customer.id,
      });

      setCustomerDeleteTarget(null);
      setExpandedCustomerId(null);
      setContactsByCustomer((current) => {
        const next = { ...current };
        delete next[customer.id];
        return next;
      });

      try {
        const refreshed = await getCustomers({ search, archiveStatus });
        setCustomers(refreshed);
      } catch (refreshError) {
        console.error(
          'Customer deleted, but the list could not refresh:',
          refreshError,
        );
        await loadCustomers();
      }

      showNotice(
        'success',
        `${customer.businessName} was permanently deleted.`,
      );
    } catch (err) {
      console.error('Failed to delete archived customer:', err);
      const message =
        typeof err === 'string'
          ? err
          : err instanceof Error
            ? err.message
            : String(err);
      setCustomerDeleteTarget(null);
      showNotice(
        'error',
        message || 'Unable to delete this customer. Please try again.',
      );
    } finally {
      setIsDeletingCustomer(false);
    }
  };

  const toggleCustomer = async (customerId: number) => {
    if (expandedCustomerId === customerId) {
      setExpandedCustomerId(null);
      setContactError(null);
      return;
    }

    setExpandedCustomerId(customerId);
    setContactError(null);

    if (!contactsByCustomer[customerId]) {
      setLoadingContactsId(customerId);
      try {
        const contacts = await getCustomerContacts(customerId);
        setContactsByCustomer((current) => ({
          ...current,
          [customerId]: contacts,
        }));
      } catch (err) {
        console.error('Failed to load customer contacts:', err);
        setContactError('Unable to load contact details.');
      } finally {
        setLoadingContactsId(null);
      }
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        recentPurchasesByCustomer,
        customerId,
      )
    ) {
      setLoadingPurchasesId(customerId);
      setPurchaseErrorsByCustomer((current) => {
        const next = { ...current };
        delete next[customerId];
        return next;
      });
      try {
        const purchases = await getCustomerRecentPurchases(customerId);
        setRecentPurchasesByCustomer((current) => ({
          ...current,
          [customerId]: purchases,
        }));
      } catch (err) {
        console.error('Failed to load recent customer purchases:', err);
        setPurchaseErrorsByCustomer((current) => ({
          ...current,
          [customerId]: 'Unable to load recent purchases.',
        }));
      } finally {
        setLoadingPurchasesId(null);
      }
    }
  };

  const formatValue = (value: string | null | undefined) =>
    value?.trim() || '—';
  const initials = (name: string) =>
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');

  const currency = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function formatCurrency(paise: number) {
    return currency.format(paise / 100);
  }

  function formatDate(value: string | null | undefined) {
    if (!value) return '—';

    const date = new Date(`${value.slice(0, 10)}T00:00:00`);

    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  return (
    <section className='customers-v2'>
      {notice && (
        <div
          className={`customers-notice customers-notice--${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          <span className='customers-notice-icon' aria-hidden='true'>
            {notice.kind === 'success' ? '✓' : '!'}
          </span>
          <span>{notice.message}</span>
          <button
            type='button'
            aria-label='Dismiss message'
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      <header className='customers-header'>
        <div>
          <h1>Customers</h1>
          <p>Search, review and manage your business customers.</p>
        </div>
        <button
          type='button'
          className='customers-primary-button'
          onClick={() => {
            setNotice(null);
            setIsAddModalOpen(true);
          }}
        >
          <span aria-hidden='true'>+</span> Add customer
        </button>
      </header>

      <div className='customers-toolbar'>
        <label className='customers-search'>
          <span className='customers-search-icon' aria-hidden='true'>
            ⌕
          </span>
          <span className='sr-only'>Search customers</span>
          <input
            type='search'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Search business, contact, phone, email or city…'
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
          className='customers-tabs'
          role='group'
          aria-label='Customer status filter'
        >
          {(
            [
              ['active', 'Active'],
              ['archived', 'Archived'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button
              type='button'
              key={value}
              className={archiveStatus === value ? 'is-active' : ''}
              aria-pressed={archiveStatus === value}
              onClick={() => setArchiveStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className='customers-list-heading'>
        <span>
          {loading
            ? 'Loading customers…'
            : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}`}
        </span>
        <button
          type='button'
          className='customers-quiet-button'
          onClick={() => void loadCustomers()}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className='customers-state customers-error' role='alert'>
          <p>{error}</p>
          <button
            type='button'
            className='customers-secondary-button'
            onClick={() => void loadCustomers()}
          >
            Try again
          </button>
        </div>
      )}

      {!error && loading && (
        <div className='customers-state'>Loading customers…</div>
      )}

      {!error && !loading && customers.length === 0 && (
        <div className='customers-empty'>
          <div className='customers-empty-icon' aria-hidden='true'>
            ♙
          </div>
          <h2>
            {search
              ? 'No matching customers'
              : archiveStatus === 'archived'
                ? 'No archived customers'
                : 'No customers yet'}
          </h2>
          <p>
            {search
              ? 'Try a different search term.'
              : 'Add a business customer to start keeping their contact details together.'}
          </p>
          {!search && archiveStatus !== 'archived' && (
            <button
              type='button'
              className='customers-primary-button'
              onClick={() => setIsAddModalOpen(true)}
            >
              + Add customer
            </button>
          )}
        </div>
      )}

      {!error && !loading && customers.length > 0 && (
        <div className='customers-table-wrap'>
          <table className='customers-table'>
            <thead>
              <tr>
                <th className='customers-expand-col'>
                  <span className='sr-only'>Expand</span>
                </th>
                <th>Business Name</th>
                <th>Contact Name</th>
                <th>City</th>
                <th>Orders</th>
                <th>Lifetime Value</th>
                <th>Last Purchase</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => {
                const expanded = expandedCustomerId === customer.id;

                return (
                  <Fragment key={customer.id}>
                    <tr
                      key={`customer-${customer.id}`}
                      className={`customers-row ${expanded ? 'is-expanded' : ''}`}
                      onClick={() => void toggleCustomer(customer.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;

                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void toggleCustomer(customer.id);
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={expanded}
                    >
                      <td>
                        <button
                          type='button'
                          className='customers-expand'
                          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${customer.businessName}`}
                          aria-expanded={expanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            void toggleCustomer(customer.id);
                          }}
                        >
                          <svg
                            className={`customers-chevron ${expanded ? 'is-expanded' : ''}`}
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='1.8'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            aria-hidden='true'
                          >
                            <path d='m9 18 6-6-6-6' />
                          </svg>
                        </button>
                      </td>

                      <td>
                        <button
                          type='button'
                          className='customers-business'
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className='customers-avatar'>
                            {initials(customer.businessName) || '?'}
                          </span>
                          <span className='customers-business-copy'>
                            <strong>{customer.businessName}</strong>
                          </span>
                        </button>
                      </td>

                      <td>
                        <span className='customers-business-copy'>
                          <strong>{customer.primaryContactName}</strong>
                          <small>
                            {formatValue(customer.primaryContactPhone1)}
                          </small>
                        </span>
                      </td>
                      <td>{formatValue(customer.city)}</td>
                      <td className='customers-metric'>
                        {customer.orderCount}
                      </td>
                      <td className='customers-metric'>
                        {formatCurrency(customer.lifetimeValuePaise)}
                      </td>
                      <td className='customers-metric'>
                        {formatDate(customer.lastPurchaseDate)}
                      </td>
                    </tr>
                    {expanded && (
                      <tr
                        key={`details-${customer.id}`}
                        className='customers-details-row'
                      >
                        <td colSpan={7}>
                          <div className='customers-details'>
                            <div className='customers-expanded-grid'>
                              <section className='customers-expanded-section'>
                                <h3>Contact</h3>
                                {customer.email?.trim() && (
                                  <p>{customer.email}</p>
                                )}
                                {customer.address?.trim() && (
                                  <p>{customer.address}</p>
                                )}
                                {!customer.email?.trim() &&
                                  !customer.address?.trim() && (
                                    <p className='customers-muted'>
                                      No business contact details added.
                                    </p>
                                  )}
                              </section>

                              <section className='customers-expanded-section'>
                                <h3>Recent purchases</h3>
                                {loadingPurchasesId === customer.id &&
                                  !Object.prototype.hasOwnProperty.call(
                                    recentPurchasesByCustomer,
                                    customer.id,
                                  ) && (
                                    <p className='customers-muted'>
                                      Loading recent purchases…
                                    </p>
                                  )}
                                {purchaseErrorsByCustomer[customer.id] && (
                                  <div className='customers-inline-error'>
                                    <span>
                                      {purchaseErrorsByCustomer[customer.id]}
                                    </span>
                                    <button
                                      type='button'
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setLoadingPurchasesId(customer.id);
                                        setPurchaseErrorsByCustomer(
                                          (current) => {
                                            const next = { ...current };
                                            delete next[customer.id];
                                            return next;
                                          },
                                        );
                                        void getCustomerRecentPurchases(
                                          customer.id,
                                        )
                                          .then((purchases) => {
                                            setRecentPurchasesByCustomer(
                                              (current) => ({
                                                ...current,
                                                [customer.id]: purchases,
                                              }),
                                            );
                                          })
                                          .catch((err) => {
                                            console.error(
                                              'Failed to reload recent customer purchases:',
                                              err,
                                            );
                                            setPurchaseErrorsByCustomer(
                                              (current) => ({
                                                ...current,
                                                [customer.id]:
                                                  'Unable to load recent purchases.',
                                              }),
                                            );
                                          })
                                          .finally(() =>
                                            setLoadingPurchasesId(null),
                                          );
                                      }}
                                    >
                                      Retry
                                    </button>
                                  </div>
                                )}
                                {Object.prototype.hasOwnProperty.call(
                                  recentPurchasesByCustomer,
                                  customer.id,
                                ) &&
                                  recentPurchasesByCustomer[customer.id]
                                    .length === 0 && (
                                    <p className='customers-muted'>
                                      No purchases recorded yet.
                                    </p>
                                  )}
                                {(
                                  recentPurchasesByCustomer[customer.id] ?? []
                                ).map((purchase) => (
                                  <div
                                    className='customers-recent-purchase'
                                    key={purchase.orderItemId}
                                  >
                                    <div className='customers-recent-purchase-copy'>
                                      <span>
                                        <strong>{purchase.itemNumber}</strong>
                                        {' · '}
                                        {formatValue(purchase.itemName)}
                                        {' · '}
                                        {formatDate(purchase.orderDate)}
                                      </span>
                                    </div>

                                    <strong className='customers-recent-purchase-amount'>
                                      {formatCurrency(purchase.amountPaise)}
                                    </strong>
                                  </div>
                                ))}
                              </section>

                              <section className='customers-expanded-section'>
                                <h3>Notes</h3>
                                <p className='customers-note-text'>
                                  {formatValue(customer.notes)}
                                </p>
                              </section>
                            </div>

                            <div className='customers-detail-actions'>
                              <button
                                type='button'
                                className='customers-action-primary'
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onViewCustomerHistory(customer.id);
                                }}
                                title='View customer history'
                              >
                                View full history
                              </button>
                              <button
                                type='button'
                                className='customers-action-secondary'
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void openEditCustomer(customer.id);
                                }}
                                title='Edit customer'
                              >
                                Edit
                              </button>
                              <button
                                type='button'
                                className='customers-action-secondary'
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openMergeCustomers(customer.id);
                                }}
                                title='Merge this customer with a duplicate record'
                              >
                                Merge duplicate…
                              </button>
                              {customer.isArchived === 1 && (
                                <button
                                  type='button'
                                  className='customers-action-danger'
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setNotice(null);
                                    setCustomerDeleteTarget(customer);
                                  }}
                                  title='Permanently delete archived customer'
                                >
                                  Delete permanently
                                </button>
                              )}
                              <button
                                type='button'
                                className={
                                  customer.isArchived === 1
                                    ? 'customers-action-secondary'
                                    : 'customers-action-danger'
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setNotice(null);
                                  setCustomerArchiveTarget(customer);
                                }}
                                title={
                                  customer.isArchived === 1
                                    ? 'Restore customer'
                                    : 'Archive customer'
                                }
                              >
                                {customer.isArchived === 1
                                  ? 'Unarchive'
                                  : 'Archive'}
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {customerDeleteTarget && (
        <div
          className='customer-modal-backdrop'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isDeletingCustomer) {
              setCustomerDeleteTarget(null);
            }
          }}
        >
          <section
            className='customer-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='customer-delete-title'
          >
            <header className='customer-modal-header'>
              <div>
                <span className='customer-eyebrow'>CUSTOMER DIRECTORY</span>
                <h2 id='customer-delete-title'>Permanently delete customer?</h2>
                <p>
                  This cannot be undone. The app will block deletion if this
                  customer has linked records or historical activity.
                </p>
              </div>
              <button
                type='button'
                className='customer-modal-close'
                aria-label='Close dialog'
                disabled={isDeletingCustomer}
                onClick={() => setCustomerDeleteTarget(null)}
              >
                ×
              </button>
            </header>
            <div className='customer-modal-body'>
              <strong>{customerDeleteTarget.businessName}</strong>
              <p>
                Only archived customers can be permanently deleted. If this
                customer has selections, orders, payments, or other linked
                records, deletion will be refused and the customer will remain
                archived.
              </p>
            </div>
            <footer className='customer-modal-footer'>
              <span className='customer-footer-hint'>
                Consider keeping the customer archived to preserve its record.
              </span>
              <div>
                <button
                  type='button'
                  className='customer-secondary-button'
                  disabled={isDeletingCustomer}
                  onClick={() => setCustomerDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className='customers-action-danger'
                  disabled={isDeletingCustomer}
                  onClick={() => void handleDeleteArchivedCustomer()}
                >
                  {isDeletingCustomer ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {mergeKeepId !== null && (
        <div
          className='customer-modal-backdrop merge-modal-backdrop'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMergeCustomers();
          }}
        >
          <section
            className='customer-modal merge-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='merge-customer-title'
          >
            <header className='customer-modal-header merge-modal-heading'>
              <div>
                <div
                  className='merge-steps'
                  aria-label={`Step ${mergeStep} of 3`}
                >
                  <span className={mergeStep >= 1 ? 'is-current' : ''}>
                    1 Choose duplicate
                  </span>
                  <b>›</b>
                  <span className={mergeStep >= 2 ? 'is-current' : ''}>
                    2 Review
                  </span>
                  <b>›</b>
                  <span className={mergeStep >= 3 ? 'is-current' : ''}>
                    3 Confirm
                  </span>
                </div>
                <h2 id='merge-customer-title'>
                  {mergeStep === 1
                    ? 'Choose customers to merge'
                    : mergeStep === 2
                      ? `Merge ${mergeCustomerOptions.find((c) => c.id === mergeDuplicateId)?.businessName || 'duplicate'} into ${mergeCustomerOptions.find((c) => c.id === mergeKeepId)?.businessName || 'customer'}`
                      : 'Confirm customer merge'}
                </h2>
                <p>
                  {mergeStep === 1
                    ? 'Choose the customer record to keep and the duplicate record to absorb.'
                    : mergeStep === 2
                      ? 'For each field that differs, choose which value to keep.'
                      : 'Review the impact before permanently merging these customer records.'}
                </p>
              </div>
              <button
                type='button'
                className='customer-modal-close'
                aria-label='Close dialog'
                disabled={isMergingCustomers}
                onClick={closeMergeCustomers}
              >
                ×
              </button>
            </header>
            <div className='customer-modal-body merge-modal-body'>
              {mergeStep === 1 && (
                <div className='merge-pick-grid'>
                  <label className='customer-field'>
                    <span>KEEP CUSTOMER</span>
                    <MergeCustomerSelect
                      options={mergeCustomerOptions.filter(
                        (c) => c.id !== mergeDuplicateId,
                      )}
                      value={mergeKeepId}
                      ariaLabel='Keep customer'
                      onChange={(next) => {
                        setMergeKeepId(next);
                        if (next === mergeDuplicateId)
                          setMergeDuplicateId(null);
                      }}
                    />
                  </label>
                  <label className='customer-field'>
                    <span>DUPLICATE CUSTOMER</span>
                    <MergeCustomerSelect
                      options={mergeCustomerOptions.filter(
                        (c) => c.id !== mergeKeepId,
                      )}
                      value={mergeDuplicateId}
                      placeholder='Choose duplicate…'
                      ariaLabel='Duplicate customer'
                      onChange={setMergeDuplicateId}
                    />
                  </label>
                  <p className='merge-help'>
                    The duplicate record will be removed after its contacts,
                    selections, orders and payments are transferred.
                  </p>
                </div>
              )}
              {mergeStep === 2 &&
                (() => {
                  const keep = mergeCustomerOptions.find(
                    (c) => c.id === mergeKeepId,
                  );
                  const duplicate = mergeCustomerOptions.find(
                    (c) => c.id === mergeDuplicateId,
                  );
                  if (!keep || !duplicate)
                    return <p>Choose both customers to continue.</p>;
                  const fields: { key: MergeField; label: string }[] = [
                    { key: 'businessName', label: 'NAME' },
                    { key: 'email', label: 'EMAIL' },
                    { key: 'city', label: 'CITY' },
                    { key: 'address', label: 'ADDRESS' },
                    { key: 'notes', label: 'NOTES' },
                  ];
                  const display = (v: string | null | undefined) =>
                    v?.trim() || '— (empty)';
                  return (
                    <>
                      <div className='merge-comparison-head'>
                        <span></span>
                        <span>KEEP ({keep.businessName})</span>
                        <span>DUPLICATE ({duplicate.businessName})</span>
                      </div>
                      {fields.map((field) => (
                        <div className='merge-comparison-row' key={field.key}>
                          <strong>{field.label}</strong>
                          <label
                            className={`merge-value-choice ${mergeChoices[field.key] === 'keep' ? 'is-selected' : ''}`}
                          >
                            <input
                              type='radio'
                              name={`merge-${field.key}`}
                              checked={mergeChoices[field.key] === 'keep'}
                              onChange={() =>
                                setMergeChoices((current) => ({
                                  ...current,
                                  [field.key]: 'keep',
                                }))
                              }
                            />
                            <span>{display(keep[field.key])}</span>
                          </label>
                          <label
                            className={`merge-value-choice ${mergeChoices[field.key] === 'duplicate' ? 'is-selected' : ''}`}
                          >
                            <input
                              type='radio'
                              name={`merge-${field.key}`}
                              checked={mergeChoices[field.key] === 'duplicate'}
                              onChange={() =>
                                setMergeChoices((current) => ({
                                  ...current,
                                  [field.key]: 'duplicate',
                                }))
                              }
                            />
                            <span>{display(duplicate[field.key])}</span>
                          </label>
                        </div>
                      ))}
                      <div className='merge-warning'>
                        <strong>What will happen:</strong> Contacts and linked
                        history from {duplicate.businessName} will move to{' '}
                        {keep.businessName}. Historical order snapshots remain
                        unchanged. This action cannot be undone.
                      </div>
                    </>
                  );
                })()}
              {mergeStep === 3 &&
                (() => {
                  const keep = mergeCustomerOptions.find(
                    (c) => c.id === mergeKeepId,
                  );
                  const duplicate = mergeCustomerOptions.find(
                    (c) => c.id === mergeDuplicateId,
                  );
                  if (!keep || !duplicate) return null;
                  return (
                    <div className='merge-confirm-summary'>
                      <div className='merge-summary-pair'>
                        <div>
                          <small>KEEP CUSTOMER</small>
                          <strong>
                            {mergeChoices.businessName === 'keep'
                              ? keep.businessName
                              : duplicate.businessName}
                          </strong>
                          <span>
                            {mergeChoices.email === 'keep'
                              ? keep.email || 'No email'
                              : duplicate.email || 'No email'}
                          </span>
                          <span>
                            {mergeChoices.city === 'keep'
                              ? keep.city || 'No city'
                              : duplicate.city || 'No city'}
                          </span>
                        </div>
                        <svg
                          width='20'
                          height='20'
                          viewBox='0 0 24 24'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='1.8'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          aria-hidden='true'
                        >
                          <path d='M5 12h14' />
                          <path d='m12 5 7 7-7 7' />
                        </svg>
                        <div>
                          <small>REMOVE DUPLICATE</small>
                          <strong>{duplicate.businessName}</strong>
                          <span>Its linked records will be transferred.</span>
                        </div>
                      </div>
                      <div className='merge-warning'>
                        <strong>Cannot be undone.</strong> Contacts, selections,
                        orders and payments will be transferred. If both records
                        have a selection in the same exhibition, the selections
                        will be consolidated and duplicate active items marked
                        removed.
                      </div>
                    </div>
                  );
                })()}
            </div>
            <footer className='customer-modal-footer merge-modal-footer'>
              <span className='customer-footer-hint'>
                {mergeStep === 1
                  ? 'Both customers must be different active records.'
                  : mergeStep === 2
                    ? 'All contacts and linked history are preserved.'
                    : 'The merge is applied as one database transaction.'}
              </span>
              <div className='merge-footer-actions'>
                <button
                  type='button'
                  className='customer-secondary-button'
                  disabled={isMergingCustomers}
                  onClick={() =>
                    mergeStep === 1
                      ? closeMergeCustomers()
                      : setMergeStep((mergeStep - 1) as 1 | 2)
                  }
                >
                  {mergeStep === 1 ? 'Cancel' : 'Back'}
                </button>
                {mergeStep < 3 ? (
                  <button
                    type='button'
                    className='customer-primary-button'
                    disabled={
                      mergeStep === 1
                        ? mergeDuplicateId === null ||
                          mergeDuplicateId === mergeKeepId
                        : false
                    }
                    onClick={() => setMergeStep((mergeStep + 1) as 2 | 3)}
                  >
                    {mergeStep === 1 ? 'Review merge' : 'Continue to confirm'}
                  </button>
                ) : (
                  <button
                    type='button'
                    className='merge-confirm-button'
                    disabled={isMergingCustomers}
                    onClick={() => void handleMergeCustomers()}
                  >
                    {isMergingCustomers ? 'Merging…' : 'Merge customers'}
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}

      {customerArchiveTarget && (
        <div
          className='customer-modal-backdrop'
          onMouseDown={(event) => {
            if (
              event.target === event.currentTarget &&
              !isUpdatingArchiveStatus
            ) {
              setCustomerArchiveTarget(null);
            }
          }}
        >
          <section
            className='customer-modal'
            role='dialog'
            aria-modal='true'
            aria-labelledby='customer-archive-title'
          >
            <header className='customer-modal-header'>
              <div>
                <span className='customer-eyebrow'>CUSTOMER DIRECTORY</span>
                <h2 id='customer-archive-title'>
                  {customerArchiveTarget.isArchived === 1
                    ? 'Unarchive customer?'
                    : 'Archive customer?'}
                </h2>
                <p>
                  {customerArchiveTarget.isArchived === 1
                    ? 'This customer will become active again.'
                    : 'This customer will be hidden from the Active list. Their details and history will be preserved.'}
                </p>
              </div>
              <button
                type='button'
                className='customer-modal-close'
                aria-label='Close dialog'
                disabled={isUpdatingArchiveStatus}
                onClick={() => setCustomerArchiveTarget(null)}
              >
                ×
              </button>
            </header>
            <div className='customer-modal-body'>
              <strong>{customerArchiveTarget.businessName}</strong>
            </div>
            <footer className='customer-modal-footer'>
              <span className='customer-footer-hint'>
                {customerArchiveTarget.isArchived === 1
                  ? 'You can archive this customer again later.'
                  : 'No customer data or history will be deleted.'}
              </span>
              <div>
                <button
                  type='button'
                  className='customer-secondary-button'
                  disabled={isUpdatingArchiveStatus}
                  onClick={() => setCustomerArchiveTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  className={
                    customerArchiveTarget.isArchived === 1
                      ? 'customer-primary-button'
                      : 'customers-action-danger'
                  }
                  disabled={isUpdatingArchiveStatus}
                  onClick={() => void handleSetCustomerArchived()}
                >
                  {isUpdatingArchiveStatus
                    ? 'Saving…'
                    : customerArchiveTarget.isArchived === 1
                      ? 'Unarchive customer'
                      : 'Archive customer'}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      {isAddModalOpen && (
        <AddCustomerModalRedesigned
          onClose={() => setIsAddModalOpen(false)}
          onSave={handleSaveCustomer}
        />
      )}

      {editingCustomerId !== null &&
        (() => {
          const customerToEdit = customers.find(
            (customer) => customer.id === editingCustomerId,
          );
          const contactsToEdit = contactsByCustomer[editingCustomerId];

          if (!customerToEdit || !contactsToEdit) {
            return (
              <div className='customer-modal-backdrop'>
                <section
                  className='customer-modal'
                  role='dialog'
                  aria-modal='true'
                  aria-labelledby='edit-customer-loading-title'
                >
                  <header className='customer-modal-header'>
                    <div>
                      <h2 id='edit-customer-loading-title'>Edit customer</h2>
                      <p>Loading customer details…</p>
                    </div>
                    <button
                      type='button'
                      className='customer-modal-close'
                      aria-label='Close dialog'
                      onClick={() => setEditingCustomerId(null)}
                    >
                      ×
                    </button>
                  </header>
                  <div className='customer-modal-body'>Loading contacts…</div>
                </section>
              </div>
            );
          }

          return (
            <EditCustomerModal
              key={customerToEdit.id}
              customer={customerToEdit}
              initialContacts={contactsToEdit}
              onClose={() => setEditingCustomerId(null)}
              onSave={handleUpdateCustomer}
            />
          );
        })()}
    </section>
  );
}
