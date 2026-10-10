
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from the Rust backend!", name)
}

#[cfg(debug_assertions)]
mod dev_seed;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_schema = include_str!("../../src/db/migrations/001_initial_schema.sql");
    let initial_categories = include_str!("../../src/db/migrations/002_initial_categories.sql");

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
        ]
    };


    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:inventory-dev.db", migrations())
                .add_migrations("sqlite:inventory.db", migrations())
                .build(),
        );

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        dev_seed::seed_dev_inventory,
        dev_seed::clean_dev_inventory
    ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![greet]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
