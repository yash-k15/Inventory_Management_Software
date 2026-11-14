# Inventory Management System

An offline-first desktop application for managing jewellery inventory and day-to-day business workflows.

## Application

- **Product name:** Inventory Management System
- **Release version:** 1.0.0
- **Platform:** Windows (primary production target)
- **Architecture:** Tauri 2, React, TypeScript, Vite, Rust and SQLite

## Main capabilities

- Jewellery inventory management
- Customer records
- Exhibitions and customer selections
- Confirmed orders and order details
- Payment tracking
- Jewellery tag and barcode generation/printing
- Data export, import and backup

## Development setup

Install the project dependencies, then start the development application:

```bash
npm install
npm run tauri:dev:restart
```

To run the frontend production build check:

```bash
npm run build
```

## Production release

The production installer should be built and tested on Windows. Before distributing an update:

1. Back up the business database and item photos.
2. Build the application using the release configuration.
3. Install and test the build on the target Windows machine.
4. Verify database access, item photos, tag printing, export and restore.
5. Keep the installer and release notes with the backup.

## Data safety

This application stores business data locally. Maintain regular backups of the database and associated item photos. Verify that a backup can be restored before relying on it as the only recovery copy.

## Versioning

The application version is maintained in the Tauri configuration, npm package metadata and Rust package metadata. Keep these versions aligned for each release.
