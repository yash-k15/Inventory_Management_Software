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

    let image_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve application data directory: {error}"))?
        .join("item-images")
        .canonicalize()
        .map_err(|error| format!("Could not resolve item image directory: {error}"))?;

    let path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("Could not resolve image path: {error}"))?;

    if !path.is_file() {
        return Err("The selected image is not a valid file.".to_string());
    }

    if !path.starts_with(&image_directory) {
        return Err("Only images stored in the application's item-images folder can be previewed here.".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| format!("Could not authorize image preview: {error}"))
}

#[tauri::command]
async fn pick_item_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let selected = app
        .dialog()
        .file()
        .add_filter(
            "Jewelry images",
            &["jpg", "jpeg", "png", "webp", "heic", "heif"],
        )
        .blocking_pick_file();

    let Some(selected) = selected else {
        return Ok(None);
    };

    let selected_path = selected
        .into_path()
        .map_err(|error| format!("Could not resolve selected image: {error}"))?;
    let selected_path = selected_path
        .canonicalize()
        .map_err(|error| format!("Could not resolve selected image: {error}"))?;

    if !selected_path.is_file() {
        return Err("The selected image is not a valid file.".to_string());
    }

    let extension = selected_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png", "webp", "heic", "heif"].contains(&extension.as_str()) {
        return Err("Please select a JPG, PNG, WEBP, HEIC, or HEIF image.".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&selected_path)
        .map_err(|error| format!("Could not authorize selected image preview: {error}"))?;

    Ok(Some(selected_path.to_string_lossy().into_owned()))
}


#[tauri::command]
fn write_export_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(std::path::Path::new(&path), bytes)
        .map_err(|error| format!("Could not save export file: {error}"))
}


fn build_tag_print_job(bitmap: &[u8]) -> Vec<u8> {
    let mut job = Vec::with_capacity(256 + bitmap.len());
    job.extend_from_slice(
        b"SIZE 100 mm,13 mm\r\nGAP 3 mm,0 mm\r\nSPEED 2\r\nDENSITY 13\r\nSET RIBBON ON\r\nDIRECTION 0,0\r\nREFERENCE 0,0\r\nOFFSET 0 mm\r\nSET PEEL OFF\r\nSET CUTTER OFF\r\nSET PARTIAL_CUTTER OFF\r\nSET TEAR ON\r\nCLS\r\nBITMAP 0,0,100,104,1,"
    );
    job.extend_from_slice(bitmap);
    job.extend_from_slice(b"\r\nPRINT 1,1\r\n");
    job
}

#[cfg(target_os = "windows")]
mod windows_raw_printer {
    use std::ffi::c_void;
    use std::ptr;

    type Handle = *mut c_void;
    type Bool = i32;
    type Dword = u32;

    #[repr(C)]
    struct DocInfo1W {
        document_name: *mut u16,
        output_file: *mut u16,
        data_type: *mut u16,
    }

    #[link(name = "Winspool.drv")]
    extern "system" {
        fn OpenPrinterW(
            printer_name: *const u16,
            printer: *mut Handle,
            defaults: *const c_void,
        ) -> Bool;
        fn ClosePrinter(printer: Handle) -> Bool;
        fn StartDocPrinterW(
            printer: Handle,
            level: Dword,
            document_info: *const DocInfo1W,
        ) -> Dword;
        fn EndDocPrinter(printer: Handle) -> Bool;
        fn StartPagePrinter(printer: Handle) -> Bool;
        fn EndPagePrinter(printer: Handle) -> Bool;
        fn WritePrinter(
            printer: Handle,
            buffer: *const c_void,
            bytes_to_write: Dword,
            bytes_written: *mut Dword,
        ) -> Bool;
    }

    fn win_error(action: &str) -> String {
        format!("{action}: {}", std::io::Error::last_os_error())
    }

    pub fn print_raw(printer_queue: &str, data: &[u8]) -> Result<String, String> {
        let mut printer_name: Vec<u16> = printer_queue.encode_utf16().chain(Some(0)).collect();
        let mut document_name: Vec<u16> = "Jewelry tag".encode_utf16().chain(Some(0)).collect();
        let mut data_type: Vec<u16> = "RAW".encode_utf16().chain(Some(0)).collect();

        let mut printer: Handle = ptr::null_mut();
        let opened = unsafe {
            OpenPrinterW(printer_name.as_mut_ptr(), &mut printer, ptr::null())
        };
        if opened == 0 {
            return Err(win_error(&format!(
                "Could not open Windows printer queue '{printer_queue}'"
            )));
        }

        let mut result = Ok(String::new());
        let document_info = DocInfo1W {
            document_name: document_name.as_mut_ptr(),
            output_file: ptr::null_mut(),
            data_type: data_type.as_mut_ptr(),
        };

        let job_id = unsafe { StartDocPrinterW(printer, 1, &document_info) };
        if job_id == 0 {
            result = Err(win_error("Could not start the RAW printer job"));
        } else {
            let page_started = unsafe { StartPagePrinter(printer) };
            if page_started == 0 {
                result = Err(win_error("Could not start the printer page"));
            } else {
                let mut offset = 0usize;
                while offset < data.len() {
                    let remaining = data.len() - offset;
                    let chunk_len = remaining.min(Dword::MAX as usize) as Dword;
                    let mut bytes_written: Dword = 0;
                    let written = unsafe {
                        WritePrinter(
                            printer,
                            data[offset..].as_ptr() as *const c_void,
                            chunk_len,
                            &mut bytes_written,
                        )
                    };

                    if written == 0 {
                        result = Err(win_error("Could not write tag data to the printer"));
                        break;
                    }
                    if bytes_written == 0 {
                        result = Err(
                            "The Windows printer accepted zero bytes for the tag print job."
                                .to_string(),
                        );
                        break;
                    }
                    offset += bytes_written as usize;
                }

                if unsafe { EndPagePrinter(printer) } == 0 && result.is_ok() {
                    result = Err(win_error("Could not finish the printer page"));
                }
            }

            if unsafe { EndDocPrinter(printer) } == 0 && result.is_ok() {
                result = Err(win_error("Could not finish the RAW printer job"));
            }
        }

        if unsafe { ClosePrinter(printer) } == 0 && result.is_ok() {
            result = Err(win_error("Could not close the Windows printer queue"));
        }

        result.map(|_| format!("Tag print job {job_id} submitted to {printer_queue}."))
    }
}

#[tauri::command]
fn print_tag_bitmap(bitmap: Vec<u8>) -> Result<String, String> {
    const EXPECTED_BITMAP_BYTES: usize = 100 * 104;
    const PRINTER_QUEUE: &str = "TSC_TE244";

    if bitmap.len() != EXPECTED_BITMAP_BYTES {
        return Err(format!(
            "Invalid tag bitmap: expected {EXPECTED_BITMAP_BYTES} bytes, received {}.",
            bitmap.len()
        ));
    }

    let job = build_tag_print_job(&bitmap);

    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new("lp")
            .args(["-d", PRINTER_QUEUE, "-o", "raw"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Could not start macOS printing: {error}"))?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(&job)
                .map_err(|error| format!("Could not send tag data to the print queue: {error}"))?;
        }

        let output = child
            .wait_with_output()
            .map_err(|error| format!("Could not finish submitting the print job: {error}"))?;
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
            format!("Tag print job submitted to {PRINTER_QUEUE}.")
        } else {
            message
        })
    }

    #[cfg(target_os = "windows")]
    {
        windows_raw_printer::print_raw(PRINTER_QUEUE, &job)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = job;
        Err("Direct tag printing is supported only on macOS and Windows.".to_string())
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
    let stone_weights_in_carats = include_str!("../../src/db/migrations/017_stone_weights_in_carats.sql");

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
            Migration {
                version: 17,
                description: "standardize all other-stone weights to carats",
                sql: stone_weights_in_carats,
                kind: MigrationKind::Up,
            },
        ]
    };

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
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
        pick_item_image,
        print_tag_bitmap,
        write_export_file,
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
        pick_item_image,
        print_tag_bitmap,
        write_export_file,
        item_number::update_item,
        item_number::preview_item_number,
        item_number::create_item,
        customer::create_customer,
        customer::update_customer,
        customer::set_customer_archived,
        customer::delete_archived_customer,
        customer::merge_customers,
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
