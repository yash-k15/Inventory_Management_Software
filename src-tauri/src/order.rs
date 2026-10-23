use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Deserialize;
use std::time::Duration;
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewOrderItem {
    inventory_item_id: i64,
    agreed_price_paise: i64,
    item_snapshot: String,
    pricing_breakdown: String,
    #[serde(default)]
    selection_item_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    customer_id: i64,
    exhibition_id: Option<i64>,
    notes: String,
    #[serde(default)]
    rounded_total_paise: Option<i64>,
    items: Vec<NewOrderItem>,
}

#[tauri::command]
pub fn create_confirmed_order(
    app: tauri::AppHandle,
    input: CreateOrderInput,
) -> Result<i64, String> {
    if input.customer_id <= 0 {
        return Err("Select a customer.".to_string());
    }
    if input.items.is_empty() {
        return Err("Add at least one jewelry item.".to_string());
    }
    if input.rounded_total_paise.is_some_and(|value| value < 0) {
        return Err("Enter a valid rounded order total.".to_string());
    }

    let mut seen = std::collections::HashSet::new();
    for item in &input.items {
        if item.inventory_item_id <= 0 || item.agreed_price_paise < 0 {
            return Err("Enter a valid price for every item.".to_string());
        }
        if !seen.insert(item.inventory_item_id) {
            return Err("An item can only be added once to an order.".to_string());
        }
        serde_json::from_str::<serde_json::Value>(&item.item_snapshot)
            .map_err(|_| "The item details are invalid. Please refresh and try again.".to_string())?;
        serde_json::from_str::<serde_json::Value>(&item.pricing_breakdown)
            .map_err(|_| "The pricing details are invalid. Please try again.".to_string())?;
    }

    let db_filename = if cfg!(debug_assertions) {
        "inventory-dev.db"
    } else {
        "inventory.db"
    };
    let db_path = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not locate the application database folder: {e}"))?
        .join(db_filename);

    let mut connection = Connection::open(&db_path)
        .map_err(|e| format!("Could not open the inventory database: {e}"))?;
    connection
        .busy_timeout(Duration::from_secs(8))
        .map_err(|e| format!("Could not configure the database: {e}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Could not configure the database: {e}"))?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Could not start order creation: {e}"))?;

    let customer_name: String = transaction
        .query_row(
            "SELECT business_name FROM customer WHERE id = ?1 AND is_archived = 0",
            [input.customer_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Could not validate the customer: {e}"))?
        .ok_or_else(|| "This customer is unavailable or archived.".to_string())?;

    if let Some(exhibition_id) = input.exhibition_id {
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM exhibition WHERE id = ?1)",
                [exhibition_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Could not validate the exhibition: {e}"))?;
        if !exists {
            return Err("The selected exhibition no longer exists.".to_string());
        }
    }

    for item in &input.items {
        if let Some(selection_item_id) = item.selection_item_id {
            let valid_selection: bool = transaction
                .query_row(
                    "SELECT EXISTS(
                       SELECT 1
                       FROM selection_item si
                       JOIN selection s ON s.id = si.selection_id
                       WHERE si.id = ?1
                         AND si.inventory_item_id = ?2
                         AND si.status = 'active'
                         AND s.customer_id = ?3
                         AND s.exhibition_id = ?4
                     )",
                    params![selection_item_id, item.inventory_item_id, input.customer_id, input.exhibition_id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Could not validate the selected item: {e}"))?;
            if !valid_selection {
                return Err("One of the selected items no longer belongs to this customer's exhibition selection.".to_string());
            }
        }

        let item_number: Option<String> = transaction
            .query_row(
                "SELECT item_number FROM item WHERE id = ?1 AND is_archived = 0",
                [item.inventory_item_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Could not validate inventory item: {e}"))?;
        let item_number = item_number
            .ok_or_else(|| "One or more items are no longer available.".to_string())?;

        if let Some(selection_item_id) = item.selection_item_id {
            let existing_order: Option<String> = transaction
                .query_row(
                    "SELECT 'ORD-' || printf('%04d', co.id)
                     FROM customer_order_item coi
                     JOIN customer_order co ON co.id = coi.order_id
                     WHERE co.status <> 'Cancelled'
                       AND coi.selection_item_id = ?1
                     ORDER BY co.id DESC
                     LIMIT 1",
                    [selection_item_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| format!("Could not check existing orders: {e}"))?;
            if let Some(order_number) = existing_order {
                return Err(format!("{item_number} was already ordered from this exhibition selection in {order_number}."));
            }
        }
    }

    
    let calculated_total_paise: i64 = input
        .items
        .iter()
        .map(|item| item.agreed_price_paise)
        .sum();

    let rounded_total_paise = input.rounded_total_paise;

    let final_total_paise =
        rounded_total_paise.unwrap_or(calculated_total_paise);

    transaction
        .execute(
            "INSERT INTO customer_order (
                customer_id,
                customer_name_snapshot,
                exhibition_id,
                status,
                notes,
                calculated_total_paise,
                rounded_total_paise,
                final_total_paise
            )
            VALUES (?1, ?2, ?3, 'Confirmed', ?4, ?5, ?6, ?7)",
            params![
                input.customer_id,
                customer_name,
                input.exhibition_id,
                input.notes.trim(),
                calculated_total_paise,
                rounded_total_paise,
                final_total_paise
            ],
        )
        .map_err(|e| format!("Could not create the order: {e}"))?;

    let order_id = transaction.last_insert_rowid();

    for item in &input.items {
        transaction
            .execute(
                "INSERT INTO customer_order_item
                 (order_id, selection_item_id, item_snapshot, pricing_breakdown, agreed_price_paise)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    order_id,
                    item.selection_item_id,
                    item.item_snapshot,
                    item.pricing_breakdown,
                    item.agreed_price_paise
                ],
            )
            .map_err(|e| format!("Could not save an order item: {e}"))?;
    }

    transaction
        .commit()
        .map_err(|e| format!("Could not finish saving the order: {e}"))?;
    Ok(order_id)
}
