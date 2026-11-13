import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import './DataTransferScreen.css';

interface TransferValidationResult {
  transferId: string;
  exportedAtUnixSeconds: number;
  schemaVersion: number;
  imageCount: number;
  databaseIntegrity: string;
  message: string;
}

interface PreparedImportResult {
  operationId: string;
  transferId: string;
  imageCount: number;
  backupDirectory: string;
  stagingDirectory: string;
  message: string;
}

interface ImportCompletionResult {
  success: boolean;
  message: string;
  completedAtUnixMillis: number;
}

function DataTransferScreen() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [validation, setValidation] = useState<TransferValidationResult | null>(
    null,
  );
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [preparedImport, setPreparedImport] =
    useState<PreparedImportResult | null>(null);
  const [showImportConfirmation, setShowImportConfirmation] = useState(false);

  // The Rust command consumes the persisted completion notice after returning it,
  // so the message is shown only once after an import completes.
  useEffect(() => {
    invoke<ImportCompletionResult | null>('get_data_transfer_import_result')
      .then((result) => {
        if (result) {
          setNotice({
            type: result.success ? 'success' : 'error',
            message: result.message,
          });
        }
      })
      .catch((error) =>
        console.error('Could not load the previous import result:', error),
      );
  }, []);

  // Automatically dismiss operation notices after five seconds.
  useEffect(() => {
    if (!notice) return;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  async function exportPackage() {
    setNotice(null);

    const today = new Date();
    const dateStamp = [
      String(today.getDate()).padStart(2, '0'),
      String(today.getMonth() + 1).padStart(2, '0'),
      today.getFullYear(),
    ].join('-');

    const destination = await save({
      title: 'Export Master Package',
      defaultPath: `Master-Transfer-${dateStamp}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });

    if (!destination) return;

    setBusy(true);
    try {
      const message = await invoke<string>('export_master_package', {
        destination,
      });
      setNotice({
        type: 'success',
        message: `${message}\nSaved to: ${destination}`,
      });
    } catch (error) {
      setNotice({ type: 'error', message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function validatePackage() {
    setNotice(null);
    setValidation(null);
    setSelectedPackage(null);
    setPreparedImport(null);
    const selected = await open({
      title: 'Select Master Transfer Package',
      multiple: false,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setBusy(true);
    try {
      const result = await invoke<TransferValidationResult>(
        'validate_master_package',
        { source: selected },
      );
      setValidation(result);
      setSelectedPackage(selected);
      setNotice({ type: 'success', message: result.message });
    } catch (error) {
      setNotice({ type: 'error', message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function prepareImport() {
    if (!selectedPackage || !validation) return;
    setNotice(null);
    setPreparedImport(null);
    setBusy(true);
    try {
      const result = await invoke<PreparedImportResult>(
        'prepare_master_import',
        { source: selectedPackage },
      );
      setPreparedImport(result);
      setNotice({ type: 'success', message: result.message });
    } catch (error) {
      setNotice({ type: 'error', message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function scheduleImport() {
    if (!preparedImport) return;

    setBusy(true);
    setNotice(null);

    try {
      // This command only writes the pending-import journal. It does not exit the app.
      await invoke<string>('schedule_master_import', {
        operationId: preparedImport.operationId,
      });
      setShowImportConfirmation(false);
      setPreparedImport(null);

      if (import.meta.env.DEV) {
        // The Rust command exits this window after writing a restart marker.
        // The tauri-dev supervisor restarts both Tauri and Vite.
        setNotice({
          type: 'success',
          message:
            'Restarting the development application to apply the Master package…',
        });
      } else {
        setNotice({
          type: 'success',
          message: 'Restarting the application to apply the Master package…',
        });
        await relaunch();
      }
    } catch (error) {
      setNotice({
        type: 'error',
        message: `The import could not be scheduled or the application could not restart: ${String(error)}. If the import was scheduled, close and reopen the application manually to complete it.`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className='data-transfer-screen'>
      <header className='page-header data-transfer-heading'>
        <div>
          <h1 className='page-title'>Data Transfer</h1>
        </div>
      </header>

      {notice && (
        <div
          className={`data-transfer-notice data-transfer-notice--${notice.type}`}
          role='status'
        >
          <span className='data-transfer-notice-message'>{notice.message}</span>
          <button
            type='button'
            className='data-transfer-notice-close'
            onClick={() => setNotice(null)}
            aria-label='Dismiss notification'
            title='Dismiss'
          >
            <svg viewBox='0 0 20 20' aria-hidden='true'>
              <path d='M5 5l10 10M15 5L5 15' />
            </svg>
          </button>
        </div>
      )}

      <div className='data-transfer-card-grid'>
        <article className='card data-transfer-card'>
                <div className='data-transfer-card-icon' aria-hidden='true'>
                  <svg viewBox='0 0 24 24' fill='none'>
                    <path d='M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' />
                  </svg>
                </div>
                <div className='data-transfer-card-content'>
                  <h2>Validate Master Package</h2>
                  <p>
                    Select a transfer ZIP to check its structure, manifest, database
                    integrity, migration history and photo entries. This step does not
                    modify your current data.
                  </p>
                  <button
                    type='button'
                    className='btn btn--primary'
                    onClick={validatePackage}
                    disabled={busy}
                  >
                    {busy ? 'Validating package…' : 'Select Package & Validate'}
                  </button>

                </div>
                </article>
        <article className='card data-transfer-card'>
                <div className='data-transfer-card-icon' aria-hidden='true'>
                  <svg viewBox='0 0 24 24' fill='none'>
                    <path d='M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3' />
                  </svg>
                </div>
                <div className='data-transfer-card-content'>
                  <h2>Export Master Package</h2>
                  <p>
                    Export a consistent SQLite database backup together with the
                    complete item-images folder in one ZIP file.
                  </p>
                  <ul>
                    <li>Your complete inventory and business data</li>
                    <li>All item photos</li>
                    
                  </ul>
                  <button
                    type='button'
                    className='btn btn--primary'
                    onClick={exportPackage}
                    disabled={busy}
                  >
                    {busy ? 'Creating package…' : 'Export Master Package'}
                  </button>
                </div>
              </article>
      </div>

      {validation && selectedPackage && (
        <article className='card data-transfer-import-card'>
          <div className='data-transfer-import-header'>
            <div>
              <h2>Import Master Package</h2>
              <p>Follow the steps below to safely replace this computer's data with the selected Master package.</p>
            </div>
            <span className='data-transfer-step-status data-transfer-step-status--success'>
              Package validated
            </span>
          </div>

          <div className='data-transfer-import-steps'>
            <section className='data-transfer-import-step'>
              <div className='data-transfer-import-step-heading'>
                <span className='data-transfer-step-number data-transfer-step-number--complete'>1</span>
                <h3>Package validated</h3>
                <span className='data-transfer-step-status data-transfer-step-status--success'>Complete</span>
              </div>
              <p>Photo files: {validation.imageCount}</p>
              <p>
                Exported: {new Date(validation.exportedAtUnixSeconds * 1000).toLocaleString()}
              </p>
            </section>

            <section className='data-transfer-import-step'>
              <div className='data-transfer-import-step-heading'>
                <span className={`data-transfer-step-number ${preparedImport ? 'data-transfer-step-number--complete' : ''}`}>2</span>
                <h3>Create backup & prepare import</h3>
                {preparedImport && (
                  <span className='data-transfer-step-status data-transfer-step-status--success'>Complete</span>
                )}
              </div>
              {preparedImport ? (
                <p>Backup created and {preparedImport.imageCount} photos are ready to import. Your current data has not been replaced.</p>
              ) : (
                <>
                  <p>Create a verified backup of the current data and prepare the incoming package. This step does not replace your live data.</p>
                  <button
                    type='button'
                    className='btn btn--primary'
                    onClick={prepareImport}
                    disabled={busy}
                  >
                    {busy ? 'Preparing backup…' : 'Create Backup & Prepare Import'}
                  </button>
                </>
              )}
            </section>

            <section className='data-transfer-import-step'>
              <div className='data-transfer-import-step-heading'>
                <span className={`data-transfer-step-number ${preparedImport ? 'data-transfer-step-number--ready' : ''}`}>3</span>
                <h3>Review & apply import</h3>
                <span className={`data-transfer-step-status ${preparedImport ? 'data-transfer-step-status--warning' : ''}`}>
                  {preparedImport ? 'Ready' : 'Waiting'}
                </span>
              </div>
              <p>Replace the data and item photos on this computer with the selected Master package. A verified backup is available for recovery.</p>
              <button
                type='button'
                className='btn btn--danger'
                onClick={() => setShowImportConfirmation(true)}
                disabled={busy || !preparedImport}
              >
                Review & Apply Import
              </button>
            </section>
          </div>
        </article>
      )}


      {showImportConfirmation && (
        <div
          className='data-transfer-confirm-backdrop'
          role='presentation'
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) {
              setShowImportConfirmation(false);
            }
          }}
        >
          <section
            className='data-transfer-confirm-dialog'
            role='alertdialog'
            aria-modal='true'
            aria-labelledby='data-transfer-confirm-title'
            aria-describedby='data-transfer-confirm-description'
          >
            <h2
              id='data-transfer-confirm-title'
              className='data-transfer-confirm-title'
            >
              Apply Master Package?
            </h2>
            <p
              id='data-transfer-confirm-description'
              className='data-transfer-confirm-description'
            >
              This will replace the complete local database and item photos. A
              verified backup has already been created. The application will
              restart automatically in the installed version. In development
              mode, you will need to restart it from the terminal.
            </p>
            <div className='data-transfer-confirm-actions'>
              <button
                type='button'
                className='btn btn--secondary'
                disabled={busy}
                onClick={() => setShowImportConfirmation(false)}
              >
                Cancel
              </button>
              <button
                type='button'
                className='btn btn--danger'
                disabled={busy}
                onClick={scheduleImport}
              >
                {busy ? 'Scheduling…' : 'Confirm & Apply Import'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default DataTransferScreen;
