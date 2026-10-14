use rusqlite::{
    params, Connection, OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerContactInput {
    pub name: String,
    pub phone_1: Option<String>,
    pub phone_2: Option<String>,
    pub notes: Option<String>,
    pub is_primary: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerInput {
    pub business_name: String,
    pub email: Option<String>,
    pub city: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
    pub contacts: Vec<CustomerContactInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedCustomer {
    pub id: i64,
    pub business_name: String,
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

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

    let database_path = database_dir.join(database_name);

    if !database_path.exists() {
        return Err(
            "Database not found. Start the application and let its migrations run first."
                .to_string(),
        );
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Could not open database: {error}"))?;

    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable foreign keys: {error}"))?;

    Ok(connection)
}

#[tauri::command]
pub fn create_customer(
    app: AppHandle,
    input: CreateCustomerInput,
) -> Result<CreatedCustomer, String> {
    let business_name = input.business_name.trim().to_string();

    if business_name.is_empty() {
        return Err("Business name is required.".to_string());
    }

    let email = clean_optional(input.email);
    let city = clean_optional(input.city);
    let address = clean_optional(input.address);
    let notes = clean_optional(input.notes);

    let mut contacts = input.contacts;

    for contact in &mut contacts {
        contact.name = contact.name.trim().to_string();

        if contact.name.is_empty() {
            return Err("Every contact must have a name.".to_string());
        }

        contact.phone_1 = clean_optional(contact.phone_1.take());
        contact.phone_2 = clean_optional(contact.phone_2.take());
        contact.notes = clean_optional(contact.notes.take());
    }

    if contacts.iter().filter(|contact| contact.is_primary).count() > 1 {
        return Err("Only one contact can be marked as primary.".to_string());
    }

    if !contacts.is_empty() && !contacts.iter().any(|contact| contact.is_primary) {
        contacts[0].is_primary = true;
    }

    let mut connection = open_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start customer transaction: {error}"))?;

    let result = (|| -> Result<CreatedCustomer, String> {
        transaction
            .execute(
                "INSERT INTO customer (
                    business_name, email, city, address, notes
                ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![business_name, email, city, address, notes],
            )
            .map_err(|error| format!("Could not save customer: {error}"))?;

        let customer_id = transaction.last_insert_rowid();

        for contact in &contacts {
            transaction
                .execute(
                    "INSERT INTO customer_contact (
                        customer_id, name, phone_1, phone_2, is_primary, notes
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        customer_id,
                        contact.name,
                        contact.phone_1,
                        contact.phone_2,
                        contact.is_primary,
                        contact.notes,
                    ],
                )
                .map_err(|error| format!("Could not save customer contact: {error}"))?;
        }

        Ok(CreatedCustomer {
            id: customer_id,
            business_name,
        })
    })();

    match result {
        Ok(customer) => {
            transaction
                .commit()
                .map_err(|error| format!("Could not commit customer: {error}"))?;

            Ok(customer)
        }
        Err(error) => {
            drop(transaction);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn update_customer(
    app: AppHandle,
    customer_id: i64,
    input: CreateCustomerInput,
) -> Result<(), String> {
    let business_name = input.business_name.trim().to_string();
    if business_name.is_empty() {
        return Err("Business name is required.".to_string());
    }

    let email = clean_optional(input.email);
    let city = clean_optional(input.city);
    let address = clean_optional(input.address);
    let notes = clean_optional(input.notes);
    let mut contacts = input.contacts;

    if contacts.is_empty() {
        return Err("Add at least one contact.".to_string());
    }

    for contact in &mut contacts {
        contact.name = contact.name.trim().to_string();
        if contact.name.is_empty() {
            return Err("Every contact must have a name.".to_string());
        }
        contact.phone_1 = clean_optional(contact.phone_1.take());
        contact.phone_2 = clean_optional(contact.phone_2.take());
        contact.notes = clean_optional(contact.notes.take());
    }

    if contacts.iter().filter(|contact| contact.is_primary).count() != 1 {
        return Err("Select exactly one primary contact.".to_string());
    }

    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start customer transaction: {error}"))?;

    let result = (|| -> Result<(), String> {
        let updated = transaction
            .execute(
                "UPDATE customer
                 SET business_name = ?1,
                     email = ?2,
                     city = ?3,
                     address = ?4,
                     notes = ?5,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?6",
                params![business_name, email, city, address, notes, customer_id],
            )
            .map_err(|error| format!("Could not update customer: {error}"))?;

        if updated == 0 {
            return Err("Customer not found. Refresh the list and try again.".to_string());
        }

        transaction
            .execute(
                "DELETE FROM customer_contact WHERE customer_id = ?1",
                [customer_id],
            )
            .map_err(|error| format!("Could not replace customer contacts: {error}"))?;

        for contact in &contacts {
            transaction
                .execute(
                    "INSERT INTO customer_contact
                     (customer_id, name, phone_1, phone_2, is_primary, notes)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        customer_id,
                        contact.name,
                        contact.phone_1,
                        contact.phone_2,
                        contact.is_primary,
                        contact.notes
                    ],
                )
                .map_err(|error| format!("Could not save customer contact: {error}"))?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            transaction
                .commit()
                .map_err(|error| format!("Could not commit customer update: {error}"))?;
            Ok(())
        }
        Err(error) => {
            drop(transaction);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn set_customer_archived(
    app: AppHandle,
    customer_id: i64,
    archived: bool,
) -> Result<(), String> {
    let mut connection = open_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start customer transaction: {error}"))?;

    let result = transaction
        .execute(
            "UPDATE customer
             SET is_archived = ?1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?2",
            params![archived, customer_id],
        )
        .map_err(|error| format!("Could not update customer archive status: {error}"))?;

    if result == 0 {
        return Err("Customer not found. Refresh the list and try again.".to_string());
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit customer archive status: {error}"))?;

    Ok(())
}

#[tauri::command]
pub fn delete_archived_customer(
    app: AppHandle,
    customer_id: i64,
) -> Result<(), String> {
    let mut connection = open_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start customer deletion: {error}"))?;

    let result = (|| -> Result<(), String> {
        let is_archived: Option<i64> = transaction
            .query_row(
                "SELECT is_archived FROM customer WHERE id = ?1",
                [customer_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| {
                format!("Could not verify customer status: {error}")
            })?;

        match is_archived {
            None => return Err(
                "Customer not found. Refresh the list and try again.".to_string()
            ),
            Some(0) => return Err(
                "Only archived customers can be permanently deleted.".to_string()
            ),
            Some(_) => {}
        }

        // Find every table that has a foreign key referencing customer.
        // Historical references block deletion; customer contacts are safe
        // to remove only after all other references have been checked.
        let tables = {
            let mut statement = transaction
                .prepare(
                    "SELECT name
                     FROM sqlite_master
                     WHERE type = 'table'
                       AND name NOT LIKE 'sqlite_%'",
                )
                .map_err(|error| {
                    format!("Could not inspect database tables: {error}")
                })?;

            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| {
                    format!("Could not read database tables: {error}")
                })?;

            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| {
                    format!("Could not read database tables: {error}")
                })?
        };

        let mut has_protected_history = false;

        for table in &tables {
            let escaped_table = table.replace('"', "\"\"");
            let pragma = format!("PRAGMA foreign_key_list(\"{escaped_table}\")");

            let foreign_keys = {
                let mut statement = transaction
                    .prepare(&pragma)
                    .map_err(|error| {
                        format!("Could not inspect relationships: {error}")
                    })?;

                let rows = statement
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, String>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    })
                    .map_err(|error| {
                        format!("Could not inspect relationships: {error}")
                    })?;

                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|error| {
                        format!("Could not inspect relationships: {error}")
                    })?
            };

            for (parent_table, child_column) in foreign_keys {
                if parent_table != "customer" {
                    continue;
                }

                if table == "customer_contact" {
                    continue;
                }

                let escaped_column = child_column.replace('"', "\"\"");
                let sql = format!(
                    "SELECT EXISTS(
                        SELECT 1 FROM \"{escaped_table}\"
                        WHERE \"{escaped_column}\" = ?1
                    )"
                );

                let exists: bool = transaction
                    .query_row(&sql, [customer_id], |row| row.get(0))
                    .map_err(|error| {
                        format!("Could not verify customer history: {error}")
                    })?;

                if exists {
                    has_protected_history = true;
                    break;
                }
            }

            if has_protected_history {
                break;
            }
        }

        if has_protected_history {
            return Err(
                "This customer has linked records or historical activity. \
                 Deletion is blocked to protect that history. Keep the \
                 customer archived instead."
                    .to_string(),
            );
        }

        transaction
            .execute(
                "DELETE FROM customer_contact WHERE customer_id = ?1",
                [customer_id],
            )
            .map_err(|error| {
                format!("Could not remove customer contacts: {error}")
            })?;

        let deleted = transaction
            .execute(
                "DELETE FROM customer
                 WHERE id = ?1 AND is_archived = 1",
                [customer_id],
            )
            .map_err(|error| {
                format!("Could not delete archived customer: {error}")
            })?;

        if deleted == 0 {
            return Err(
                "Customer could not be deleted. Refresh the list and try again."
                    .to_string(),
            );
        }

        Ok(())
    })();

    match result {
        Ok(()) => transaction
            .commit()
            .map_err(|error| {
                format!("Could not commit customer deletion: {error}")
            }),
        Err(error) => Err(error),
    }
}


#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCustomersInput {
    pub keep_customer_id: i64,
    pub duplicate_customer_id: i64,
    pub business_name: String,
    pub email: Option<String>,
    pub city: Option<String>,
    pub address: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn merge_customers(
    app: AppHandle,
    input: MergeCustomersInput,
) -> Result<(), String> {
    if input.keep_customer_id == input.duplicate_customer_id {
        return Err("Choose two different customer records to merge.".to_string());
    }

    let business_name = input.business_name.trim().to_string();
    if business_name.is_empty() {
        return Err("The surviving customer must have a business name.".to_string());
    }

    let email = clean_optional(input.email);
    let city = clean_optional(input.city);
    let address = clean_optional(input.address);
    let notes = clean_optional(input.notes);

    let mut connection = open_database(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start customer merge: {error}"))?;

    let result = (|| -> Result<(), String> {
        for customer_id in [input.keep_customer_id, input.duplicate_customer_id] {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM customer WHERE id = ?1)",
                    [customer_id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("Could not verify customers: {error}"))?;
            if !exists {
                return Err("One of the customers no longer exists. Refresh and try again.".to_string());
            }
        }

        transaction
            .execute(
                "UPDATE customer
                 SET business_name = ?1,
                     email = ?2,
                     city = ?3,
                     address = ?4,
                     notes = ?5,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?6",
                params![
                    business_name,
                    email,
                    city,
                    address,
                    notes,
                    input.keep_customer_id
                ],
            )
            .map_err(|error| format!("Could not update the surviving customer: {error}"))?;

        // Preserve every contact record; do not replace or discard contacts.
        transaction
            .execute(
                "UPDATE customer_contact SET customer_id = ?1 WHERE customer_id = ?2",
                params![input.keep_customer_id, input.duplicate_customer_id],
            )
            .map_err(|error| format!("Could not transfer customer contacts: {error}"))?;

        // Transfer or consolidate selections by exhibition. The UNIQUE
        // (customer_id, exhibition_id) constraint means conflicting selections
        // must be merged into the surviving selection before the duplicate is removed.
        let duplicate_selections = {
            let mut statement = transaction
                .prepare(
                    "SELECT id, exhibition_id, notes
                     FROM selection
                     WHERE customer_id = ?1
                     ORDER BY exhibition_id, id",
                )
                .map_err(|error| format!("Could not read duplicate selections: {error}"))?;
            let rows = statement
                .query_map([input.duplicate_customer_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|error| format!("Could not read duplicate selections: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not read duplicate selections: {error}"))?
        };

        for (duplicate_selection_id, exhibition_id, duplicate_notes) in duplicate_selections {
            let kept_selection: Option<(i64, Option<String>)> = transaction
                .query_row(
                    "SELECT id, notes FROM selection
                     WHERE customer_id = ?1 AND exhibition_id = ?2",
                    params![input.keep_customer_id, exhibition_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|error| format!("Could not check exhibition selections: {error}"))?;

            let Some((kept_selection_id, kept_notes)) = kept_selection else {
                transaction
                    .execute(
                        "UPDATE selection
                         SET customer_id = ?1, updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?2",
                        params![input.keep_customer_id, duplicate_selection_id],
                    )
                    .map_err(|error| format!("Could not transfer a selection: {error}"))?;
                continue;
            };

            // Preserve both notes without silently overwriting either.
            let merged_notes = match (
                kept_notes.as_deref().map(str::trim).filter(|s| !s.is_empty()),
                duplicate_notes.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            ) {
                (Some(kept), Some(duplicate)) if kept != duplicate => {
                    Some(format!("{kept}\n\n[Merged duplicate customer notes]\n{duplicate}"))
                }
                (Some(kept), _) => Some(kept.to_string()),
                (None, Some(duplicate)) => Some(duplicate.to_string()),
                (None, None) => None,
            };

            transaction
                .execute(
                    "UPDATE selection SET notes = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                    params![merged_notes, kept_selection_id],
                )
                .map_err(|error| format!("Could not preserve selection notes: {error}"))?;

            // Move every selection-item row to the surviving selection. If an
            // active item already exists there, mark the duplicate row removed
            // first, preserving the row and any order that references it.
            let duplicate_items = {
                let mut statement = transaction
                    .prepare(
                        "SELECT id, inventory_item_id, status
                         FROM selection_item WHERE selection_id = ?1 ORDER BY id",
                    )
                    .map_err(|error| format!("Could not read selected items: {error}"))?;
                let rows = statement
                    .query_map([duplicate_selection_id], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, Option<i64>>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    })
                    .map_err(|error| format!("Could not read selected items: {error}"))?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|error| format!("Could not read selected items: {error}"))?
            };

            for (selection_item_id, inventory_item_id, status) in duplicate_items {
                let conflicts = if status == "active" {
                    if let Some(item_id) = inventory_item_id {
                        transaction
                            .query_row(
                                "SELECT EXISTS(
                                    SELECT 1 FROM selection_item
                                    WHERE selection_id = ?1
                                      AND inventory_item_id = ?2
                                      AND status = 'active'
                                )",
                                params![kept_selection_id, item_id],
                                |row| row.get::<_, bool>(0),
                            )
                            .map_err(|error| format!("Could not check duplicate selected items: {error}"))?
                    } else {
                        false
                    }
                } else {
                    false
                };

                if conflicts {
                    transaction
                        .execute(
                            "UPDATE selection_item
                             SET status = 'removed',
                                 removed_at = COALESCE(removed_at, CURRENT_TIMESTAMP),
                                 updated_at = CURRENT_TIMESTAMP
                             WHERE id = ?1",
                            [selection_item_id],
                        )
                        .map_err(|error| format!("Could not mark a duplicate selection item removed: {error}"))?;
                }

                transaction
                    .execute(
                        "UPDATE selection_item SET selection_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
                        params![kept_selection_id, selection_item_id],
                    )
                    .map_err(|error| format!("Could not transfer a selection item: {error}"))?;
            }

            transaction
                .execute(
                    "DELETE FROM selection WHERE id = ?1",
                    [duplicate_selection_id],
                )
                .map_err(|error| format!("Could not remove the consolidated selection: {error}"))?;
        }

        // Keep orders/payments linked to the surviving customer while leaving
        // their historical name snapshots and order snapshots unchanged.
        transaction
            .execute(
                "UPDATE customer_order SET customer_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?2",
                params![input.keep_customer_id, input.duplicate_customer_id],
            )
            .map_err(|error| format!("Could not transfer customer orders: {error}"))?;

        transaction
            .execute(
                "UPDATE payment SET customer_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ?2",
                params![input.keep_customer_id, input.duplicate_customer_id],
            )
            .map_err(|error| format!("Could not transfer customer payments: {error}"))?;

        let deleted = transaction
            .execute(
                "DELETE FROM customer WHERE id = ?1",
                [input.duplicate_customer_id],
            )
            .map_err(|error| format!("Could not remove the duplicate customer: {error}"))?;

        if deleted != 1 {
            return Err("The duplicate customer could not be removed. Nothing was changed.".to_string());
        }

        Ok(())
    })();

    match result {
        Ok(()) => transaction
            .commit()
            .map_err(|error| format!("Could not commit customer merge: {error}")),
        Err(error) => Err(error),
    }
}
