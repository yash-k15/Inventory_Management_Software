import { useEffect, useMemo, useState } from 'react';
import {
  createConfirmedOrder,
  getCreateOrderCustomers,
  getCreateOrderExhibitions,
  searchCreateOrderInventory,
  type CreateOrderCustomer,
  type CreateOrderExhibition,
  type CreateOrderInventoryItem,
} from './createOrder.queries';
import './CreateOrderModal.css';

interface Props {
  onClose: () => void;
  onCreated: (orderId: number) => void;
}

interface SelectedItem {
  item: CreateOrderInventoryItem;
  price: string;
}

const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(paise: number) {
  return money.format(paise / 100);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const details = error as { message?: unknown; code?: unknown };
    if (typeof details.message === 'string' && details.message.trim()) {
      return details.message;
    }
    if (typeof details.code === 'string' && details.code.trim()) {
      return details.code;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      // Use the fallback if the thrown value cannot be serialized.
    }
  }

  return fallback;
}

function formatWeight(milli: number | null) {
  return milli === null ? '—' : `${(milli / 1000).toFixed(3)} g`;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function CreateOrderModal({ onClose, onCreated }: Props) {
  const [customers, setCustomers] = useState<CreateOrderCustomer[]>([]);
  const [exhibitions, setExhibitions] = useState<CreateOrderExhibition[]>([]);
  const [inventory, setInventory] = useState<CreateOrderInventoryItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedExhibitionId, setSelectedExhibitionId] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhibitionDropdownOpen, setExhibitionDropdownOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      setLoading(true);
      try {
        const [nextCustomers, nextExhibitions, nextInventory] =
          await Promise.all([
            getCreateOrderCustomers(),
            getCreateOrderExhibitions(),
            searchCreateOrderInventory(''),
          ]);

        if (cancelled) return;

        setCustomers(nextCustomers);
        setExhibitions(nextExhibitions);
        setInventory(nextInventory);
      } catch (err) {
        console.error('Failed to load order options:', err);
        if (!cancelled) {
          setError(getErrorMessage(err, 'Could not load order options.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === selectedCustomerId,
  );

  const filteredCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();

    if (!term) return customers;

    return customers.filter((customer) =>
      [
        customer.businessName,
        customer.contactName,
        customer.phone,
        customer.city,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [customers, customerSearch]);

  const totalPaise = selectedItems.reduce(
    (total, selected) => total + Math.round(Number(selected.price || 0) * 100),
    0,
  );

  async function searchInventory(value: string) {
    setInventorySearch(value);
    try {
      setInventory(await searchCreateOrderInventory(value));
    } catch (err) {
      console.error('Failed to search order inventory:', err);
      setError(getErrorMessage(err, 'Could not search inventory.'));
    }
  }

  function addItem(item: CreateOrderInventoryItem) {
    if (
      item.isArchived ||
      item.existingOrderNumber ||
      selectedItems.some((selected) => selected.item.id === item.id)
    ) {
      return;
    }

    setSelectedItems((current) => [...current, { item, price: '' }]);
    setError(null);
  }

  function updatePrice(itemId: number, price: string) {
    if (price !== '' && (!/^\d*\.?\d{0,2}$/.test(price) || Number(price) < 0)) {
      return;
    }

    setSelectedItems((current) =>
      current.map((selected) =>
        selected.item.id === itemId ? { ...selected, price } : selected,
      ),
    );
  }

  function continueToNextStep() {
    setError(null);
    if (step === 1 && !selectedCustomerId) {
      setError('Select a customer before continuing.');
      return;
    }
    if (step === 2 && !selectedItems.length) {
      setError('Add at least one jewelry item before continuing.');
      return;
    }
    setStep((current) => (current < 3 ? (current + 1) as 1 | 2 | 3 : current));
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step !== 3) {
      continueToNextStep();
      return;
    }
    setError(null);

    if (!selectedCustomerId) {
      setError('Select a customer before creating the order.');
      return;
    }

    if (!selectedItems.length) {
      setError('Add at least one jewelry item.');
      return;
    }

    if (
      selectedItems.some(
        (selected) =>
          selected.price.trim() === '' ||
          !Number.isFinite(Number(selected.price)),
      )
    ) {
      setError('Enter the final selling price for every selected item.');
      return;
    }

    setSaving(true);

    try {
      const orderId = await createConfirmedOrder({
        customerId: Number(selectedCustomerId),
        exhibitionId: selectedExhibitionId
          ? Number(selectedExhibitionId)
          : null,
        notes,
        items: selectedItems.map((selected) => ({
          inventoryItemId: selected.item.id,
          agreedPricePaise: Math.round(Number(selected.price) * 100),
        })),
      });

      onCreated(orderId);
    } catch (err) {
      console.error('Failed to create order:', err);
      setError(getErrorMessage(err, 'Could not create the order.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className='create-order-overlay'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className='create-order-modal'
        onSubmit={submitOrder}
        aria-labelledby='create-order-title'
      >
        <header className='create-order-header'>
          <div>
            <h2 id='create-order-title'>Create order</h2>
            <p>{step === 1 ? 'Choose the customer and exhibition.' : step === 2 ? 'Add the jewelry pieces for this order.' : 'Review prices and confirm the order.'}</p>
          </div>
          <button
            type='button'
            className='create-order-close'
            aria-label='Close create order'
            onClick={onClose}
            disabled={saving}
          >
            ×
          </button>
        </header>

        <div className='create-order-progress' aria-label={`Step ${step} of 3`}>
          {[{ number: 1, label: 'Customer & exhibition' }, { number: 2, label: 'Select jewelry' }, { number: 3, label: 'Review & confirm' }].map((item) => (
            <div key={item.number} className={`create-order-progress-step ${step === item.number ? 'is-current' : step > item.number ? 'is-complete' : ''}`}>
              <span>{step > item.number ? '✓' : item.number}</span><strong>{item.label}</strong>
            </div>
          ))}
        </div>

        <div className='create-order-body'>
          <div className='create-order-main'>
            {step === 1 && <>
            <section className='create-order-section'>
              <h3>1 · Customer</h3>

              {selectedCustomer ? (
                <div className='create-order-customer-card'>
                  <span className='create-order-avatar'>
                    {getInitials(selectedCustomer.businessName)}
                  </span>
                  <div className='create-order-customer-info'>
                    <strong>{selectedCustomer.businessName}</strong>
                    <span>
                      {[
                        selectedCustomer.contactName,
                        selectedCustomer.phone,
                        selectedCustomer.city,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <button
                    type='button'
                    className='create-order-text-button'
                    onClick={() => setShowCustomerPicker(true)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <button
                  type='button'
                  className='create-order-customer-placeholder'
                  onClick={() => setShowCustomerPicker(true)}
                >
                  Choose a customer <span>›</span>
                </button>
              )}

              <p className='create-order-helper'>
                Not listed? Customer creation will be available from Customers.
              </p>

              {showCustomerPicker && (
                <div className='create-order-picker'>
                  <input
                    autoFocus
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder='Search business, contact, or phone...'
                    aria-label='Search customers'
                  />
                  <div className='create-order-picker-list'>
                    {filteredCustomers.map((customer) => (
                      <button
                        type='button'
                        key={customer.id}
                        onClick={() => {
                          setSelectedCustomerId(String(customer.id));
                          setShowCustomerPicker(false);
                          setCustomerSearch('');
                        }}
                      >
                        <strong>{customer.businessName}</strong>
                        <span>
                          {[customer.contactName, customer.phone, customer.city]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    ))}
                    {!filteredCustomers.length && <p>No matching customers.</p>}
                  </div>
                  <button
                    type='button'
                    className='create-order-text-button'
                    onClick={() => setShowCustomerPicker(false)}
                  >
                    Close customer list
                  </button>
                </div>
              )}
            </section>

            <section className='create-order-section'>
              <h3>
                2 · Exhibition <span>(optional)</span>
              </h3>

              <div className='create-order-exhibition-select'>
                <button
                  type='button'
                  className='create-order-exhibition-trigger'
                  aria-haspopup='listbox'
                  aria-expanded={exhibitionDropdownOpen}
                  onClick={() => setExhibitionDropdownOpen((open) => !open)}
                >
                  <span>
                    {selectedExhibitionId
                      ? (exhibitions.find(
                          (exhibition) =>
                            String(exhibition.id) === selectedExhibitionId,
                        )?.name ?? 'Select exhibition')
                      : 'No exhibition · direct order'}
                  </span>
                  <span className='create-order-exhibition-chevron'>⌄</span>
                </button>

                {exhibitionDropdownOpen && (
                  <>
                    <button
                      type='button'
                      className='create-order-dropdown-dismiss'
                      aria-label='Close exhibition menu'
                      onClick={() => setExhibitionDropdownOpen(false)}
                    />
                    <div
                      className='create-order-exhibition-menu'
                      role='listbox'
                    >
                      <button
                        type='button'
                        role='option'
                        aria-selected={!selectedExhibitionId}
                        className={`create-order-exhibition-option ${
                          !selectedExhibitionId ? 'is-selected' : ''
                        }`}
                        onClick={() => {
                          setSelectedExhibitionId('');
                          setExhibitionDropdownOpen(false);
                        }}
                      >
                        <span>No exhibition · direct order</span>
                        {!selectedExhibitionId && <span>✓</span>}
                      </button>

                      {exhibitions.map((exhibition) => {
                        const selected =
                          String(exhibition.id) === selectedExhibitionId;

                        return (
                          <button
                            type='button'
                            role='option'
                            aria-selected={selected}
                            key={exhibition.id}
                            className={`create-order-exhibition-option ${
                              selected ? 'is-selected' : ''
                            }`}
                            onClick={() => {
                              setSelectedExhibitionId(String(exhibition.id));
                              setExhibitionDropdownOpen(false);
                            }}
                          >
                            <span>
                              {exhibition.name}
                              <small>{exhibition.startDate}</small>
                            </span>
                            {selected && <span>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <p className='create-order-helper'>
                Orders can exist without an exhibition. Choose one only if this
                order belongs to it.
              </p>
            </section>

            </> }

            {step === 2 && <section className='create-order-section create-order-jewelry-section'>
              <h3>2 · Jewelry items</h3>

              <div className='create-order-inventory-search'>
                <span aria-hidden='true'>▥</span>
                <input
                  value={inventorySearch}
                  onChange={(event) => void searchInventory(event.target.value)}
                  placeholder='Scan barcode or search item number...'
                  aria-label='Search inventory by barcode or item number'
                />
              </div>

              <div className='create-order-inventory-list'>
                {loading && (
                  <p className='create-order-empty'>Loading inventory…</p>
                )}

                {!loading &&
                  inventory.map((item) => {
                    const alreadySelected = selectedItems.some(
                      (selected) => selected.item.id === item.id,
                    );
                    const disabled =
                      Boolean(item.isArchived) ||
                      Boolean(item.existingOrderNumber) ||
                      alreadySelected;

                    let badge = 'Add';
                    if (item.isArchived) badge = 'Archived';
                    else if (item.existingOrderNumber) {
                      badge = `In ${item.existingOrderNumber}`;
                    } else if (alreadySelected) badge = 'Already added';

                    return (
                      <div
                        key={item.id}
                        className={`create-order-inventory-row ${
                          disabled ? 'is-disabled' : ''
                        }`}
                      >
                        <span className='create-order-item-icon'>◇</span>
                        <div className='create-order-inventory-name'>
                          <strong>{item.itemNumber}</strong>
                          <span>{item.categoryName}</span>
                        </div>
                        <span className='create-order-inventory-details'>
                          {item.diamondDetails || '—'}
                        </span>
                        <button
                          type='button'
                          disabled={disabled}
                          className={
                            disabled
                              ? 'create-order-item-badge'
                              : 'create-order-add-button'
                          }
                          onClick={() => addItem(item)}
                        >
                          {badge}
                        </button>
                      </div>
                    );
                  })}

                {!loading && !inventory.length && (
                  <p className='create-order-empty'>
                    No inventory items match this search.
                  </p>
                )}
              </div>

              <p className='create-order-helper'>
                Only available, non-archived items can be added. You will enter final prices in the next step.
              </p>

              <div className='create-order-selected-table'>
                <div className='create-order-selected-heading'>
                  <span>Selected item</span>
                  <span>Gross wt.</span>
                  <span>Price at review</span>
                  <span />
                </div>

                {selectedItems.map(({ item, price }) => (
                  <div className='create-order-selected-row' key={item.id}>
                    <div className='create-order-selected-name'>
                      <strong>{item.itemNumber}</strong>
                      <span>{item.categoryName}</span>
                    </div>
                    <span>{formatWeight(item.grossWeightMilli)}</span>
                    <span className='create-order-price-pending'>{price ? formatMoney(Math.round(Number(price) * 100)) : 'Enter next step'}</span>
                    <button
                      type='button'
                      className='create-order-remove-item'
                      aria-label={`Remove ${item.itemNumber}`}
                      onClick={() =>
                        setSelectedItems((current) =>
                          current.filter(
                            (selected) => selected.item.id !== item.id,
                          ),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}

                {!selectedItems.length && (
                  <p className='create-order-empty'>No items selected yet.</p>
                )}
              </div>
            </section>}

            {step === 3 && <section className='create-order-section create-order-review-section'>
              <h3>3 · Review order</h3>
              <div className='create-order-review-customer'><span>Customer</span><strong>{selectedCustomer?.businessName || 'Not selected'}</strong></div>
              <div className='create-order-review-customer'><span>Exhibition</span><strong>{selectedExhibitionId ? exhibitions.find((exhibition) => String(exhibition.id) === selectedExhibitionId)?.name || 'Selected exhibition' : 'Direct order'}</strong></div>
              <div className='create-order-review-items'>
                <div className='create-order-review-heading'><span>Jewelry item</span><span>Gross wt.</span><span>Final price (₹)</span><span /></div>
                {selectedItems.map(({ item, price }) => <div className='create-order-review-row' key={item.id}>
                  <div><strong>{item.itemNumber}</strong><small>{item.categoryName}</small></div>
                  <span>{formatWeight(item.grossWeightMilli)}</span>
                  <input inputMode='decimal' value={price} onChange={(event) => updatePrice(item.id, event.target.value)} placeholder='0.00' aria-label={`Final selling price for ${item.itemNumber}`} required />
                  <button type='button' className='create-order-remove-item' aria-label={`Remove ${item.itemNumber}`} onClick={() => setSelectedItems((current) => current.filter((selected) => selected.item.id !== item.id))}>×</button>
                </div>)}
              </div>
              <div className='create-order-review-total'><span>Order value</span><strong>{formatMoney(totalPaise)}</strong></div>
              <label className='create-order-notes-label' htmlFor='create-order-notes'>Notes (optional)</label>
              <textarea id='create-order-notes' value={notes} onChange={(event) => setNotes(event.target.value)} placeholder='Delivery or setting instructions...' rows={3} />
            </section>}
          </div>


        </div>

        {error && (
          <div className='create-order-error' role='alert'>
            {error}
          </div>
        )}

        <footer className='create-order-footer'>
          <span>{step === 1 ? 'Start by selecting a customer.' : step === 2 ? `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} selected` : `${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} · ${formatMoney(totalPaise)}`}</span>
          <div>
            <button type='button' className='create-order-cancel-button' onClick={step === 1 ? onClose : () => { setError(null); setStep((current) => (current - 1) as 1 | 2 | 3); }} disabled={saving}>
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 3 ? (
              <button type='button' className='create-order-submit-button' onClick={continueToNextStep} disabled={saving || loading}>
                Continue <span aria-hidden='true'>→</span>
              </button>
            ) : (
              <button type='submit' className='create-order-submit-button' disabled={saving || loading}>
                {saving ? 'Creating…' : 'Create confirmed order'}
              </button>
            )}
          </div>
        </footer>
      </form>
    </div>
  );
}
