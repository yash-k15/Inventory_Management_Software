import { useEffect, useState } from 'react';
import { appDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import {
  getItemDetails,
  getItemDiamondDetails,
  getItemStoneDetails,
  type ItemDetails,
  type ItemDiamondDetail,
  type ItemStoneDetail,
} from './itemDetails.queries';
import './ItemDetailsScreen.css';

type Props = {
  itemId: number;
  onBack: () => void;
};

type LoadedItem = {
  item: ItemDetails;
  diamonds: ItemDiamondDetail[];
  stones: ItemStoneDetail[];
};

function formatWeight(
  milli: number | null | undefined,
  unit: 'g' | 'ct',
): string {
  return milli == null ? '—' : `${(milli / 1000).toFixed(3)} ${unit}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';

  const date = new Date(value.replace(' ', 'T'));

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatCustomValues(value: string): string | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, entry]) => entry != null && String(entry).trim() !== '',
    );

    return entries.length
      ? JSON.stringify(Object.fromEntries(entries), null, 2)
      : null;
  } catch {
    return null;
  }
}

function ItemDetailsScreen({ itemId, onBack }: Props) {
  const [data, setData] = useState<LoadedItem | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadItem() {
      setLoading(true);
      setError(null);
      setData(null);
      setImageUrl(null);

      try {
        const item = await getItemDetails(itemId);

        if (!item) {
          if (!cancelled) setError('This jewelry item could not be found.');
          return;
        }

        const [diamonds, stones] = await Promise.all([
          getItemDiamondDetails(itemId),
          getItemStoneDetails(itemId),
        ]);

        if (cancelled) return;

        setData({ item, diamonds, stones });

        if (item.imagePath) {
          try {
            const directory = await appDataDir();
            const path = await join(directory, item.imagePath);

            await invoke('allow_image_preview', { path });

            if (!cancelled) setImageUrl(convertFileSrc(path));
          } catch (imageError) {
            console.error('Unable to load jewelry image:', imageError);
          }
        }
      } catch (loadError) {
        console.error('Unable to load jewelry item:', loadError);
        if (!cancelled) {
          setError('Unable to load this jewelry item. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadItem();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return (
      <section className='item-details-screen'>
        <p className='item-details-message'>Loading jewelry item…</p>
      </section>
    );
  }

  if (error || !data) {
    return (
      <section className='item-details-screen'>
        <button className='item-details-back' type='button' onClick={onBack}>
          ← Inventory
        </button>
        <p className='item-details-message item-details-error'>
          {error ?? 'This jewelry item could not be found.'}
        </p>
      </section>
    );
  }

  const { item, diamonds, stones } = data;
  const totalDiamondPieces = diamonds.reduce(
    (total, diamond) => total + (diamond.pieces ?? 0),
    0,
  );
  const totalDiamondWeight = diamonds.reduce(
    (total, diamond) => total + diamond.weightMilli,
    0,
  );
  const totalStonePieces = stones.reduce(
    (total, stone) => total + (stone.pieces ?? 0),
    0,
  );
  const totalStoneWeight = stones.reduce(
    (total, stone) => total + stone.weightMilli,
    0,
  );
  const customValues = formatCustomValues(item.customValues);

  return (
    <section className='item-details-screen'>
      <header className='item-details-header'>
        <div className='item-details-heading'>
          <button className='item-details-back' type='button' onClick={onBack}>
            ← Inventory
          </button>

          <div className='item-details-title-row'>
            <h1>{item.itemNumber}</h1>
            <span
              className={`item-details-status ${
                item.isArchived ? 'is-archived' : 'is-active'
              }`}
            >
              {item.isArchived ? 'Archived' : 'Active'}
            </span>
          </div>

          <p className='item-details-subtitle'>
            {item.categoryName}
            {item.createdAt
              ? ` · Added ${formatDate(item.createdAt).split(',')[0]}`
              : ''}
          </p>
        </div>
      </header>

      <div className='item-details-layout'>
        <div className='item-details-main'>
          <div className='item-details-stats'>
            <StatCard
              label='Gross weight'
              value={formatWeight(item.grossWeightMilli, 'g')}
            />

            <StatCard
              label='Net weight'
              value={formatWeight(item.netWeightMilli, 'g')}
            />

            <StatCard
              label='Diamonds'
              value={`${totalDiamondPieces} pcs`}
              helper={`${(totalDiamondWeight / 1000).toFixed(3)} ct total weight`}
            />

            <StatCard
              label='Purity'
              value={
                <>
                  {item.goldTypeName && (
                    <span className='item-details-stat-line'>
                      {item.goldTypeName}
                    </span>
                  )}
                  <span className='item-details-stat-line'>
                    {item.purityName ?? '—'}
                  </span>
                </>
              }
              helper={
                item.purityPercentBp == null
                  ? undefined
                  : `${(item.purityPercentBp / 100).toFixed(2)}% purity`
              }
            />
          </div>

          <section className='item-details-card'>
            <SectionHeading title='Diamonds' />
            <p className='item-details-section-subtitle'>
              {diamonds.length} {diamonds.length === 1 ? 'shape' : 'shapes'}
              {' · '}
              {totalDiamondPieces} pcs
              {' · '}
              {(totalDiamondWeight / 1000).toFixed(3)} ct
            </p>

            {diamonds.length === 0 ? (
              <EmptySection message='No diamond details recorded.' />
            ) : (
              <div className='item-details-table-wrap'>
                <table className='item-details-table'>
                  <thead>
                    <tr>
                      <th>Shape</th>
                      <th>Pieces</th>
                      <th>Weight</th>
                      <th>Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diamonds.map((diamond) => (
                      <tr key={diamond.id}>
                        <td>{diamond.shapeName}</td>
                        <td>{diamond.pieces ?? '—'}</td>
                        <td>{formatWeight(diamond.weightMilli, 'ct')}</td>
                        <td>{diamond.combinationQuality ?? '—'}</td>
                      </tr>
                    ))}
                    <tr className='item-details-total-row'>
                      <td>Total</td>
                      <td>{totalDiamondPieces}</td>
                      <td>{(totalDiamondWeight / 1000).toFixed(3)} ct</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className='item-details-card'>
            <SectionHeading title='Other stones' />
            <p className='item-details-section-subtitle'>
              {stones.length} {stones.length === 1 ? 'type' : 'types'}
              {' · '}
              {totalStonePieces} pcs
              {' · '}
              {(totalStoneWeight / 1000).toFixed(3)} ct
            </p>

            {stones.length === 0 ? (
              <EmptySection message='No other stones recorded.' />
            ) : (
              <div className='item-details-table-wrap'>
                <table className='item-details-table'>
                  <thead>
                    <tr>
                      <th>Stone</th>
                      <th>Pieces</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stones.map((stone) => (
                      <tr key={stone.id}>
                        <td>{stone.stoneName}</td>
                        <td>{stone.pieces ?? '—'}</td>
                        <td>
                          {formatWeight(
                            stone.weightMilli,
                            stone.weightUnit === 'g' ? 'g' : 'ct',
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className='item-details-total-row'>
                      <td>Total</td>
                      <td>{totalStonePieces}</td>
                      <td>{(totalStoneWeight / 1000).toFixed(3)} ct</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className='item-details-card'>
            <SectionHeading title='Notes' />
            {item.notes?.trim() ? (
              <p className='item-details-notes'>{item.notes}</p>
            ) : customValues ? (
              <pre className='item-details-custom-values'>{customValues}</pre>
            ) : (
              <p className='item-details-custom-values'>No Notes Added</p>
            )}
          </section>
        </div>

        <aside className='item-details-sidebar'>
          <section className='item-details-card item-details-image-card'>
            <div className='item-details-image-wrap'>
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Jewelry item ${item.itemNumber}`}
                  className='item-details-image'
                  onError={() => setImageUrl(null)}
                />
              ) : (
                <div className='item-details-image-placeholder'>
                  <span>◇</span>
                  <p>No image available</p>
                </div>
              )}
            </div>
            <p className='item-details-image-caption'>
              {imageUrl ? 'Item image' : 'No image saved'}
            </p>
          </section>

          <section className='item-details-card'>
            <SectionHeading title='Certification' />
            <KeyValue
              label='IGI report'
              value={item.igiCertificateNumber || 'Missing'}
              alert={!item.igiCertificateNumber}
            />
            <KeyValue
              label='HUID'
              value={item.huid || 'Missing'}
              alert={!item.huid}
            />
          </section>

          <section className='item-details-card'>
            <SectionHeading title='Record' />
            <KeyValue label='Item number' value={item.itemNumber} />
            <KeyValue label='Created' value={formatDate(item.createdAt)} />
            <KeyValue label='Last updated' value={formatDate(item.updatedAt)} />
            <KeyValue
              label='Status'
              value={item.isArchived ? 'Archived' : 'Active'}
            />
          </section>
        </aside>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: React.ReactNode;
  helper?: string;
}) {
  return (
    <div className='item-details-stat'>
      <span className='item-details-stat-label'>{label}</span>
      <strong className='item-details-stat-value'>{value}</strong>
      {helper && <span className='item-details-stat-helper'>{helper}</span>}
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h2 className='item-details-section-heading'>{title}</h2>;
}

function KeyValue({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className='item-details-key-value'>
      <span>{label}</span>
      <strong className={alert ? 'item-details-missing' : ''}>
        {alert ? '× ' : ''}
        {value}
      </strong>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return <p className='item-details-empty'>{message}</p>;
}

export default ItemDetailsScreen;
