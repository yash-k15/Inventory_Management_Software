import { useCallback, useEffect, useState } from 'react';
import {
  getCustomerDetailsSummary,
  getCustomerOrderHistory,
  getCustomerPaymentHistory,
  getCustomerContacts,
  getCustomers,
} from './customer.queries';
import type {
  Customer,
  CustomerContact,
  CustomerDetailsSummary,
  CustomerOrderHistoryRow,
  CustomerPaymentHistoryRow,
} from './customer.types';
import './CustomerDetailsScreen.css';

type Props = {
  customerId: number;
  onBack: () => void;
};

type HistoryTab = 'orders' | 'payments';

type HistoryPaginationProps = {
  totalItems: number;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

function HistoryPagination({
  totalItems,
  currentPage,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: HistoryPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const firstItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className='customer-details-pagination'>
      <span className='customer-details-pagination-range'>
        Showing {firstItem}–{lastItem} of {totalItems}
      </span>
      <div className='customer-details-pagination-controls'>
        <label className='customer-details-page-size'>
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label='Rows per page'
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <button type='button' onClick={() => onPageChange(1)} disabled={currentPage === 1} aria-label='First page'>«</button>
        <button type='button' onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1} aria-label='Previous page'>‹</button>
        <span className='customer-details-pagination-page'>Page {currentPage} of {totalPages}</span>
        <button type='button' onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} aria-label='Next page'>›</button>
        <button type='button' onClick={() => onPageChange(totalPages)} disabled={currentPage >= totalPages} aria-label='Last page'>»</button>
      </div>
    </div>
  );
}


const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

function formatMoneyPaise(value: number) {
  return currency.format((Number(value) || 0) / 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed);
}

function formatText(value: string | null | undefined) {
  return value?.trim() || '—';
}

export default function CustomerDetailsScreen({
  customerId,
  onBack,
}: Props) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [summary, setSummary] = useState<CustomerDetailsSummary | null>(null);
  const [orders, setOrders] = useState<CustomerOrderHistoryRow[]>([]);
  const [payments, setPayments] = useState<CustomerPaymentHistoryRow[]>([]);
  const [activeTab, setActiveTab] = useState<HistoryTab>('orders');
  const [pageSize, setPageSize] = useState(25);
  const [ordersPage, setOrdersPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allCustomers, customerContacts, customerSummary, orderHistory, paymentHistory] =
        await Promise.all([
          getCustomers({ search: '', archiveStatus: 'all' }),
          getCustomerContacts(customerId),
          getCustomerDetailsSummary(customerId),
          getCustomerOrderHistory(customerId),
          getCustomerPaymentHistory(customerId),
        ]);

      const foundCustomer = allCustomers.find((item) => item.id === customerId);
      if (!foundCustomer) {
        setCustomer(null);
        setError('This customer could not be found.');
        return;
      }

      setCustomer(foundCustomer);
      setContacts(customerContacts);
      setSummary(customerSummary);
      setOrders(orderHistory);
      setPayments(paymentHistory);
    } catch (loadError) {
      console.error('Failed to load customer details:', loadError);
      setError('Could not load customer details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const ordersTotalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const paymentsTotalPages = Math.max(1, Math.ceil(payments.length / pageSize));

  useEffect(() => {
    setOrdersPage((page) => Math.min(page, ordersTotalPages));
  }, [ordersTotalPages]);

  useEffect(() => {
    setPaymentsPage((page) => Math.min(page, paymentsTotalPages));
  }, [paymentsTotalPages]);

  const paginatedOrders = orders.slice((ordersPage - 1) * pageSize, ordersPage * pageSize);
  const paginatedPayments = payments.slice((paymentsPage - 1) * pageSize, paymentsPage * pageSize);

  const changePageSize = (size: number) => {
    setPageSize(size);
    setOrdersPage(1);
    setPaymentsPage(1);
  };

  if (loading) {
    return (
      <section className='customer-details-screen'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          ← Back to customers
        </button>
        <div className='customer-details-state'>Loading customer details…</div>
      </section>
    );
  }

  if (error || !customer) {
    return (
      <section className='customer-details-screen'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          ← Back to customers
        </button>
        <div className='customer-details-state customer-details-state--error'>
          {error || 'This customer could not be found.'}
          <button type='button' onClick={() => void loadDetails()}>Try again</button>
        </div>
      </section>
    );
  }

  return (
    <section className='customer-details-screen'>
      <div className='customer-details-topbar'>
        <button className='customer-details-back' type='button' onClick={onBack}>
          <span aria-hidden='true'>←</span> Back to customers
        </button>
      </div>

      <header className='customer-details-header'>
        <div className='customer-details-avatar' aria-hidden='true'>
          {customer.businessName.trim().charAt(0).toUpperCase() || 'C'}
        </div>
        <div className='customer-details-heading'>
          <div className='customer-details-title-row'>
            <h1>{customer.businessName}</h1>
            <span className={`customer-details-status ${customer.isArchived ? 'is-archived' : ''}`}>
              {customer.isArchived ? 'Archived' : 'Active'}
            </span>
          </div>
          <p>
            {formatText(customer.primaryContactName)}
            {customer.city?.trim() ? ` · ${customer.city}` : ''}
          </p>
          <small>Customer since {formatDate(customer.createdAt)}</small>
        </div>
      </header>

      <div className='customer-details-metrics'>
        <article className='customer-details-metric'>
          <span>Lifetime order value</span>
          <strong>{formatMoneyPaise(summary?.lifetimeValuePaise ?? 0)}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Orders</span>
          <strong>{summary?.purchaseCount ?? 0}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Average order value</span>
          <strong>{formatMoneyPaise(summary?.averageOrderValuePaise ?? 0)}</strong>
        </article>
        <article className='customer-details-metric'>
          <span>Last purchase</span>
          <strong className='customer-details-date-value'>
            {formatDate(summary?.lastPurchaseDate)}
          </strong>
        </article>
      </div>

      <div className='customer-details-content'>
        <section className='customer-details-panel customer-details-history'>
          <div className='customer-details-panel-heading'>
            <div>
              <h2>History</h2>
              <p>Orders and payments recorded for this customer.</p>
            </div>
            <div className='customer-details-tabs' role='tablist' aria-label='Customer history'>
              <button
                type='button'
                role='tab'
                aria-selected={activeTab === 'orders'}
                className={activeTab === 'orders' ? 'is-active' : ''}
                onClick={() => { setActiveTab('orders'); setOrdersPage(1); }}
              >
                Orders <span>{orders.length}</span>
              </button>
              <button
                type='button'
                role='tab'
                aria-selected={activeTab === 'payments'}
                className={activeTab === 'payments' ? 'is-active' : ''}
                onClick={() => { setActiveTab('payments'); setPaymentsPage(1); }}
              >
                Payments <span>{payments.length}</span>
              </button>
            </div>
          </div>

          {activeTab === 'orders' ? (
            orders.length ? (
              <>
              <div className='customer-details-table-wrap'>
                <table className='customer-details-table'>
                  <thead>
                    <tr>
                      <th className='customer-details-serial'>S.No.</th>
                      <th>Order date</th>
                      <th>Order</th>
                      <th>Exhibition</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th className='is-numeric'>Order value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedOrders.map((order, index) => (
                      <tr key={order.id}>
                        <td className='customer-details-serial'>{(ordersPage - 1) * pageSize + index + 1}</td>
                        <td>{formatDate(order.orderDate)}</td>
                        <td className='customer-details-order-id'>#{order.id}</td>
                        <td>{formatText(order.exhibitionName)}</td>
                        <td>{order.itemCount}</td>
                        <td>
                          <span className='customer-details-order-status'>
                            {order.status}
                          </span>
                        </td>
                        <td className='is-numeric'>{formatMoneyPaise(order.totalValuePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <HistoryPagination
                totalItems={orders.length}
                currentPage={ordersPage}
                pageSize={pageSize}
                onPageChange={setOrdersPage}
                onPageSizeChange={changePageSize}
              />
              </>
            ) : (
              <div className='customer-details-empty'>
                <strong>No orders yet</strong>
                <p>Orders associated with this customer will appear here.</p>
              </div>
            )
          ) : payments.length ? (
            <>
            <div className='customer-details-table-wrap'>
              <table className='customer-details-table'>
                <thead>
                  <tr>
                    <th className='customer-details-serial'>S.No.</th>
                    <th>Payment date</th>
                    <th>Exhibition</th>
                    <th>Method</th>
                    <th>Notes</th>
                    <th className='is-numeric'>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayments.map((payment, index) => (
                    <tr key={payment.id}>
                      <td className='customer-details-serial'>{(paymentsPage - 1) * pageSize + index + 1}</td>
                      <td>{formatDate(payment.paymentDate)}</td>
                      <td>{formatText(payment.exhibitionName)}</td>
                      <td>{formatText(payment.paymentMethod)}</td>
                      <td>{formatText(payment.notes)}</td>
                      <td className='is-numeric'>{formatMoneyPaise(payment.amountPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <HistoryPagination
              totalItems={payments.length}
              currentPage={paymentsPage}
              pageSize={pageSize}
              onPageChange={setPaymentsPage}
              onPageSizeChange={changePageSize}
            />
            </>
          ) : (
            <div className='customer-details-empty'>
              <strong>No payments recorded</strong>
              <p>Payments recorded for this customer will appear here.</p>
            </div>
          )}
        </section>

        <aside className='customer-details-side'>
          <section className='customer-details-panel'>
            <h2>Contact information</h2>
            <dl className='customer-details-contact-list'>
              <div>
                <dt>Business email</dt>
                <dd>{formatText(customer.email)}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{formatText(customer.primaryContactPhone1)}</dd>
              </div>
              {customer.primaryContactPhone2?.trim() && (
                <div>
                  <dt>Alternate phone</dt>
                  <dd>{customer.primaryContactPhone2}</dd>
                </div>
              )}
              <div>
                <dt>City</dt>
                <dd>{formatText(customer.city)}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{formatText(customer.address)}</dd>
              </div>
            </dl>
            {contacts.length > 1 && (
              <div className='customer-details-other-contacts'>
                <h3>Other contacts</h3>
                {contacts.filter((contact) => !contact.isPrimary).map((contact) => (
                  <div className='customer-details-contact-person' key={contact.id}>
                    <strong>{contact.name}</strong>
                    <span>{formatText(contact.phone1)}</span>
                    {contact.phone2?.trim() && <span>{contact.phone2}</span>}
                    {contact.notes?.trim() && <small>{contact.notes}</small>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className='customer-details-panel'>
            <h2>Notes</h2>
            <p className='customer-details-notes'>
              {customer.notes?.trim() || 'No notes added for this customer.'}
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
