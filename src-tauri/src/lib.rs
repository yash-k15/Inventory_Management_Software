use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!(
        "Hello, {}! You've been greeted from the Tauri application!",
        name
    )
}

#[cfg(debug_assertions)]
mod dev_seed;
mod item_number;
mod customer;
mod settings;
mod order;
mod data_transfer;

#[tauri::command]
fn allow_image_preview(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::path::Path;

    let path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("Could not resolve image path: {error}"))?;

    if !path.is_file() {
        return Err("The selected image is not a valid file.".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("Could not authorize image preview: {error}"))
}


#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(std::path::Path::new(&path), bytes)
        .map_err(|error| format!("Could not save export file: {error}"))
}


#[tauri::command]
fn open_print_preview(bytes: Vec<u8>) -> Result<(), String> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(target_os = "macos")]
    {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Could not create print preview filename: {error}"))?
            .as_millis();
        let path = std::env::temp_dir().join(format!("inventory-print-{timestamp}.pdf"));
        std::fs::write(&path, bytes)
            .map_err(|error| format!("Could not prepare print preview PDF: {error}"))?;
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Could not open the print preview PDF: {error}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (bytes, Command::new("open"));
        Err("Opening a print preview is currently configured for macOS.".to_string())
    }
}

#[tauri::command]
fn print_tag_bitmap(bitmap: Vec<u8>) -> Result<String, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    const EXPECTED_BITMAP_BYTES: usize = 100 * 104;
    if bitmap.len() != EXPECTED_BITMAP_BYTES {
        return Err(format!(
            "Invalid tag bitmap: expected {EXPECTED_BITMAP_BYTES} bytes, received {}.",
            bitmap.len()
        ));
    }

    #[cfg(target_os = "macos")]
    {
        let mut child = Command::new("lp")
            .args(["-d", "TSC_TE244", "-o", "raw"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Could not start macOS printing: {error}"))?;

        let mut job = Vec::with_capacity(128 + EXPECTED_BITMAP_BYTES);
        job.extend_from_slice(
            b"SIZE 100 mm,13 mm\r\nGAP 3 mm,0 mm\r\nSPEED 2\r\nDENSITY 13\r\nSET RIBBON ON\r\nDIRECTION 0,0\r\nREFERENCE 0,0\r\nOFFSET 0 mm\r\nSET PEEL OFF\r\nSET CUTTER OFF\r\nSET PARTIAL_CUTTER OFF\r\nSET TEAR ON\r\nCLS\r\nBITMAP 0,0,100,104,1,"
        );
        job.extend_from_slice(&bitmap);
        job.extend_from_slice(b"\r\nPRINT 1,1\r\n");

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(&job).map_err(|error| format!("Could not send tag data to the print queue: {error}"))?;
        }

        let output = child.wait_with_output().map_err(|error| format!("Could not finish submitting the print job: {error}"))?;
        if !output.status.success() {
            let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if details.is_empty() {
                format!("macOS printing failed with status {}.", output.status)
            } else {
                format!("macOS printing failed: {details}")
            });
        }

        let message = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if message.is_empty() {
            "Tag print job submitted to TSC_TE244.".to_string()
        } else {
            message
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = bitmap;
        Err("Direct tag printing is currently configured for macOS and the TSC_TE244 queue.".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_schema = include_str!("../../src/db/migrations/001_initial_schema.sql");
    let initial_categories = include_str!("../../src/db/migrations/002_initial_categories.sql");
    let jewelry_reference_data = include_str!("../../src/db/migrations/003_jewelry_reference_data.sql");
    let igi_certificate_number = include_str!("../../src/db/migrations/004_igi_certificate_number.sql");
    let remove_is_certified = include_str!("../../src/db/migrations/005_remove_is_certified.sql");
    let net_weight = include_str!("../../src/db/migrations/007_net_weight.sql");
    let customer_contact_details = include_str!("../../src/db/migrations/008_customer_contact_details.sql");
    let settings_defaults = include_str!("../../src/db/migrations/009_settings_defaults.sql");
    let orders_migration = include_str!("../../src/db/migrations/010_orders.sql");
    let orders_safeguards = include_str!("../../src/db/migrations/011_orders_safeguards.sql");
    let activity_log = include_str!("../../src/db/migrations/012_activity_log.sql");
    let activity_operation_id = include_str!("../../src/db/migrations/013_activity_operation_id.sql");
    let order_final_total = include_str!("../../src/db/migrations/014_order_final_total.sql");
    let order_notes_and_final_total = include_str!("../../src/db/migrations/015_order_notes_and_final_total.sql");
    let order_linked_payments = include_str!("../../src/db/migrations/016_order_linked_payments.sql");

    let migrations = || {
        vec![
            Migration { version: 1, description: "initial database schema", sql: initial_schema, kind: MigrationKind::Up },
            Migration { version: 2, description: "initial jewelry categories", sql: initial_categories, kind: MigrationKind::Up },
            Migration { version: 3, description: "initial jewelry reference data", sql: jewelry_reference_data, kind: MigrationKind::Up },
            Migration { version: 4, description: "add IGI certificate number", sql: igi_certificate_number, kind: MigrationKind::Up },
            Migration { version: 5, description: "remove redundant certification boolean", sql: remove_is_certified, kind: MigrationKind::Up },
            Migration { version: 6, description: "add gold types to inventory items", sql: include_str!("../../src/db/migrations/006_gold_type.sql"), kind: MigrationKind::Up },
            Migration { version: 7, description: "add net weight to inventory items", sql: net_weight, kind: MigrationKind::Up },
            Migration { version: 8, description: "add optional customer contact details", sql: customer_contact_details, kind: MigrationKind::Up },
            Migration { version: 9, description: "initialize pricing settings defaults", sql: settings_defaults, kind: MigrationKind::Up },
            Migration { version: 10, description: "support multi-item and direct orders", sql: orders_migration, kind: MigrationKind::Up },
            Migration { version: 11, description: "add order integrity safeguards", sql: orders_safeguards, kind: MigrationKind::Up },
            Migration { version: 12, description: "add inventory and selection activity log", sql: activity_log, kind: MigrationKind::Up },
            Migration { version: 13, description: "add operation id to activity log", sql: activity_operation_id, kind: MigrationKind::Up },
            Migration { version: 14, description: "support final order total overrides", sql: order_final_total, kind: MigrationKind::Up },
            Migration {
                version: 15,
                description: "persist order notes and final rounded total",
                sql: order_notes_and_final_total,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 16,
                description: "link payments to individual orders",
                sql: order_linked_payments,
                kind: MigrationKind::Up,
            },
        ]
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:inventory-dev.db", migrations())
                .add_migrations("sqlite:inventory.db", migrations())
                .build(),
        )
        .setup(|app| {
            data_transfer::apply_pending_import(app.handle())
                .map_err(std::io::Error::other)?;
            Ok(())
        });

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        allow_image_preview,
        print_tag_bitmap,
        write_export_file,
        open_print_preview,
        item_number::preview_item_number,
        item_number::create_item,
        item_number::update_item,
        dev_seed::seed_dev_inventory,
        dev_seed::clean_dev_inventory,
        customer::create_customer,
        customer::update_customer,
        customer::set_customer_archived,
        customer::delete_archived_customer,
        customer::merge_customers,
        settings::save_wastage_settings,
        settings::save_gst_settings,
        settings::save_category_settings,
        order::create_confirmed_order,
        data_transfer::export_master_package,
        data_transfer::validate_master_package,
        data_transfer::prepare_master_import,
        data_transfer::schedule_master_import,
        data_transfer::get_data_transfer_import_result,
    ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        allow_image_preview,
        print_tag_bitmap,
        write_export_file,
        open_print_preview,
        item_number::update_item,
        item_number::preview_item_number,
        item_number::create_item,
        customer::create_customer,
        customer::update_customer,
        customer::set_customer_archived,
        customer::delete_archived_customer,
        customer::merge_customers,
        settings::save_wastage_settings,
        settings::save_gst_settings,
        settings::save_category_settings,
        order::create_confirmed_order,
        data_transfer::export_master_package,
        data_transfer::validate_master_package,
        data_transfer::prepare_master_import,
        data_transfer::schedule_master_import,
        data_transfer::get_data_transfer_import_result,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
