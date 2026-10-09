
#![cfg(debug_assertions)]

use rusqlite::{params, Connection, TransactionBehavior};
use tauri::{AppHandle, Manager};

fn open_dev_database(app: &AppHandle) -> Result<Connection, String> {
    let database_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve database directory: {error}"))?;

    let database_path = database_dir.join("inventory-dev.db");

    if !database_path.exists() {
        return Err(
            "Development database does not exist yet. Start the app and let its migrations run first."
                .to_string(),
        );
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Could not open development database: {error}"))?;

    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable foreign keys: {error}"))?;

    Ok(connection)
}

fn get_id(
    connection: &Connection,
    sql: &str,
    value: &str,
) -> Result<i64, String> {
    connection
        .query_row(sql, [value], |row| row.get(0))
        .map_err(|error| format!("Could not find '{value}': {error}"))
}

#[tauri::command]
pub fn seed_dev_inventory(app: AppHandle) -> Result<usize, String> {
    let mut connection = open_dev_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start seed transaction: {error}"))?;

    let result = (|| -> Result<usize, String> {
        // Add test-only categories and purities without overwriting existing data.
        let categories = [
            ("TEST - Necklace", 1),
            ("TEST - Ring", 2),
            ("TEST - Jhumka", 3),
            ("TEST - Bracelet", 4),
            ("TEST - Pendant", 5),
            ("TEST - Bangle", 6),
        ];

        for (name, sort_order) in categories {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO category (name, sort_order)
                     VALUES (?1, ?2)",
                    params![name, sort_order],
                )
                .map_err(|error| format!("Could not create test category: {error}"))?;
        }

        let purities = [("TEST 18K", 7500), ("TEST 22K", 9160)];

        for (name, percent_bp) in purities {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO purity (name, percent_bp)
                     VALUES (?1, ?2)",
                    params![name, percent_bp],
                )
                .map_err(|error| format!("Could not create test purity: {error}"))?;
        }

        let necklace = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Necklace",
        )?;
        let ring = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Ring",
        )?;
        let jhumka = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Jhumka",
        )?;
        let bracelet = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Bracelet",
        )?;
        let pendant = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Pendant",
        )?;
        let bangle = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1",
            "TEST - Bangle",
        )?;

        let purity_18k = get_id(
            &transaction,
            "SELECT id FROM purity WHERE name = ?1",
            "TEST 18K",
        )?;
        let purity_22k = get_id(
            &transaction,
            "SELECT id FROM purity WHERE name = ?1",
            "TEST 22K",
        )?;

        // Existing shape codes are seeded by the initial migration.
        let round = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1",
            "RD",
        )?;
        let pm = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1",
            "P/M",
        )?;
        let tb = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1",
            "T/B",
        )?;

        // These are deliberately fictional catalog records.
        // We never update a pre-existing item with the same test item number.
        let items = [
            ("TEST-NK-001", necklace, "Diamond Necklace", 12850, purity_22k, 1, 0),
            ("TEST-NK-002", necklace, "Stone Necklace", 24500, purity_18k, 0, 0),
            ("TEST-RG-001", ring, "Round Diamond Ring", 4250, purity_18k, 1, 0),
            ("TEST-RG-002", ring, "P/M Diamond Ring", 5100, purity_22k, 0, 0),
            ("TEST-EA-001", jhumka, "Pearl Jhumkas", 8750, purity_22k, 1, 0),
            ("TEST-EA-002", jhumka, "Diamond Jhumkas", 7350, purity_18k, 0, 0),
            ("TEST-BR-001", bracelet, "Diamond Bracelet", 14200, purity_22k, 1, 0),
            ("TEST-BR-002", bracelet, "Green Stone Bracelet", 11600, purity_18k, 0, 0),
            ("TEST-PD-001", pendant, "Diamond Pendant", 3200, purity_22k, 1, 0),
            ("TEST-BG-001", bangle, "Archived Bangle", 21200, purity_22k, 0, 1),
        ];

        for (item_number, category_id, name, weight, purity_id, certified, archived) in items {
            transaction
                .execute(
                    "INSERT OR IGNORE INTO item (
                        item_number, category_id, name, gross_weight_milli,
                        purity_id, is_certified, is_archived, archived_at
                     ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                        CASE WHEN ?7 = 1 THEN datetime('now','localtime') ELSE NULL END
                     )",
                    params![
                        item_number,
                        category_id,
                        name,
                        weight,
                        purity_id,
                        certified,
                        archived
                    ],
                )
                .map_err(|error| format!("Could not create {item_number}: {error}"))?;
        }

        // Add diamond details only to the test items that need them.
        let diamonds = [
            ("TEST-NK-001", round, 24, 1500),
            ("TEST-NK-002", pm, 18, 2200),
            ("TEST-RG-001", round, 1, 600),
            ("TEST-RG-002", tb, 12, 850),
            ("TEST-EA-001", round, 20, 1200),
            ("TEST-EA-002", pm, 16, 900),
            ("TEST-BR-001", round, 32, 1800),
            ("TEST-PD-001", round, 1, 450),
        ];

        for (item_number, shape_id, pieces, weight_milli) in diamonds {
            let item_id = get_id(
                &transaction,
                "SELECT id FROM item WHERE item_number = ?1",
                item_number,
            )?;

            transaction
                .execute(
                    "INSERT OR IGNORE INTO item_diamond
                        (item_id, shape_id, pieces, weight_milli)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![item_id, shape_id, pieces, weight_milli],
                )
                .map_err(|error| format!("Could not add diamond details: {error}"))?;
        }

        // Use the stone types already provided by the initial migration.
        let red_stone = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1",
            "Red Stone",
        )?;
        let green_stone = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1",
            "Green Stone",
        )?;
        let pearl = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1",
            "Pearl",
        )?;

        let stones = [
            ("TEST-NK-002", red_stone, 10, 3000),
            ("TEST-EA-001", pearl, 24, 1800),
            ("TEST-BR-002", green_stone, 14, 2400),
        ];

        for (item_number, stone_type_id, pieces, weight_milli) in stones {
            let item_id = get_id(
                &transaction,
                "SELECT id FROM item WHERE item_number = ?1",
                item_number,
            )?;

            transaction
                .execute(
                    "INSERT OR IGNORE INTO item_stone
                        (item_id, stone_type_id, pieces, weight_milli)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![item_id, stone_type_id, pieces, weight_milli],
                )
                .map_err(|error| format!("Could not add stone details: {error}"))?;
        }

        let count: usize = transaction
            .query_row(
                "SELECT COUNT(*) FROM item WHERE item_number LIKE 'TEST-%'",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not count test items: {error}"))?;

        Ok(count)
    })();

    match result {
        Ok(count) => {
            transaction
                .commit()
                .map_err(|error| format!("Could not commit seed transaction: {error}"))?;
            Ok(count)
        }
        Err(error) => {
            drop(transaction);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn clean_dev_inventory(app: AppHandle) -> Result<usize, String> {
    let mut connection = open_dev_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start cleanup transaction: {error}"))?;

    let result = (|| -> Result<usize, String> {
        // The schema only permits permanent deletion of archived items.
        // Archive and delete only records using our reserved TEST- prefix.
        transaction
            .execute(
                "UPDATE item
                 SET is_archived = 1,
                     archived_at = COALESCE(archived_at, datetime('now','localtime'))
                 WHERE item_number LIKE 'TEST-%' AND is_archived = 0",
                [],
            )
            .map_err(|error| format!("Could not archive test items: {error}"))?;

        let deleted = transaction
            .execute("DELETE FROM item WHERE item_number LIKE 'TEST-%'", [])
            .map_err(|error| format!("Could not delete test items: {error}"))?;

        transaction
            .execute(
                "DELETE FROM category
                 WHERE name LIKE 'TEST - %'
                   AND NOT EXISTS (
                       SELECT 1 FROM item WHERE item.category_id = category.id
                   )",
                [],
            )
            .map_err(|error| format!("Could not remove test categories: {error}"))?;

        transaction
            .execute(
                "DELETE FROM purity
                 WHERE name LIKE 'TEST %'
                   AND NOT EXISTS (
                       SELECT 1 FROM item WHERE item.purity_id = purity.id
                   )",
                [],
            )
            .map_err(|error| format!("Could not remove test purities: {error}"))?;

        Ok(deleted)
    })();

    match result {
        Ok(deleted) => {
            transaction
                .commit()
                .map_err(|error| format!("Could not commit cleanup transaction: {error}"))?;
            Ok(deleted)
        }
        Err(error) => {
            drop(transaction);
            Err(error)
        }
    }
}
