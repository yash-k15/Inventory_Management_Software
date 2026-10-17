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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderInput {
    customer_id: i64,
    exhibition_id: Option<i64>,
    notes: String,
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

    // The SQL plugin resolves sqlite:<filename> relative to AppConfig.
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

        let existing_order: Option<String> = transaction
            .query_row(
                "SELECT 'ORD-' || printf('%04d', co.id)
                 FROM customer_order_item coi
                 JOIN customer_order co ON co.id = coi.order_id
                 WHERE co.status <> 'Cancelled'
                   AND (
                     coi.selection_item_id IN (
                       SELECT si.id FROM selection_item si
                       WHERE si.inventory_item_id = ?1
                     )
                     OR CAST(json_extract(coi.item_snapshot, '$.inventory_item_id') AS INTEGER) = ?1
                   )
                 ORDER BY co.id DESC LIMIT 1",
                [item.inventory_item_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Could not check existing orders: {e}"))?;
        if let Some(order_number) = existing_order {
            return Err(format!("{item_number} already belongs to {order_number}."));
        }
    }

    transaction
        .execute(
            "INSERT INTO customer_order (customer_id, customer_name_snapshot, exhibition_id, status)
             VALUES (?1, ?2, ?3, 'Confirmed')",
            params![input.customer_id, customer_name, input.exhibition_id],
        )
        .map_err(|e| format!("Could not create the order: {e}"))?;
    let order_id = transaction.last_insert_rowid();

    for item in &input.items {
        transaction
            .execute(
                "INSERT INTO customer_order_item
                 (order_id, selection_item_id, item_snapshot, pricing_breakdown, agreed_price_paise)
                 VALUES (?1, NULL, ?2, ?3, ?4)",
                params![
                    order_id,
                    item.item_snapshot,
                    item.pricing_breakdown,
                    item.agreed_price_paise
                ],
            )
            .map_err(|e| format!("Could not save an order item: {e}"))?;
    }

    if !input.notes.trim().is_empty() {
        transaction
            .execute(
                "UPDATE order_status_history SET notes = ?1
                 WHERE order_id = ?2 AND status = 'Confirmed'
                   AND id = (SELECT id FROM order_status_history
                             WHERE order_id = ?2 AND status = 'Confirmed'
                             ORDER BY id DESC LIMIT 1)",
                params![input.notes.trim(), order_id],
            )
            .map_err(|e| format!("Could not save order notes: {e}"))?;
    }

    transaction
        .commit()
        .map_err(|e| format!("Could not finish saving the order: {e}"))?;
    Ok(order_id)
}
