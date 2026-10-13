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

fn get_id(connection: &Connection, sql: &str, value: &str) -> Result<i64, String> {
    connection
        .query_row(sql, [value], |row| row.get(0))
        .map_err(|error| format!("Could not find '{value}': {error}"))
}

fn allocate_item_number(connection: &Connection, category_id: i64) -> Result<String, String> {
    let (series_id, prefix, mut next_number, number_width, range_end): (
        i64,
        String,
        i64,
        i64,
        Option<i64>,
    ) = connection
        .query_row(
            "SELECT s.id, s.prefix, s.next_number, s.number_width, s.range_end
             FROM item_series s
             JOIN category c ON c.series_id = s.id
             WHERE c.id = ?1",
            [category_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .map_err(|error| format!("Could not resolve item-number series: {error}"))?;

    loop {
        if range_end.is_some_and(|end| next_number > end) {
            return Err(format!(
                "Item-number series '{prefix}' has no numbers remaining."
            ));
        }

        let suffix = if number_width > 0 {
            format!("{:0width$}", next_number, width = number_width as usize)
        } else {
            next_number.to_string()
        };
        let item_number = format!("{prefix}{suffix}");

        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM item WHERE item_number = ?1)",
                [&item_number],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not check item number {item_number}: {error}"))?;

        connection
            .execute(
                "UPDATE item_series SET next_number = ?1 WHERE id = ?2",
                params![next_number + 1, series_id],
            )
            .map_err(|error| format!("Could not advance item-number series: {error}"))?;

        next_number += 1;
        if !exists {
            return Ok(item_number);
        }
    }
}

#[tauri::command]
pub fn seed_dev_inventory(app: AppHandle) -> Result<usize, String> {
    let mut connection = open_dev_database(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start seed transaction: {error}"))?;

    let result = (|| -> Result<usize, String> {
        // Use the actual reference data created by the database migrations.
        let necklace = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Necklace",
        )?;
        let ring = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Ring",
        )?;
        let jhumka = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Jhumka",
        )?;
        let bracelet = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Bracelet",
        )?;
        let pendant = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Pendant",
        )?;
        let bangle = get_id(
            &transaction,
            "SELECT id FROM category WHERE name = ?1 AND is_archived = 0",
            "Bangle",
        )?;

        let purity_18k = get_id(
            &transaction,
            "SELECT id FROM purity WHERE name = ?1 AND is_archived = 0",
            "18K",
        )?;
        let purity_22k = get_id(
            &transaction,
            "SELECT id FROM purity WHERE name = ?1 AND is_archived = 0",
            "22K",
        )?;

        let rose_gold = get_id(
            &transaction,
            "SELECT id FROM gold_type WHERE name = ?1 AND is_archived = 0",
            "Rose Gold",
        )?;

        let round = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1 AND is_archived = 0",
            "RD",
        )?;
        let pm = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1 AND is_archived = 0",
            "P/M",
        )?;
        let tb = get_id(
            &transaction,
            "SELECT id FROM diamond_shape WHERE code = ?1 AND is_archived = 0",
            "T/B",
        )?;

        // Resolve the default EF-VVS combination for each diamond shape.
        let round_quality = transaction
            .query_row(
                "SELECT id FROM diamond_combination
                 WHERE shape_id = ?1 AND quality = 'EF-VVS' AND is_archived = 0",
                [round],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Could not find Round EF-VVS quality: {error}"))?;

        let pm_quality = transaction
            .query_row(
                "SELECT id FROM diamond_combination
                 WHERE shape_id = ?1 AND quality = 'EF-VVS' AND is_archived = 0",
                [pm],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Could not find P/M EF-VVS quality: {error}"))?;

        let tb_quality = transaction
            .query_row(
                "SELECT id FROM diamond_combination
                 WHERE shape_id = ?1 AND quality = 'EF-VVS' AND is_archived = 0",
                [tb],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Could not find T/B EF-VVS quality: {error}"))?;

        let red_stone = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1 AND is_archived = 0",
            "Red Stone",
        )?;
        let green_stone = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1 AND is_archived = 0",
            "Green Stone",
        )?;
        let pearl = get_id(
            &transaction,
            "SELECT id FROM stone_type WHERE name = ?1 AND is_archived = 0",
            "Pearl",
        )?;

        // Fictional catalog designs. Gold weights are stored in milligrams.
        // Re-running the seed command does not overwrite existing records.
        let items = [
            (
                "TEST-N001",
                necklace,
                "TEST-N001",
                12850_i64,
                purity_22k,
                Some("IGI-DEMO-1001"),
                Some("A1B2C3"),
                0_i64,
            ),
            (
                "TEST-N002",
                necklace,
                "TEST-N002",
                24500,
                purity_18k,
                None,
                None,
                0,
            ),
            (
                "TEST-R001",
                ring,
                "TEST-R001",
                4250,
                purity_18k,
                Some("IGI-DEMO-1002"),
                Some("D4E5F6"),
                0,
            ),
            (
                "TEST-R002",
                ring,
                "TEST-R002",
                5100,
                purity_22k,
                None,
                None,
                0,
            ),
            (
                "TEST-J001",
                jhumka,
                "TEST-J001",
                8750,
                purity_22k,
                None,
                Some("G7H8J9"),
                0,
            ),
            (
                "TEST-J002",
                jhumka,
                "TEST-J002",
                7350,
                purity_18k,
                Some("IGI-DEMO-1003"),
                None,
                0,
            ),
            (
                "TEST-BR001",
                bracelet,
                "TEST-BR001",
                14200,
                purity_22k,
                Some("IGI-DEMO-1004"),
                Some("K2L3M4"),
                0,
            ),
            (
                "TEST-BR002",
                bracelet,
                "TEST-BR002",
                11600,
                purity_18k,
                None,
                None,
                0,
            ),
            (
                "TEST-P001",
                pendant,
                "TEST-P001",
                3200,
                purity_22k,
                Some("IGI-DEMO-1005"),
                Some("N5P6Q7"),
                0,
            ),
            (
                "TEST-B001",
                bangle,
                "TEST-B001",
                21200,
                purity_22k,
                None,
                None,
                1,
            ),
        ];

        for (
            test_name,
            category_id,
            name,
            weight,
            purity_id,
            igi_certificate_number,
            huid,
            archived,
        ) in items
        {
            // Do not duplicate a sample item when the seed button is used repeatedly.
            let already_exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM item WHERE name = ?1)",
                    [test_name],
                    |row| row.get(0),
                )
                .map_err(|error| format!("Could not check sample item {test_name}: {error}"))?;

            if already_exists {
                continue;
            }

            let item_number = allocate_item_number(&transaction, category_id)?;

            transaction
                .execute(
                    "INSERT INTO item (
                        item_number,
                        category_id,
                        name,
                        gross_weight_milli,
                        purity_id,
                        gold_type_id,
                        igi_certificate_number,
                        huid,
                        is_archived,
                        archived_at
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                        CASE WHEN ?9 = 1
                            THEN datetime('now', 'localtime')
                            ELSE NULL
                        END
                    )",
                    params![
                        item_number,
                        category_id,
                        name,
                        weight,
                        purity_id,
                        rose_gold,
                        igi_certificate_number,
                        huid,
                        archived,
                    ],
                )
                .map_err(|error| format!("Could not create sample item {test_name}: {error}"))?;
        }

        // Diamond weights are stored in thousandths of a carat.
        let diamonds = [
            ("TEST-N001", round, round_quality, 24_i64, 1500_i64),
            ("TEST-N002", pm, pm_quality, 18, 2200),
            ("TEST-R001", round, round_quality, 1, 600),
            ("TEST-R002", tb, tb_quality, 12, 850),
            ("TEST-J002", pm, pm_quality, 16, 900),
            ("TEST-BR001", round, round_quality, 32, 1800),
            ("TEST-P001", round, round_quality, 1, 450),
        ];

        for (item_number, shape_id, combination_id, pieces, weight_milli) in diamonds {
            let item_id = get_id(
                &transaction,
                "SELECT id FROM item WHERE name = ?1",
                item_number,
            )?;

            transaction
                .execute(
                    "INSERT OR IGNORE INTO item_diamond (
                        item_id, shape_id, combination_id, pieces, weight_milli
                    ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![item_id, shape_id, combination_id, pieces, weight_milli],
                )
                .map_err(|error| {
                    format!("Could not add diamond details to {item_number}: {error}")
                })?;
        }

        // Stone weights use the units defined by each stone type.
        let stones = [
            ("TEST-N002", red_stone, 10_i64, 3000_i64),
            ("TEST-J001", pearl, 24, 1800),
            ("TEST-BR002", green_stone, 14, 2400),
        ];

        for (item_number, stone_type_id, pieces, weight_milli) in stones {
            let item_id = get_id(
                &transaction,
                "SELECT id FROM item WHERE name = ?1",
                item_number,
            )?;

            transaction
                .execute(
                    "INSERT OR IGNORE INTO item_stone (
                        item_id, stone_type_id, pieces, weight_milli
                    ) VALUES (?1, ?2, ?3, ?4)",
                    params![item_id, stone_type_id, pieces, weight_milli],
                )
                .map_err(|error| {
                    format!("Could not add stone details to {item_number}: {error}")
                })?;
        }

        let count: usize = transaction
            .query_row(
                "SELECT COUNT(*) FROM item WHERE name LIKE 'TEST-%'",
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
        // Sample records are identified by the TEST- prefix in item.name.
        // Preserve the production rule: archive before permanent deletion.
        transaction
            .execute(
                "UPDATE item
                 SET is_archived = 1,
                     archived_at = COALESCE(archived_at, datetime('now', 'localtime'))
                 WHERE (name LIKE 'TEST-%' OR item_number LIKE 'TEST-%')
                   AND is_archived = 0",
                [],
            )
            .map_err(|error| format!("Could not archive sample items: {error}"))?;

        let deleted = transaction
            .execute(
                "DELETE FROM item
                 WHERE name LIKE 'TEST-%' OR item_number LIKE 'TEST-%'",
                [],
            )
            .map_err(|error| format!("Could not delete sample items: {error}"))?;

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
