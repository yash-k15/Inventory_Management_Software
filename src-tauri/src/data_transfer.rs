use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, process::Command, time::{SystemTime, UNIX_EPOCH}};
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

        let output = Command::new("/usr/bin/zip")
            .args(["-q", "-r", archive_staging.to_string_lossy().as_ref(), "manifest.json", "inventory.db", "item-images"])
            .current_dir(&staging)
            .output()
            .map_err(|e| format!("Could not start the macOS ZIP utility: {e}"))?;
        if !output.status.success() {
            let _ = fs::remove_file(&archive_staging);
            return Err(format!("Could not create transfer ZIP: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
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

fn run_unzip(args: &[&str], archive: &Path) -> Result<Vec<u8>, String> {
    let mut command = Command::new("/usr/bin/unzip");
    if args.first() == Some(&"-p") {
        command.arg("-p").arg(archive).args(&args[1..]);
    } else {
        command.args(args).arg(archive);
    }
    let output = command.output()
        .map_err(|error| format!("Could not start ZIP validation: {error}"))?;
    if !output.status.success() {
        return Err(format!("Could not read transfer ZIP: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(output.stdout)
}

#[tauri::command]
pub fn validate_master_package(source: String) -> Result<TransferValidationResult, String> {
    use rusqlite::OpenFlags;

    let archive = PathBuf::from(source);
    if !archive.is_file() || archive.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("Select a valid .zip Master Transfer package.".to_string());
    }

    let listing = run_unzip(&["-Z1"], &archive)?;
    let listing = String::from_utf8(listing).map_err(|_| "The ZIP file contains invalid entry names.".to_string())?;
    let mut has_manifest = false;
    let mut has_database = false;
    let mut image_files = 0usize;
    let mut seen_entries = std::collections::HashSet::new();
    for raw_name in listing.lines() {
        let name = raw_name.trim_end_matches('/');
        if !seen_entries.insert(raw_name.to_string()) {
            return Err(format!("The ZIP contains a duplicate entry: {raw_name}"));
        }
        if name.is_empty() || name.starts_with('/') || name.contains('\\') || name.split('/').any(|part| part == ".." || part == ".") {
            return Err("The ZIP contains an unsafe file path.".to_string());
        }
        if name == "manifest.json" { has_manifest = true; }
        else if name == "inventory.db" { has_database = true; }
        else if name.starts_with("item-images/") && !name.ends_with('/') {
            if name.len() <= "item-images/".len() {
                return Err("The ZIP contains an invalid photo path.".to_string());
            }
            image_files += 1;
        } else if name != "item-images" {
            return Err(format!("The ZIP contains an unexpected entry: {name}"));
        }
    }
    if !has_manifest || !has_database {
        return Err("The package must contain manifest.json and inventory.db.".to_string());
    }

    let manifest_bytes = run_unzip(&["-p", "manifest.json"], &archive)?;
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
    let database_bytes = run_unzip(&["-p", "inventory.db"], &archive)?;
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
