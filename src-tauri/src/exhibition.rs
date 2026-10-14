use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExhibitionInput {
    pub name: String,
    pub location: Option<String>,
    pub start_date: String,
    pub end_date: String,
    pub notes: Option<String>,
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let database_dir = app.path().app_config_dir()
        .map_err(|error| format!("Could not resolve database directory: {error}"))?;
    let database_name = if cfg!(debug_assertions) { "inventory-dev.db" } else { "inventory.db" };
    let database_path = database_dir.join(database_name);

    if !database_path.exists() {
        return Err("Database not found. Start the application and let its migrations run first.".to_string());
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Could not open database: {error}"))?;
    connection.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable foreign keys: {error}"))?;
    Ok(connection)
}

fn validate_input(input: &ExhibitionInput) -> Result<(String, Option<String>, String, String, Option<String>), String> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err("Exhibition name is required.".to_string());
    }
    if !valid_date(&input.start_date) || !valid_date(&input.end_date) {
        return Err("Enter valid exhibition start and end dates.".to_string());
    }
    if input.end_date < input.start_date {
        return Err("The end date cannot be before the start date.".to_string());
    }
    Ok((name, clean_optional(input.location.clone()), input.start_date.clone(),
        input.end_date.clone(), clean_optional(input.notes.clone())))
}

fn valid_date(value: &str) -> bool {
    if value.len() != 10 { return false; }
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        parts[0].parse::<i32>(), parts[1].parse::<u32>(), parts[2].parse::<u32>()
    ) else { return false; };
    if !(1..=12).contains(&month) || day == 0 { return false; }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day <= days
}

#[tauri::command]
pub fn create_exhibition(app: AppHandle, input: ExhibitionInput) -> Result<i64, String> {
    let (name, location, start_date, end_date, notes) = validate_input(&input)?;
    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start exhibition transaction: {error}"))?;

    transaction.execute(
        "INSERT INTO exhibition (name, location, start_date, end_date, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, location, start_date, end_date, notes],
    ).map_err(|error| format!("Could not create exhibition: {error}"))?;
    let id = transaction.last_insert_rowid();
    transaction.commit().map_err(|error| format!("Could not commit exhibition: {error}"))?;
    Ok(id)
}

#[tauri::command]
pub fn update_exhibition(app: AppHandle, exhibition_id: i64, input: ExhibitionInput) -> Result<(), String> {
    let (name, location, start_date, end_date, notes) = validate_input(&input)?;
    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start exhibition update: {error}"))?;

    let exists: Option<i64> = transaction.query_row(
        "SELECT id FROM exhibition WHERE id = ?1", [exhibition_id], |row| row.get(0)
    ).optional().map_err(|error| format!("Could not verify exhibition: {error}"))?;
    if exists.is_none() {
        return Err("Exhibition not found. Refresh the list and try again.".to_string());
    }

    transaction.execute(
        "UPDATE exhibition SET name = ?1, location = ?2, start_date = ?3, end_date = ?4, notes = ?5, updated_at = datetime('now','localtime') WHERE id = ?6",
        params![name, location, start_date, end_date, notes, exhibition_id],
    ).map_err(|error| format!("Could not update exhibition: {error}"))?;

    transaction.commit().map_err(|error| format!("Could not commit exhibition update: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_exhibition(app: AppHandle, exhibition_id: i64) -> Result<(), String> {
    let mut connection = open_database(&app)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start exhibition deletion: {error}"))?;

    let start_date: Option<String> = transaction.query_row(
        "SELECT start_date FROM exhibition WHERE id = ?1", [exhibition_id], |row| row.get(0)
    ).optional().map_err(|error| format!("Could not verify exhibition: {error}"))?;
    let Some(start_date) = start_date else {
        return Err("Exhibition not found. Refresh the list and try again.".to_string());
    };

    let today: String = transaction.query_row(
        "SELECT date('now','localtime')", [], |row| row.get(0)
    ).map_err(|error| format!("Could not check the current date: {error}"))?;
    if start_date <= today {
        return Err("Only future exhibitions can be deleted.".to_string());
    }

    let linked_records: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM selection WHERE exhibition_id = ?1) OR EXISTS(SELECT 1 FROM customer_order WHERE exhibition_id = ?1) OR EXISTS(SELECT 1 FROM payment WHERE exhibition_id = ?1)",
        [exhibition_id], |row| row.get(0)
    ).map_err(|error| format!("Could not check exhibition history: {error}"))?;
    if linked_records {
        return Err("This exhibition has linked business records and cannot be deleted. Keep it for historical reference.".to_string());
    }

    transaction.execute("DELETE FROM exhibition WHERE id = ?1", [exhibition_id])
        .map_err(|error| format!("Could not delete exhibition: {error}"))?;
    transaction.commit().map_err(|error| format!("Could not commit exhibition deletion: {error}"))?;
    Ok(())
}
