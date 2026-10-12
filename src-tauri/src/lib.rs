use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from the Rust backend!", name)
}

#[cfg(debug_assertions)]
mod dev_seed;
mod item_number;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_schema = include_str!("../../src/db/migrations/001_initial_schema.sql");
    let initial_categories = include_str!("../../src/db/migrations/002_initial_categories.sql");
    let jewelry_reference_data = include_str!("../../src/db/migrations/003_jewelry_reference_data.sql");
    let igi_certificate_number = include_str!("../../src/db/migrations/004_igi_certificate_number.sql");
    let remove_is_certified = include_str!("../../src/db/migrations/005_remove_is_certified.sql");

    let migrations = || {
        vec![
            Migration {
                version: 1,
                description: "initial database schema",
                sql: initial_schema,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 2,
                description: "initial jewelry categories",
                sql: initial_categories,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 3,
                description: "initial jewelry reference data",
                sql: jewelry_reference_data,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 4,
                description: "add IGI certificate number",
                sql: igi_certificate_number,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 5,
                description: "remove redundant certification boolean",
                sql: remove_is_certified,
                kind: MigrationKind::Up,
            },
            Migration {
                version: 6,
                description: "add gold types to inventory items",
                sql: include_str!("../../src/db/migrations/006_gold_type.sql"),
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
        );

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        allow_image_preview,
        item_number::preview_item_number,
        item_number::create_item,
        dev_seed::seed_dev_inventory,
        dev_seed::clean_dev_inventory
    ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        allow_image_preview,
        item_number::preview_item_number,
        item_number::create_item
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
