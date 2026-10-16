use rusqlite::{params, Connection, TransactionBehavior};
use tauri::{AppHandle, Manager};

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let database_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve database directory: {error}"))?;
    let database_name = if cfg!(debug_assertions) {
        "inventory-dev.db"
    } else {
        "inventory.db"
    };
    let path = database_dir.join(database_name);
    if !path.exists() {
        return Err("Database not found. Start the application and let migrations run first.".to_string());
    }
    let connection = Connection::open(path)
        .map_err(|error| format!("Could not open database: {error}"))?;
    connection.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable foreign keys: {error}"))?;
    Ok(connection)
}

#[tauri::command]
pub fn save_wastage_settings(app: AppHandle, mode: String, value: i64) -> Result<(), String> {
    if !matches!(mode.as_str(), "percent" | "per_gram") {
        return Err("Invalid wastage mode.".to_string());
    }
    if value < 0 || (mode == "percent" && value > 10_000) {
        return Err("Wastage value is outside the supported range.".to_string());
    }

    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start settings transaction: {error}"))?;

    let rate_key = if mode == "percent" { "wastage_percent_bp" } else { "wastage_per_g_paise" };
    transaction.execute(
        "UPDATE global_rate SET value = ?, updated_at = datetime('now','localtime') WHERE rate_key = ?",
        params![value, rate_key],
    ).map_err(|error| format!("Could not save wastage rate: {error}"))?;
    transaction.execute(
        "INSERT INTO app_setting (key, value) VALUES ('wastage_mode', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')",
        [&mode],
    ).map_err(|error| format!("Could not save wastage mode: {error}"))?;
    transaction.commit().map_err(|error| format!("Could not commit wastage settings: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_gst_settings(app: AppHandle, gst_rate_bp: i64, business_state: String) -> Result<(), String> {
    if !(0..=10_000).contains(&gst_rate_bp) {
        return Err("GST rate must be between 0% and 100%.".to_string());
    }
    let business_state = business_state.trim();
    if business_state.is_empty() {
        return Err("Business state is required.".to_string());
    }

    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start settings transaction: {error}"))?;
    transaction.execute(
        "INSERT INTO app_setting (key, value) VALUES ('gst_rate_bp', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')",
        [gst_rate_bp.to_string()],
    ).map_err(|error| format!("Could not save GST rate: {error}"))?;
    transaction.execute(
        "INSERT INTO app_setting (key, value) VALUES ('business_state', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now','localtime')",
        [business_state],
    ).map_err(|error| format!("Could not save business state: {error}"))?;
    transaction.commit().map_err(|error| format!("Could not commit GST settings: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_category_settings(
    app: AppHandle,
    category_id: Option<i64>,
    name: String,
    prefix: String,
    next_number: i64,
    number_width: i64,
    range_end: Option<i64>,
    sort_order: i64,
) -> Result<(), String> {
    let name = name.trim();
    let prefix = prefix.trim();
    if name.is_empty() {
        return Err("Category name is required.".to_string());
    }
    if next_number < 1 || number_width < 0 || range_end.is_some_and(|end| end < 1) {
        return Err("Category numbering values are invalid.".to_string());
    }

    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start category transaction: {error}"))?;

    if let Some(category_id) = category_id {
        let (series_id, current_next): (i64, i64) = transaction.query_row(
            "SELECT series_id, next_number FROM category JOIN item_series ON item_series.id = category.series_id WHERE category.id = ?",
            [category_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|error| format!("Could not load category numbering: {error}"))?;

        if next_number < current_next {
            return Err("Next number cannot move backwards. Item numbers are never reused.".to_string());
        }
        transaction.execute(
            "UPDATE item_series SET name = ?, prefix = ?, next_number = ?, number_width = ?, range_end = ? WHERE id = ?",
            params![name, prefix, next_number, number_width, range_end, series_id],
        ).map_err(|error| format!("Could not save numbering series: {error}"))?;
        transaction.execute(
            "UPDATE category SET name = ?, sort_order = ? WHERE id = ?",
            params![name, sort_order, category_id],
        ).map_err(|error| format!("Could not save category: {error}"))?;
    } else {
        transaction.execute(
            "INSERT INTO item_series (name, prefix, next_number, number_width, range_end) VALUES (?, ?, ?, ?, ?)",
            params![name, prefix, next_number, number_width, range_end],
        ).map_err(|error| format!("Could not create numbering series: {error}"))?;
        let series_id = transaction.last_insert_rowid();
        transaction.execute(
            "INSERT INTO category (name, series_id, sort_order) VALUES (?, ?, ?)",
            params![name, series_id, sort_order],
        ).map_err(|error| format!("Could not create category: {error}"))?;
    }

    transaction.commit().map_err(|error| format!("Could not commit category settings: {error}"))?;
    Ok(())
}
