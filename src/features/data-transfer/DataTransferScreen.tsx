import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import './DataTransferScreen.css';

interface TransferValidationResult {
  transferId: string;
  exportedAtUnixSeconds: number;
  schemaVersion: number;
  imageCount: number;
  databaseIntegrity: string;
  message: string;
}

function DataTransferScreen() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [validation, setValidation] = useState<TransferValidationResult | null>(null);

  async function exportPackage() {
    setNotice(null);
    const destination = await save({
      title: 'Export Master Package',
      defaultPath: 'Master-Transfer.zip',
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (!destination) return;

    setBusy(true);
    try {
      const message = await invoke<string>('export_master_package', { destination });
      setNotice({ type: 'success', message: `${message}\nSaved to: ${destination}` });
    } catch (error) {
      setNotice({ type: 'error', message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function validatePackage() {
    setNotice(null);
    setValidation(null);
    const selected = await open({
      title: 'Select Master Transfer Package',
      multiple: false,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setBusy(true);
    try {
      const result = await invoke<TransferValidationResult>('validate_master_package', { source: selected });
      setValidation(result);
      setNotice({ type: 'success', message: result.message });
    } catch (error) {
      setNotice({ type: 'error', message: String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className='data-transfer-screen'>
      <header className='data-transfer-heading'>
        <div>
          <p className='data-transfer-eyebrow'>SYSTEM</p>
          <h1 className='app-page-title'>Data Transfer</h1>
          <p className='app-page-description'>Create a portable copy of your Master database and item photos.</p>
        </div>
      </header>

      {notice && (
        <div className={`data-transfer-notice data-transfer-notice--${notice.type}`} role='status'>
          {notice.message}
        </div>
      )}

      <article className='data-transfer-card'>
        <div className='data-transfer-card-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24' fill='none'><path d='M12 3v12m0 0 4-4m-4 4-4-4M4 17v3h16v-3' /></svg>
        </div>
        <div className='data-transfer-card-content'>
          <h2>Export Master Package</h2>
          <p>Export a consistent SQLite database backup together with the complete item-images folder in one ZIP file.</p>
          <ul>
            <li>Complete application database</li>
            <li>All files from the item-images folder</li>
            <li>Transfer manifest and database integrity check</li>
          </ul>
          <button type='button' className='data-transfer-primary-button' onClick={exportPackage} disabled={busy}>
            {busy ? 'Creating package…' : 'Export Master Package'}
          </button>
        </div>
      </article>

      <article className='data-transfer-card'>
        <div className='data-transfer-card-icon' aria-hidden='true'>
          <svg viewBox='0 0 24 24' fill='none'><path d='M4 4h16v16H4zM8 8h8M8 12h8M8 16h5' /></svg>
        </div>
        <div className='data-transfer-card-content'>
          <h2>Validate Master Package</h2>
          <p>Select a transfer ZIP to check its structure, manifest, database integrity, migration history and photo entries. This step does not modify your current data.</p>
          <button type='button' className='data-transfer-primary-button' onClick={validatePackage} disabled={busy}>
            {busy ? 'Validating package…' : 'Select Package & Validate'}
          </button>
          {validation && (
            <div className='data-transfer-validation-result' role='status'>
              <h3>Validation successful</h3>
              <p>Transfer ID: {validation.transferId}</p>
              <p>Database schema: {validation.schemaVersion}</p>
              <p>Database integrity: {validation.databaseIntegrity}</p>
              <p>Photo files: {validation.imageCount}</p>
              <p>Exported: {new Date(validation.exportedAtUnixSeconds * 1000).toLocaleString()}</p>
            </div>
          )}
        </div>
      </article>

      <p className='data-transfer-footnote'>Package validation only. Your existing database and photos are not changed. Import and replacement will be implemented separately.</p>
    </section>
  );
}

export default DataTransferScreen;
