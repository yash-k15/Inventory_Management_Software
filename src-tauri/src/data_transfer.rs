use serde::{Deserialize, Serialize};
use std::{fs, io::{Read, Seek, Write}, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};
use tauri::{AppHandle, Manager};

const SCHEMA_VERSION: u32 = 16;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferManifest {
    package_format_version: u32,
    transfer_id: String,
    exported_at_unix_seconds: u64,
    database_file: String,
    schema_version: u32,
    image_count: usize,
}

fn copy_directory(source: &Path, destination: &Path) -> Result<usize, String> {
    fs::create_dir_all(destination).map_err(|e| format!("Could not create photo staging folder: {e}"))?;
    let mut count = 0;
    for entry in fs::read_dir(source).map_err(|e| format!("Could not read item photos: {e}"))? {
        let entry = entry.map_err(|e| format!("Could not read item photo entry: {e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("Could not inspect item photo: {e}"))?;
        let target = destination.join(entry.file_name());
        if file_type.is_dir() {
            count += copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target).map_err(|e| format!("Could not copy item photo: {e}"))?;
            count += 1;
        } else {
            return Err("The item-images folder contains an unsupported filesystem entry.".to_string());
        }
    }
    Ok(count)
}

fn remove_staging(path: &Path) {
    let _ = fs::remove_dir_all(path);
}


fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

fn add_file_to_zip<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    source: &Path,
    archive_name: &str,
) -> Result<(), String> {
    let mut file = fs::File::open(source)
        .map_err(|error| format!("Could not open {} for ZIP export: {error}", source.display()))?;
    archive.start_file(archive_name, zip_options())
        .map_err(|error| format!("Could not add {archive_name} to transfer ZIP: {error}"))?;
    std::io::copy(&mut file, archive)
        .map_err(|error| format!("Could not write {archive_name} to transfer ZIP: {error}"))?;
    Ok(())
}

fn add_directory_to_zip<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    source: &Path,
    archive_prefix: &str,
) -> Result<usize, String> {
    archive.add_directory(format!("{}/", archive_prefix.trim_end_matches('/')), zip_options())
        .map_err(|error| format!("Could not add {archive_prefix} folder to transfer ZIP: {error}"))?;
    let mut count = 0usize;
    if !source.is_dir() {
        return Ok(count);
    }

    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not read {} for ZIP export: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read item photo entry: {error}"))?;
        let file_type = entry.file_type()
            .map_err(|error| format!("Could not inspect item photo: {error}"))?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let archive_name = format!("{}/{}", archive_prefix.trim_end_matches('/'), file_name);

        if file_type.is_dir() {
            count += add_directory_to_zip(archive, &entry.path(), &archive_name)?;
        } else if file_type.is_file() {
            add_file_to_zip(archive, &entry.path(), &archive_name)?;
            count += 1;
        } else {
            return Err("The item-images folder contains an unsupported filesystem entry.".to_string());
        }
    }
    Ok(count)
}

fn read_zip_entry<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Result<Vec<u8>, String> {
    let mut entry = archive.by_name(name)
        .map_err(|error| format!("Could not read {name} from transfer ZIP: {error}"))?;
    let mut bytes = Vec::new();
    entry.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not extract {name} from transfer ZIP: {error}"))?;
    Ok(bytes)
}

#[tauri::command]
pub fn export_master_package(app: AppHandle, destination: String) -> Result<String, String> {
    let destination = PathBuf::from(destination);
    if destination.extension().and_then(|v| v.to_str()) != Some("zip") {
        return Err("Choose a destination ending in .zip.".to_string());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not access export location: {e}"))?;
    }

    let database_name = if cfg!(debug_assertions) { "inventory-dev.db" } else { "inventory.db" };
    let database_path = app.path().app_config_dir().map_err(|e| format!("Could not resolve database directory: {e}"))?.join(database_name);
    if !database_path.is_file() {
        return Err(format!("The application database was not found at {}.", database_path.display()));
    }
    let images_path = app.path().app_data_dir().map_err(|e| format!("Could not resolve application data directory: {e}"))?.join("item-images");

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
    let transfer_id = format!("master-{stamp}-{}", std::process::id());
    let staging = std::env::temp_dir().join(format!("inventory-transfer-{transfer_id}"));
    remove_staging(&staging);
    fs::create_dir_all(staging.join("item-images")).map_err(|e| format!("Could not create transfer staging folder: {e}"))?;

    let archive_staging = std::env::temp_dir().join(format!("inventory-transfer-{transfer_id}.zip"));
    let result = (|| {
        let staged_db = staging.join("inventory.db");
        let connection = rusqlite::Connection::open(&database_path).map_err(|e| format!("Could not open database for backup: {e}"))?;
        let escaped_path = staged_db.to_string_lossy().replace('\'', "''");
        connection.execute_batch(&format!("VACUUM INTO '{escaped_path}';"))
            .map_err(|e| format!("Could not create a consistent SQLite backup: {e}"))?;
        let integrity: String = rusqlite::Connection::open(&staged_db)
            .and_then(|db| db.query_row("PRAGMA integrity_check", [], |row| row.get(0)))
            .map_err(|e| format!("Could not verify exported database: {e}"))?;
        if integrity != "ok" { return Err(format!("Exported database failed integrity check: {integrity}")); }

        let image_count = if images_path.is_dir() {
            copy_directory(&images_path, &staging.join("item-images"))?
        } else {
            0
        };
        let manifest = TransferManifest {
            package_format_version: 1,
            transfer_id,
            exported_at_unix_seconds: stamp,
            database_file: "inventory.db".to_string(),
            schema_version: SCHEMA_VERSION,
            image_count,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| format!("Could not create transfer manifest: {e}"))?;
        fs::write(staging.join("manifest.json"), manifest_bytes).map_err(|e| format!("Could not write transfer manifest: {e}"))?;

        let archive_file = fs::File::create(&archive_staging)
            .map_err(|error| format!("Could not create transfer ZIP: {error}"))?;
        let mut zip = ZipWriter::new(archive_file);
        add_file_to_zip(&mut zip, &staging.join("manifest.json"), "manifest.json")?;
        add_file_to_zip(&mut zip, &staged_db, "inventory.db")?;
        let zipped_image_count = add_directory_to_zip(
            &mut zip,
            &staging.join("item-images"),
            "item-images",
        )?;
        if zipped_image_count != image_count {
            return Err(format!(
                "Photo count changed while creating the transfer ZIP (copied {image_count}, archived {zipped_image_count})."
            ));
        }
        zip.finish().map_err(|error| format!("Could not finish transfer ZIP: {error}"))?;
        fs::rename(&archive_staging, &destination)
            .map_err(|e| format!("Could not save completed transfer ZIP: {e}"))?;
        Ok(format!("Master package exported successfully. Included {image_count} item photo file(s)."))
    })();
    let _ = fs::remove_file(&archive_staging);
    remove_staging(&staging);
    result
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedTransferManifest {
    package_format_version: u32,
    transfer_id: String,
    exported_at_unix_seconds: u64,
    database_file: String,
    schema_version: u32,
    image_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferValidationResult {
    transfer_id: String,
    exported_at_unix_seconds: u64,
    schema_version: u32,
    image_count: usize,
    database_integrity: String,
    message: String,
}

#[tauri::command]
pub fn validate_master_package(source: String) -> Result<TransferValidationResult, String> {
    use rusqlite::OpenFlags;

    let archive = PathBuf::from(source);
    if !archive.is_file() || archive.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("Select a valid .zip Master Transfer package.".to_string());
    }

    let archive_file = fs::File::open(&archive)
        .map_err(|error| format!("Could not open transfer ZIP: {error}"))?;
    let mut zip = ZipArchive::new(archive_file)
        .map_err(|error| format!("Could not read transfer ZIP: {error}"))?;
    let mut has_manifest = false;
    let mut has_database = false;
    let mut image_files = 0usize;
    let mut seen_entries = std::collections::HashSet::new();
    for index in 0..zip.len() {
        let entry = zip.by_index(index)
            .map_err(|error| format!("Could not inspect transfer ZIP entry: {error}"))?;
        let raw_name = entry.name().to_string();
        let name = raw_name.trim_end_matches('/');
        if !seen_entries.insert(raw_name.clone()) {
            return Err(format!("The ZIP contains a duplicate entry: {raw_name}"));
        }
        if name.is_empty() || name.starts_with('/') || name.contains('\\')
            || name.split('/').any(|part| part == ".." || part == ".")
        {
            return Err("The ZIP contains an unsafe file path.".to_string());
        }
        if name == "manifest.json" { has_manifest = true; }
        else if name == "inventory.db" { has_database = true; }
        else if name.starts_with("item-images/") && !entry.is_dir() {
            if name.len() <= "item-images/".len() {
                return Err("The ZIP contains an invalid photo path.".to_string());
            }
            image_files += 1;
        } else if name != "item-images" && name != "item-images/" && !name.starts_with("item-images/") {
            return Err(format!("The ZIP contains an unexpected entry: {name}"));
        }
    }
    if !has_manifest || !has_database {
        return Err("The package must contain manifest.json and inventory.db.".to_string());
    }

    let manifest_bytes = read_zip_entry(&mut zip, "manifest.json")?;
    let manifest: ImportedTransferManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("The transfer manifest is invalid: {error}"))?;
    if manifest.package_format_version != 1 {
        return Err(format!("Unsupported package format version {}. This application supports version 1.", manifest.package_format_version));
    }
    if manifest.transfer_id.trim().is_empty() || manifest.database_file != "inventory.db" {
        return Err("The transfer manifest is missing required package information.".to_string());
    }
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!("Incompatible database schema. Package version: {}; application version: {}.", manifest.schema_version, SCHEMA_VERSION));
    }
    if image_files != manifest.image_count {
        return Err(format!("Photo count mismatch. Manifest reports {}; ZIP contains {} photo file(s).", manifest.image_count, image_files));
    }

    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|error| error.to_string())?.as_millis();
    let staged_db = std::env::temp_dir().join(format!("inventory-validate-{stamp}.db"));
    let database_bytes = read_zip_entry(&mut zip, "inventory.db")?;
    fs::write(&staged_db, database_bytes).map_err(|error| format!("Could not stage database for validation: {error}"))?;
    let validation = (|| {
        let db = rusqlite::Connection::open_with_flags(&staged_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("The package database cannot be opened: {error}"))?;
        let integrity: String = db.query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|error| format!("Could not check database integrity: {error}"))?;
        if integrity != "ok" { return Err(format!("Database integrity check failed: {integrity}")); }
        let migration_table_exists: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations')", [], |row| row.get(0)
        ).map_err(|error| format!("Could not inspect database migration history: {error}"))?;
        if !migration_table_exists { return Err("The database does not contain the application's migration history.".to_string()); }
        let (successful, earliest, latest, version_sum): (i64, i64, i64, i64) = db.query_row(
            "SELECT COUNT(*), COALESCE(MIN(version), 0), COALESCE(MAX(version), 0), COALESCE(SUM(version), 0) FROM _sqlx_migrations WHERE success = 1", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        ).map_err(|error| format!("Could not read database migration history: {error}"))?;
        let expected_sum = (SCHEMA_VERSION as i64 * (SCHEMA_VERSION as i64 + 1)) / 2;
        if successful != SCHEMA_VERSION as i64 || earliest != 1 || latest != SCHEMA_VERSION as i64 || version_sum != expected_sum {
            return Err(format!("Database migration history is incomplete or incompatible (successful migrations: {successful}, latest version: {latest}). Expected versions 1 through {SCHEMA_VERSION}.") );
        }
        let failed: i64 = db.query_row("SELECT COUNT(*) FROM _sqlx_migrations WHERE success = 0", [], |row| row.get(0))
            .map_err(|error| format!("Could not verify migration history: {error}"))?;
        if failed > 0 { return Err("The database contains failed migrations and cannot be imported.".to_string()); }
        Ok(integrity)
    })();
    let _ = fs::remove_file(&staged_db);
    let integrity = validation?;

    Ok(TransferValidationResult {
        transfer_id: manifest.transfer_id,
        exported_at_unix_seconds: manifest.exported_at_unix_seconds,
        schema_version: manifest.schema_version,
        image_count: manifest.image_count,
        database_integrity: integrity,
        message: "Package validation passed. No existing application data was changed.".to_string(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImportResult {
    operation_id: String,
    transfer_id: String,
    image_count: usize,
    backup_directory: String,
    staging_directory: String,
    message: String,
}

fn copy_tree_for_import(source: &Path, destination: &Path) -> Result<usize, String> {
    if !source.exists() {
        fs::create_dir_all(destination)
            .map_err(|error| format!("Could not create empty item-images folder: {error}"))?;
        return Ok(0);
    }
    copy_directory(source, destination)
}

fn create_database_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("Could not prepare database backup destination: {error}"))?;
    }
    let connection = rusqlite::Connection::open(source)
        .map_err(|error| format!("Could not open the current database for backup: {error}"))?;
    let escaped = destination.to_string_lossy().replace('\'', "''");
    connection.execute_batch(&format!("VACUUM INTO '{escaped}';"))
        .map_err(|error| format!("Could not create a consistent database backup: {error}"))?;
    let integrity: String = rusqlite::Connection::open(destination)
        .and_then(|database| database.query_row("PRAGMA integrity_check", [], |row| row.get(0)))
        .map_err(|error| format!("Could not verify the database backup: {error}"))?;
    if integrity != "ok" {
        return Err(format!("The database backup failed its integrity check: {integrity}"));
    }
    Ok(())
}

/// Validates a package, creates a recoverable backup of the current local data,
/// and extracts the incoming package to a staging directory. It deliberately
/// does not replace any live application files; replacement is a later step.
#[tauri::command]
pub fn prepare_master_import(app: AppHandle, source: String) -> Result<PreparedImportResult, String> {
    // Revalidate at the point of use. The previous UI validation is not trusted
    // as authorization to stage a package that may have changed on disk.
    let validation = validate_master_package(source.clone())?;
    let archive = PathBuf::from(&source);

    let app_config_dir = app.path().app_config_dir()
        .map_err(|error| format!("Could not resolve the database directory: {error}"))?;
    let app_data_dir = app.path().app_data_dir()
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))?;
    let database_name = if cfg!(debug_assertions) { "inventory-dev.db" } else { "inventory.db" };
    let current_database = app_config_dir.join(database_name);
    if !current_database.is_file() {
        return Err(format!("The current local database was not found at {}. No data was changed.", current_database.display()));
    }
    let current_images = app_data_dir.join("item-images");

    let unique_stamp = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create transfer folder name: {error}"))?.as_millis();
    let operation_id = format!("{}-{unique_stamp}-{}", validation.transfer_id.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_', "_"), std::process::id());
    let backup_dir = app_data_dir.join("data-transfer-backups").join(&operation_id);
    let staging_dir = app_data_dir.join("data-transfer-staging").join(&operation_id);

    if backup_dir.exists() || staging_dir.exists() {
        return Err("A transfer operation with this identifier already exists. No data was changed.".to_string());
    }
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Could not create the backup directory: {error}"))?;

    let backup_result = (|| {
        create_database_snapshot(&current_database, &backup_dir.join("inventory.db"))?;
        copy_tree_for_import(&current_images, &backup_dir.join("item-images"))?;
        Ok::<(), String>(())
    })();
    if let Err(error) = backup_result {
        let _ = fs::remove_dir_all(&backup_dir);
        return Err(format!("Backup could not be completed. The live database and photos were not changed. {error}"));
    }

    if let Err(error) = fs::create_dir_all(&staging_dir) {
        return Err(format!("The backup was created at {}, but staging could not be created: {error}", backup_dir.display()));
    }
    // Extract entries directly through the ZIP library. Files are written as
    // regular files, so archived symlink metadata is never materialized.
    let extraction = (|| {
        let archive_file = fs::File::open(&archive)
            .map_err(|error| format!("Could not reopen transfer ZIP for staging: {error}"))?;
        let mut zip = ZipArchive::new(archive_file)
            .map_err(|error| format!("Could not read transfer ZIP for staging: {error}"))?;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)
                .map_err(|error| format!("Could not inspect transfer ZIP entry: {error}"))?;
            if entry.is_dir() {
                continue;
            }
            let entry_name = entry.name().to_string();
            let relative = Path::new(&entry_name);
            if relative.is_absolute()
                || relative.components().any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err("The ZIP contains an unsafe staging path.".to_string());
            }
            let destination = staging_dir.join(relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Could not create staging folder: {error}"))?;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)
                .map_err(|error| format!("Could not extract {entry_name} from transfer ZIP: {error}"))?;
            fs::write(&destination, bytes)
                .map_err(|error| format!("Could not write staged package file: {error}"))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(format!("Backup was safely created at {}. Staging failed and live data was not changed. {error}", backup_dir.display()));
    }

    // Verify the staged files independently of the archive-level validation.
    let staged_database = staging_dir.join("inventory.db");
    let staged_integrity: Result<String, String> = rusqlite::Connection::open_with_flags(
        &staged_database,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ).map_err(|error| format!("Could not open staged database: {error}"))
      .and_then(|database| database.query_row("PRAGMA integrity_check", [], |row| row.get(0))
          .map_err(|error| format!("Could not verify staged database: {error}")));
    match staged_integrity {
        Ok(value) if value == "ok" => {}
        Ok(value) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(format!("Backup is at {}. Staged database integrity check failed: {value}. Live data was not changed.", backup_dir.display()));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(format!("Backup is at {}. {error}. Live data was not changed.", backup_dir.display()));
        }
    }
    if !staging_dir.join("manifest.json").is_file() || !staging_dir.join("item-images").is_dir() {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(format!("Backup is at {}. Staged package is incomplete. Live data was not changed.", backup_dir.display()));
    }

    Ok(PreparedImportResult {
        operation_id: operation_id.clone(),
        transfer_id: validation.transfer_id,
        image_count: validation.image_count,
        backup_directory: backup_dir.to_string_lossy().into_owned(),
        staging_directory: staging_dir.to_string_lossy().into_owned(),
        message: "Package revalidated. A verified backup was created and the incoming package was staged. Your live database and photos have not been replaced.".to_string(),
    })
}


#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingImportJournal {
    operation_id: String,
    state: String,
    created_at_unix_millis: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportCompletion {
    success: bool,
    message: String,
    completed_at_unix_millis: u128,
}

fn safe_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 180
        && value.chars().all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Invalid transfer journal path.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not create transfer journal directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| format!("Could not serialize transfer journal: {error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("Could not write transfer journal: {error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("Could not commit transfer journal: {error}"))
}

fn verify_database_file(path: &Path) -> Result<(), String> {
    let database = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Could not open database {}: {error}", path.display()))?;
    let integrity: String = database.query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|error| format!("Could not check database integrity: {error}"))?;
    if integrity != "ok" {
        return Err(format!("Database integrity check failed for {}: {integrity}", path.display()));
    }
    Ok(())
}

fn copy_tree_replace(source: &Path, destination: &Path) -> Result<(), String> {
    let temporary = destination.with_extension("transfer-new");
    if temporary.exists() {
        fs::remove_dir_all(&temporary).map_err(|error| format!("Could not clear temporary photo folder: {error}"))?;
    }
    copy_tree_for_import(source, &temporary)?;
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| format!("Could not replace existing photo folder: {error}"))?;
    }
    fs::rename(&temporary, destination).map_err(|error| format!("Could not activate imported photo folder: {error}"))
}

fn copy_database_replace(source: &Path, destination: &Path) -> Result<(), String> {
    verify_database_file(source)?;
    let parent = destination.parent().ok_or_else(|| "Invalid database destination.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Could not access database directory: {error}"))?;
    let temporary = parent.join(format!(".inventory-import-{}.db", std::process::id()));
    if temporary.exists() {
        fs::remove_file(&temporary).map_err(|error| format!("Could not clear temporary database: {error}"))?;
    }
    fs::copy(source, &temporary).map_err(|error| format!("Could not stage imported database beside the live database: {error}"))?;
    verify_database_file(&temporary)?;

    // The app is not running at startup, so no SQL connection should be open.
    // Remove stale sidecars before activating the new database.
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", destination.to_string_lossy(), suffix));
        if sidecar.exists() {
            fs::remove_file(&sidecar).map_err(|error| format!("Could not remove stale SQLite sidecar {}: {error}", sidecar.display()))?;
        }
    }
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| format!("Could not replace existing database: {error}"))?;
    }
    fs::rename(&temporary, destination).map_err(|error| format!("Could not activate imported database: {error}"))
}

fn restore_from_backup(
    database_backup: &Path,
    images_backup: &Path,
    database_destination: &Path,
    images_destination: &Path,
) -> Result<(), String> {
    copy_database_replace(database_backup, database_destination)?;
    copy_tree_replace(images_backup, images_destination)?;
    Ok(())
}

fn write_import_completion(app_data_dir: &Path, success: bool, message: String) -> Result<(), String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not timestamp import result: {error}"))?.as_millis();
    write_json_atomically(&app_data_dir.join("data-transfer-last-result.json"), &ImportCompletion {
        success,
        message,
        completed_at_unix_millis: now,
    })
}

/// Schedules the already-prepared import and exits the app. The next launch
/// applies it before the frontend can open the SQLite connection.
#[tauri::command]
pub fn schedule_master_import(app: AppHandle, operation_id: String) -> Result<String, String> {
    if !safe_operation_id(&operation_id) {
        return Err("Invalid import operation identifier.".to_string());
    }
    let app_data_dir = app.path().app_data_dir().map_err(|error| format!("Could not resolve application data directory: {error}"))?;
    let journal_path = app_data_dir.join("data-transfer-pending.json");
    if journal_path.exists() {
        return Err("Another data import is already pending. Restart the application to finish recovery before scheduling another import.".to_string());
    }
    let backup_dir = app_data_dir.join("data-transfer-backups").join(&operation_id);
    let staging_dir = app_data_dir.join("data-transfer-staging").join(&operation_id);
    let database_backup = backup_dir.join("inventory.db");
    let images_backup = backup_dir.join("item-images");
    let staged_database = staging_dir.join("inventory.db");
    let staged_images = staging_dir.join("item-images");
    if !database_backup.is_file() || !images_backup.is_dir() || !staged_database.is_file() || !staged_images.is_dir() {
        return Err("The prepared import is incomplete. No files were replaced; prepare the package again.".to_string());
    }
    verify_database_file(&database_backup)?;
    verify_database_file(&staged_database)?;

    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not timestamp import operation: {error}"))?.as_millis();
    write_json_atomically(&journal_path, &PendingImportJournal {
        operation_id,
        state: "pending".to_string(),
        created_at_unix_millis: now,
    })?;

    #[cfg(debug_assertions)]
{
    eprintln!("[schedule_master_import] Debug restart block reached.");

    let restart_marker = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(".dev-restart-request");

    eprintln!(
        "[schedule_master_import] Writing marker: {}",
        restart_marker.display()
    );

    fs::write(&restart_marker, b"restart")
        .map_err(|error| {
            format!(
                "Import is safely scheduled, but the development restart signal could not be written: {error}"
            )
        })?;

    eprintln!("[schedule_master_import] Marker written successfully.");

    let app_handle = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));

        eprintln!("[schedule_master_import] Requesting application exit.");
        app_handle.exit(0);
    });
}

Ok("Import scheduled. The application will restart and apply the Master package.".to_string())
}

/// Runs from Tauri setup before the React frontend loads. An interrupted
/// `applying` operation is rolled back from the verified backup on next launch.
#[tauri::command]
pub fn get_data_transfer_import_result(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| format!("Could not resolve application data directory: {error}"))?;
    let result_path = app_data_dir.join("data-transfer-last-result.json");
    if !result_path.is_file() {
        return Ok(None);
    }
    let bytes = fs::read(&result_path).map_err(|error| format!("Could not read last import result: {error}"))?;
    let value = serde_json::from_slice(&bytes).map_err(|error| format!("Last import result is invalid: {error}"))?;
    // This is a one-time completion notice. Remove the persisted result after
    // reading it so revisiting Data Transfer does not replay an old message.
    fs::remove_file(&result_path)
        .map_err(|error| format!("Could not acknowledge the previous import result: {error}"))?;
    Ok(Some(value))
}

pub fn apply_pending_import(app: &tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|error| format!("Could not resolve application data directory: {error}"))?;
    let journal_path = app_data_dir.join("data-transfer-pending.json");
    if !journal_path.is_file() {
        return Ok(());
    }
    let journal_bytes = fs::read(&journal_path).map_err(|error| format!("Could not read pending import journal: {error}"))?;
    let mut journal: PendingImportJournal = serde_json::from_slice(&journal_bytes)
        .map_err(|error| format!("Pending import journal is corrupt. Do not use the app until it is recovered: {error}"))?;
    if !safe_operation_id(&journal.operation_id) {
        return Err("Pending import journal contains an invalid operation ID. Startup stopped to protect application data.".to_string());
    }

    let backup_dir = app_data_dir.join("data-transfer-backups").join(&journal.operation_id);
    let staging_dir = app_data_dir.join("data-transfer-staging").join(&journal.operation_id);
    let database_backup = backup_dir.join("inventory.db");
    let images_backup = backup_dir.join("item-images");
    let staged_database = staging_dir.join("inventory.db");
    let staged_images = staging_dir.join("item-images");
    let config_dir = app.path().app_config_dir().map_err(|error| format!("Could not resolve database directory: {error}"))?;
    let database_name = if cfg!(debug_assertions) { "inventory-dev.db" } else { "inventory.db" };
    let database_destination = config_dir.join(database_name);
    let images_destination = app_data_dir.join("item-images");

    if journal.state == "applying" {
        // A prior launch was interrupted during replacement. Never retry the
        // destructive operation; restore the known-good pre-import backup.
        restore_from_backup(&database_backup, &images_backup, &database_destination, &images_destination)
            .map_err(|error| format!("Automatic recovery failed. Keep the app closed and preserve backup at {}. {error}", backup_dir.display()))?;
        fs::remove_file(&journal_path).map_err(|error| format!("Recovered the previous data, but could not clear the journal: {error}"))?;
        write_import_completion(&app_data_dir, false, format!("The previous import was interrupted. Your previous database and photos were restored from {}.", backup_dir.display()))?;
        return Ok(());
    }
    if journal.state != "pending" {
        return Err("Pending import journal has an unknown state. Startup stopped to protect application data.".to_string());
    }
    if !database_backup.is_file() || !images_backup.is_dir() || !staged_database.is_file() || !staged_images.is_dir() {
        return Err(format!("Pending import files are incomplete. Startup stopped; preserve the backup at {}.", backup_dir.display()));
    }

    journal.state = "applying".to_string();
    write_json_atomically(&journal_path, &journal)?;

    let apply_result = (|| {
        copy_database_replace(&staged_database, &database_destination)?;
        copy_tree_replace(&staged_images, &images_destination)?;
        verify_database_file(&database_destination)?;
        Ok::<(), String>(())
    })();

    match apply_result {
        Ok(()) => {
            fs::remove_file(&journal_path).map_err(|error| format!("Import completed, but the journal could not be cleared. On next launch recovery may restore the previous data: {error}"))?;
            let _ = fs::remove_dir_all(&staging_dir);
            write_import_completion(&app_data_dir, true, "Master database and item photos were imported successfully.".to_string())?;
            Ok(())
        }
        Err(import_error) => {
            restore_from_backup(&database_backup, &images_backup, &database_destination, &images_destination)
                .map_err(|rollback_error| format!("Import failed: {import_error}. Automatic rollback also failed: {rollback_error}. Keep the app closed and preserve backup at {}.", backup_dir.display()))?;
            fs::remove_file(&journal_path).map_err(|error| format!("Import failed and previous data was restored, but the journal could not be cleared: {error}"))?;
            write_import_completion(&app_data_dir, false, format!("Import failed and your previous database and photos were restored. Reason: {import_error}"))?;
            Ok(())
        }
    }
}
