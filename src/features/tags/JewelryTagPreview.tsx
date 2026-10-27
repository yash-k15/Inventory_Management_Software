import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import bwipjs from 'bwip-js/browser';
import type { InventoryItem } from '../inventory/inventory.types';
import './JewelryTagPreview.css';

type Props = {
  item?: InventoryItem;
  items?: InventoryItem[];
  onClose: () => void;
};
type Detail = {
  label: string;
  pieces: number;
  weight: string;
  kind: 'diamond' | 'stone';
};

function parseDetails(value: string | null, kind: Detail['kind']): Detail[] {
  if (!value?.trim()) return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Inventory query format: LABEL: 1.200 ct (120 pcs), or LABEL: 1.200 g (120 pcs).
      const match = line.match(/^(.+?):\s*(.*?)\s*\((\d+)\s+pcs?\)$/i);
      if (match)
        return {
          label: match[1].trim(),
          weight: match[2].trim(),
          pieces: Number(match[3]),
          kind,
        };
      return { label: line, weight: '', pieces: 0, kind };
    });
}

function formatDetail(detail: Detail) {
  const label = detail.kind === 'diamond' ? `D ${detail.label}` : detail.label;
  return detail.weight
    ? `${label}: ${detail.pieces} pcs / ${detail.weight}`
    : label;
}

function Barcode({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    try {
      const result = bwipjs.toSVG({
        bcid: 'code128',
        text: value,
        scale: 2,
        height: 13,
        includetext: false,
        padding: 0,
      });
      if (!cancelled) {
        setSvg(result);
        setError(false);
      }
    } catch {
      if (!cancelled) {
        setSvg('');
        setError(true);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (error || !svg)
    return (
      <text x='360' y='24' fontSize='7' fill='#000'>
        {error ? 'Barcode unavailable' : 'Generating barcode…'}
      </text>
    );
  // Embed the generated barcode as an image with explicit bitmap-relative bounds.
  // Nesting bwip-js's root SVG directly in a <g> lets its own viewBox/size
  // override the tag coordinates in some browsers, causing the overlap seen before.
  const barcodeData = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <image
      href={barcodeData}
      x='355'
      y='5'
      width='160'
      height='31'
      preserveAspectRatio='none'
    />
  );
}

export default function JewelryTagPreview({
  item: singleItem,
  items: providedItems,
  onClose,
}: Props) {
  const items = providedItems?.length
    ? providedItems
    : singleItem
      ? [singleItem]
      : [];
  const [currentPage, setCurrentPage] = useState(0);
  const [removedItemIds, setRemovedItemIds] = useState<number[]>([]);
  const [detailCounts, setDetailCounts] = useState<Record<number, number>>({});
  const [isPrintingAll, setIsPrintingAll] = useState(false);
  const printerRegistry = useRef<Record<number, () => Promise<void>>>({});
  const visibleItems = items.filter(
    (item) => !removedItemIds.includes(item.id),
  );
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const safePage = Math.min(currentPage, pageCount - 1);
  const registerPrinter = useCallback(
    (itemId: number, printer: (() => Promise<void>) | null) => {
      if (printer) printerRegistry.current[itemId] = printer;
      else delete printerRegistry.current[itemId];
    },
    [],
  );

  const handlePrintAll = async () => {
    if (isPrintingAll) return;
    setIsPrintingAll(true);
    try {
      for (const item of visibleItems) {
        const printTag = printerRegistry.current[item.id];
        if (printTag) await printTag();
      }
    } finally {
      setIsPrintingAll(false);
    }
  };

  useEffect(() => {
    setCurrentPage(0);
  }, [visibleItems.length]);

  useEffect(() => {
    setCurrentPage((page) =>
      Math.min(
        page,
        Math.max(0, Math.ceil(visibleItems.length / pageSize) - 1),
      ),
    );
  }, [visibleItems.length]);

  if (visibleItems.length === 0) return null;

  return (
    <div
      className='tag-preview-overlay'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className='tag-preview-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='tag-preview-title'
      >
        <header className='tag-preview-header'>
          <div>
            <h2 id='tag-preview-title'>Print tag previews</h2>
            <p>Review each tag before printing · 100 × 13 mm</p>
            <p className='tag-preview-navigation-count'>
              Showing {safePage * pageSize + 1}–
              {Math.min((safePage + 1) * pageSize, visibleItems.length)} of{' '}
              {visibleItems.length} tags
            </p>
          </div>
          <button
            type='button'
            className='tag-preview-close'
            onClick={onClose}
            aria-label='Close preview'
          >
            ×
          </button>
        </header>

        <div className='tag-preview-items'>
          {visibleItems.map((item, index) => (
            <JewelryTagCard
              key={item.id}
              item={item}
              position={index + 1}
              total={visibleItems.length}
              isHidden={
                index < safePage * pageSize ||
                index >= (safePage + 1) * pageSize
              }
              onRemove={() =>
                setRemovedItemIds((current) => [...current, item.id])
              }
              detailCount={detailCounts[item.id]}
              onDetailCountChange={(count) =>
                setDetailCounts((current) => ({ ...current, [item.id]: count }))
              }
              onRegisterPrinter={registerPrinter}
            />
          ))}
        </div>

        <footer className='tag-preview-pagination'>
          <button
            type='button'
            className='tag-preview-done tag-preview-secondary'
            onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
            disabled={safePage === 0}
          >
            Previous 5
          </button>
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            type='button'
            className='tag-preview-done'
            onClick={() =>
              setCurrentPage((page) => Math.min(pageCount - 1, page + 1))
            }
            disabled={safePage >= pageCount - 1}
          >
            Next 5
          </button>
          <button
            type='button'
            className='tag-preview-done tag-preview-print-all'
            onClick={() => void handlePrintAll()}
            disabled={isPrintingAll}
          >
            {isPrintingAll
              ? 'Printing all tags…'
              : `Print all tags (${visibleItems.length})`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function JewelryTagCard({
  item,
  position,
  total,
  detailCount: savedDetailCount,
  onDetailCountChange,
  isHidden,
  onRegisterPrinter,
  onRemove,
}: {
  item: InventoryItem;
  position: number;
  total: number;
  detailCount: number | undefined;
  isHidden: boolean;
  onDetailCountChange: (count: number) => void;
  onRegisterPrinter: (
    itemId: number,
    printer: (() => Promise<void>) | null,
  ) => void;
  onRemove: () => void;
}) {
  const allDetails = useMemo(
    () => [
      ...parseDetails(item.diamondDetails, 'diamond'),
      ...parseDetails(item.stoneDetails, 'stone'),
    ],
    [item.diamondDetails, item.stoneDetails],
  );
  const detailCount = savedDetailCount ?? Math.min(6, allDetails.length);
  const tagSvgRef = useRef<SVGSVGElement>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [printError, setPrintError] = useState(false);

  const handlePrintTag = useCallback(async () => {
    const svg = tagSvgRef.current;
    if (!svg || isPrinting) return;

    setIsPrinting(true);
    setPrintMessage(null);
    setPrintError(false);

    try {
      // Copy computed styles into the SVG so its appearance is preserved when
      // rasterized as a standalone image in the WebView.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', '800');
      clone.setAttribute('height', '104');

      // bwip-js produces an SVG data URI inside an <image>. Some Tauri WebView
      // builds omit nested data-URI images when rasterizing a serialized SVG,
      // which caused the barcode to disappear from the physical tag. Capture
      // its source and draw it separately onto the final bitmap instead.
      const barcodeElement = clone.querySelector(
        'image[href^="data:image/svg+xml"]',
      );
      const barcodeHref = barcodeElement?.getAttribute('href');
      const barcodeBox = barcodeElement
        ? {
            x: Number(barcodeElement.getAttribute('x') ?? 0),
            y: Number(barcodeElement.getAttribute('y') ?? 0),
            width: Number(barcodeElement.getAttribute('width') ?? 0),
            height: Number(barcodeElement.getAttribute('height') ?? 0),
          }
        : null;
      barcodeElement?.remove();

      const sourceElements = [
        svg,
        ...Array.from(svg.querySelectorAll('*')).filter(
          (element) => element.tagName.toLowerCase() !== 'image',
        ),
      ];
      const clonedElements = [
        clone,
        ...Array.from(clone.querySelectorAll('*')),
      ];
      const styleProperties = [
        'font-family',
        'font-size',
        'font-weight',
        'font-style',
        'fill',
        'stroke',
        'stroke-width',
        'text-anchor',
        'dominant-baseline',
      ];

      sourceElements.forEach((source, index) => {
        const target = clonedElements[index];
        if (!(source instanceof SVGElement) || !(target instanceof SVGElement))
          return;
        const computed = window.getComputedStyle(source);
        const styles = styleProperties
          .map(
            (property) => `${property}:${computed.getPropertyValue(property)}`,
          )
          .join(';');
        target.setAttribute('style', styles);
      });

      const serialized = new XMLSerializer().serializeToString(clone);
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
      const image = new Image();
      image.src = svgUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(new Error('Could not render the tag artwork for printing.'));
      });

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 104;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context)
        throw new Error('Could not prepare the tag image for printing.');

      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Keep the approved template's 180-degree bitmap orientation.
      context.translate(800, 104);
      context.rotate(Math.PI);
      context.drawImage(image, 0, 0, 800, 104);

      if (barcodeHref && barcodeBox) {
        const barcodeImage = new Image();
        barcodeImage.src = barcodeHref;
        await new Promise<void>((resolve, reject) => {
          barcodeImage.onload = () => resolve();
          barcodeImage.onerror = () =>
            reject(
              new Error('Could not render the item barcode for printing.'),
            );
        });
        // Apply the same transform as the SVG artwork so the barcode shares
        // its exact approved location and orientation.
        context.drawImage(
          barcodeImage,
          barcodeBox.x,
          barcodeBox.y,
          barcodeBox.width,
          barcodeBox.height,
        );
      }
      const pixels = context.getImageData(0, 0, 800, 104).data;
      const bitmap = new Array<number>(10400).fill(255);

      // TSPL BITMAP data uses one bit per pixel. Preserve white as 1 and
      // clear bits for dark pixels; 800 pixels = 100 bytes per row.
      for (let y = 0; y < 104; y += 1) {
        for (let x = 0; x < 800; x += 1) {
          const pixel = (y * 800 + x) * 4;
          const luminance =
            0.299 * pixels[pixel] +
            0.587 * pixels[pixel + 1] +
            0.114 * pixels[pixel + 2];
          if (luminance < 160) {
            const byteIndex = y * 100 + Math.floor(x / 8);
            bitmap[byteIndex] &= ~(1 << (7 - (x % 8)));
          }
        }
      }

      await invoke('print_tag_bitmap', { bitmap });
      setPrintMessage(`Print job sent to TSC_TE244 for ${item.itemNumber}.`);
    } catch (error) {
      console.error('Failed to print jewelry tag:', error);
      setPrintError(true);
      setPrintMessage(
        typeof error === 'string'
          ? error
          : 'Could not send the tag to TSC_TE244. Check that the printer is connected and the queue is available.',
      );
    } finally {
      setIsPrinting(false);
    }
  }, [isPrinting, item.itemNumber]);

  useEffect(() => {
    onRegisterPrinter(item.id, handlePrintTag);
    return () => onRegisterPrinter(item.id, null);
  }, [item.id, onRegisterPrinter, handlePrintTag]);

  // Round diamond (D RD) is always printed on the front. Other details go
  // on the back/right column, regardless of their order in the inventory data.
  const roundDiamond =
    allDetails.find(
      (detail) =>
        detail.kind === 'diamond' &&
        (/^RD$/i.test(detail.label.trim()) || /round/i.test(detail.label)),
    ) ??
    allDetails.find((detail) => detail.kind === 'diamond') ??
    null;
  const frontDetail = roundDiamond;
  const extraDetails = allDetails.filter((detail) => detail !== roundDiamond);
  const backDetails = extraDetails.slice(
    0,
    Math.max(0, detailCount - (frontDetail ? 1 : 0)),
  );
  const rowPositions: Record<number, number[]> = {
    0: [],
    1: [18],
    2: [18, 38],
    3: [14, 34, 54],
    4: [12, 32, 52, 72],
    5: [12, 30, 48, 66, 84],
  };
  const detailYPositions = rowPositions[backDetails.length] ?? [];
  const goldWeight =
    item.grossWeightMilli == null
      ? '—'
      : `${(item.grossWeightMilli / 1000).toFixed(3)} gms`;
  const availableCount = Math.min(6, allDetails.length);

  return (
    <article className={`tag-preview-item-card${isHidden ? ' is-hidden' : ''}`}>
      <header className='tag-preview-item-header'>
        <div className='tag-preview-item-heading'>
          <h3>{item.itemNumber}</h3>
          <p>
            Tag {position} of {total}
          </p>
        </div>
        <div className='tag-preview-card-controls'>
          <div
            className='tag-preview-count-picker'
            aria-label='Choose number of details'
          >
            <span>Details on item</span>
            {Array.from(
              {
                length:
                  Math.max(0, availableCount - (roundDiamond ? 1 : 0)) + 1,
              },
              (_, index) => index + (roundDiamond ? 1 : 0),
            ).map((count) => (
              <button
                key={count}
                type='button'
                className={detailCount === count ? 'is-active' : ''}
                aria-pressed={detailCount === count}
                onClick={() => onDetailCountChange(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <button
            type='button'
            className='tag-preview-remove-item'
            onClick={onRemove}
            aria-label={`Remove ${item.itemNumber} from print batch`}
            title='Remove from print batch'
          >
            ×
          </button>
        </div>
      </header>
      <div className='tag-preview-canvas-wrap'>
        <div className='tag-preview-scale-note'>
          Preview only · not print-ready
        </div>
        <svg
          ref={tagSvgRef}
          className='jewelry-tag-preview'
          viewBox='0 0 800 104'
          role='img'
          aria-label={`Jewelry tag for ${item.itemNumber} with ${detailCount} detail rows`}
        >
          <rect width='800' height='104' fill='#fff' />
          <Barcode value={item.itemNumber} />
          <text
            x='410'
            y='51'
            className='tag-preview-item-code'
            style={{ fontSize: 18 }}
          >
            {item.itemNumber}
          </text>
          <text x='355' y='72' className='tag-preview-gold-weight'>
            G WT: {goldWeight}
          </text>
          {frontDetail && (
            <text x='355' y='92' className='tag-preview-front-detail'>
              {formatDetail(frontDetail)}
            </text>
          )}
          {backDetails.map((detail, index) => (
            <text
              key={`${detail.label}-${index}`}
              x='584'
              y={detailYPositions[index] + 5}
              className='tag-preview-detail-row'
            >
              {formatDetail(detail)}
            </text>
          ))}
        </svg>
      </div>
      <div className='tag-preview-footer'>
        {printMessage && (
          <p
            role={printError ? 'alert' : 'status'}
            style={{
              color: printError ? '#b42318' : '#067647',
              width: '100%',
              margin: '0 0 8px',
            }}
          >
            {printMessage}
          </p>
        )}
      </div>
    </article>
  );
}
