import { useState } from 'react';
import './AddCustomerModal.css';

export interface CustomerContactInput {
  name: string;
  phone1: string;
  phone2: string;
  notes: string;
  isPrimary: boolean;
}

export interface NewCustomerInput {
  businessName: string;
  email: string;
  city: string;
  address: string;
  notes: string;
  contacts: CustomerContactInput[];
}

interface AddCustomerModalRedesignedProps {
  onClose: () => void;
  onSave: (customer: NewCustomerInput) => Promise<void>;
}

function emptyContact(isPrimary = false): CustomerContactInput {
  return { name: '', phone1: '', phone2: '', notes: '', isPrimary };
}

export default function AddCustomerModalRedesigned({
  onClose,
  onSave,
}: AddCustomerModalRedesignedProps) {
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<CustomerContactInput[]>([
    emptyContact(true),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateContact(
    index: number,
    field: keyof CustomerContactInput,
    value: string | boolean,
  ) {
    setContacts((current) =>
      current.map((contact, i) =>
        i === index ? { ...contact, [field]: value } : contact,
      ),
    );
  }

  function setPrimary(index: number) {
    setContacts((current) =>
      current.map((contact, i) => ({ ...contact, isPrimary: i === index })),
    );
  }

  function removeContact(index: number) {
    setContacts((current) => {
      const next = current.filter((_, i) => i !== index);
      if (next.length && !next.some((contact) => contact.isPrimary)) {
        next[0] = { ...next[0], isPrimary: true };
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedName = businessName.trim();
    const normalizedContacts = contacts.map((contact) => ({
      ...contact,
      name: contact.name.trim(),
      phone1: contact.phone1.trim(),
      phone2: contact.phone2.trim(),
      notes: contact.notes.trim(),
    }));

    if (!normalizedName) {
      setError('Business name is required.');
      return;
    }
    if (
      !normalizedContacts.length ||
      normalizedContacts.some((contact) => !contact.name)
    ) {
      setError('Add at least one contact and enter a name for every contact.');
      return;
    }
    if (
      normalizedContacts.filter((contact) => contact.isPrimary).length !== 1
    ) {
      setError('Select exactly one primary contact.');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        businessName: normalizedName,
        email: email.trim(),
        city: city.trim(),
        address: address.trim(),
        notes: notes.trim(),
        contacts: normalizedContacts,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to save the customer. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className='customer-modal-backdrop'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className='customer-modal'
        role='dialog'
        aria-modal='true'
        aria-labelledby='customer-modal-title'
      >
        <header className='customer-modal-header'>
          <div>
            <span className='customer-eyebrow'>CUSTOMER DIRECTORY</span>
            <h2 id='customer-modal-title'>Add customer</h2>
            <p>Save a business and the people you work with.</p>
          </div>
          <button
            type='button'
            className='customer-modal-close'
            aria-label='Close dialog'
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form className='customer-modal-form' onSubmit={submit}>
          <div className='customer-modal-body'>
            {error && (
              <div className='customer-form-error' role='alert'>
                <span>{error}</span>
                <button
                  type='button'
                  aria-label='Dismiss error'
                  onClick={() => setError(null)}
                >
                  ×
                </button>
              </div>
            )}

            <section className='customer-form-section'>
              <div className='customer-form-section-title'>
                <span className='customer-section-number'>01</span>
                <div>
                  <h3>Business details</h3>
                  <p>General information for this customer.</p>
                </div>
              </div>
              <div className='customer-form-grid'>
                <label className='customer-field customer-field-wide'>
                  <span className='customer-field-label'>
                    Business name <span className='required-mark'>*</span>
                  </span>
                  <input
                    autoFocus
                    required
                    maxLength={200}
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    placeholder='e.g. ABC Jewellers'
                  />
                </label>
                <label className='customer-field'>
                  Business email
                  <input
                    type='email'
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder='business@example.com'
                  />
                </label>
                <label className='customer-field'>
                  City
                  <input
                    maxLength={100}
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder='e.g. Mumbai'
                  />
                </label>
                <label className='customer-field customer-field-wide'>
                  Address
                  <textarea
                    rows={2}
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder='Street, area, PIN (optional)'
                  />
                </label>
                <label className='customer-field customer-field-wide'>
                  Business notes
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder='Preferences, business details or other notes…'
                  />
                </label>
              </div>
            </section>

            <section className='customer-form-section'>
              <div className='customer-form-section-title customer-contacts-title'>
                <span className='customer-section-number'>02</span>
                <div>
                  <h3>Contact people</h3>
                  <p>Add at least one contact and choose a primary contact.</p>
                </div>
                <button
                  type='button'
                  className='customer-secondary-button'
                  onClick={() =>
                    setContacts((current) => [...current, emptyContact()])
                  }
                >
                  + Add contact
                </button>
              </div>

              <div className='customer-contact-forms'>
                {contacts.map((contact, index) => (
                  <article className='customer-contact-form-card' key={index}>
                    <div className='customer-contact-form-heading'>
                      <div className='customer-contact-index'>
                        {String(index + 1).padStart(2, '0')}
                      </div>
                      <strong>Contact {index + 1}</strong>
                      {contact.isPrimary && (
                        <span className='customer-primary-pill'>Primary</span>
                      )}
                      {contacts.length > 1 && (
                        <button
                          type='button'
                          className='customer-remove-contact'
                          onClick={() => removeContact(index)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className='customer-form-grid'>
                      <label className='customer-field customer-field-wide'>
                        <span className='customer-field-label'>
                          Contact name <span className='required-mark'>*</span>
                        </span>
                        <input
                          required
                          maxLength={150}
                          value={contact.name}
                          onChange={(event) =>
                            updateContact(index, 'name', event.target.value)
                          }
                          placeholder='Full name'
                        />
                      </label>
                      <label className='customer-field'>
                        Phone 1
                        <input
                          type='tel'
                          maxLength={30}
                          value={contact.phone1}
                          onChange={(event) =>
                            updateContact(index, 'phone1', event.target.value)
                          }
                          placeholder='Phone number'
                        />
                      </label>
                      <label className='customer-field'>
                        Phone 2
                        <input
                          type='tel'
                          maxLength={30}
                          value={contact.phone2}
                          onChange={(event) =>
                            updateContact(index, 'phone2', event.target.value)
                          }
                          placeholder='Alternate number'
                        />
                      </label>
                      <label className='customer-field customer-field-wide'>
                        Contact notes
                        <textarea
                          rows={2}
                          value={contact.notes}
                          onChange={(event) =>
                            updateContact(index, 'notes', event.target.value)
                          }
                          placeholder='Optional notes about this contact'
                        />
                      </label>
                    </div>
                    <label className='customer-primary-choice'>
                      <input
                        type='radio'
                        name='customer-primary-contact'
                        checked={contact.isPrimary}
                        onChange={() => setPrimary(index)}
                      />
                      <span>Set as primary contact</span>
                    </label>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <footer className='customer-modal-footer'>
            <span className='customer-footer-hint'>
              <span className='required-mark'>*</span> Required field
            </span>
            <div>
              <button
                type='button'
                className='customer-secondary-button'
                disabled={saving}
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type='submit'
                className='customer-primary-button'
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save customer'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
