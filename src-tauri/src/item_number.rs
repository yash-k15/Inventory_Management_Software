
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ItemNumberPreview {
    pub category_id: i64,
    pub item_number: String,
}

#[derive(Serialize)]
pub struct CreatedItem {
    pub id: i64,
    pub item_number: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiamondInput {
    pub shape_id: i64,
    pub combination_id: Option<i64>,
    pub pieces: Option<i64>,
    pub weight_milli: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoneInput {
    pub stone_type_id: i64,
    pub pieces: Option<i64>,
    pub weight_milli: i64,
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
        return Err(format!(
            "Database not found at {}. Start the application and let its migrations run first.",
            database_path.display()
        ));
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Could not open database: {error}"))?;

    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable foreign keys: {error}"))?;

    Ok(connection)
}

fn get_next_number(
    connection: &Connection,
    category_id: i64,
) -> Result<(String, i64), String> {
    let (series_id, prefix, next_number, number_width): (i64, String, i64, i64) =
        connection
            .query_row(
                "SELECT s.id, s.prefix, s.next_number, s.number_width
                 FROM category c
                 JOIN item_series s ON s.id = c.series_id
                 WHERE c.id = ?1 AND c.is_archived = 0",
                [category_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .map_err(|_| {
                "Selected category is unavailable or has no numbering series.".to_string()
            })?;

    let range_end: Option<i64> = connection
        .query_row(
            "SELECT range_end FROM item_series WHERE id = ?1",
            [series_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read numbering range: {error}"))?;

    if next_number < 1 || number_width < 0 {
        return Err("The category numbering configuration is invalid.".to_string());
    }

    if range_end.is_some_and(|end| next_number > end) {
        return Err("The item-number series has reached its configured limit.".to_string());
    }

    let number = format!(
        "{}{:0width$}",
        prefix,
        next_number,
        width = number_width as usize
    );

    let existing: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM item WHERE item_number = ?1)",
            [&number],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check item number: {error}"))?;

    if existing {
        return Err(format!(
            "The next item number {number} already exists. The series needs to be reconciled before continuing."
        ));
    }

    Ok((number, next_number))
}

#[tauri::command]
pub fn preview_item_number(
    app: AppHandle,
    category_id: i64,
) -> Result<ItemNumberPreview, String> {
    let connection = open_database(&app)?;
    let (item_number, _) = get_next_number(&connection, category_id)?;

    Ok(ItemNumberPreview {
        category_id,
        item_number,
    })
}

fn copy_item_photo(
    app: &AppHandle,
    source: Option<&str>,
    item_number: &str,
) -> Result<(Option<String>, Option<PathBuf>), String> {
    let Some(source) = source.filter(|value| !value.trim().is_empty()) else {
        return Ok((None, None));
    };

    let source_path = PathBuf::from(source);
    if !source_path.is_file() {
        return Err("The selected photo could not be found. Please select it again.".to_string());
    }

    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|value| {
            matches!(
                value.as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif"
            )
        })
        .ok_or_else(|| {
            "Unsupported photo format. Choose a JPG, PNG, WebP, HEIC, or HEIF image.".to_string()
        })?;

    let image_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve application data directory: {error}"))?
        .join("item-images");

    std::fs::create_dir_all(&image_dir)
        .map_err(|error| format!("Could not create item photo directory: {error}"))?;

    let filename = format!("{item_number}.{extension}");
    let destination = image_dir.join(&filename);

    std::fs::copy(&source_path, &destination)
        .map_err(|error| format!("Could not copy item photo: {error}"))?;

    Ok((
        Some(format!("item-images/{filename}")),
        Some(destination),
    ))
}

#[tauri::command]
pub fn create_item(
    app: AppHandle,
    category_id: i64,
    name: Option<String>,
    gross_weight_milli: Option<i64>,
    purity_id: Option<i64>,
    gold_type_id: i64,
    igi_certificate_number: Option<String>,
    huid: Option<String>,
    notes: Option<String>,
    image_source: Option<String>,
    diamonds: Vec<DiamondInput>,
    stones: Vec<StoneInput>,
) -> Result<CreatedItem, String> {
    if gross_weight_milli.is_some_and(|weight| weight < 0) {
        return Err("Gold weight cannot be negative.".to_string());
    }

    for diamond in &diamonds {
        if diamond.weight_milli < 0 || diamond.pieces.is_some_and(|value| value < 0) {
            return Err("Diamond pieces and weight cannot be negative.".to_string());
        }
    }

    for stone in &stones {
        if stone.weight_milli < 0 || stone.pieces.is_some_and(|value| value < 0) {
            return Err("Stone pieces and weight cannot be negative.".to_string());
        }
    }

    let igi_certificate_number = igi_certificate_number
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty());

    let huid = huid
    .map(|value| value.trim().to_uppercase())
    .filter(|value| !value.is_empty());

    let mut connection = open_database(&app)?;

    let gold_type_is_valid: bool = connection
    .query_row(
        "SELECT EXISTS(
            SELECT 1
            FROM gold_type
            WHERE id = ?1 AND is_archived = 0
        )",
        [gold_type_id],
        |row| row.get(0),
    )
    .map_err(|error| format!("Could not validate gold type: {error}"))?;

    if !gold_type_is_valid {
        return Err("Please select a valid, active gold type.".to_string());
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not start item transaction: {error}"))?;

    let mut copied_photo: Option<PathBuf> = None;

    let result = (|| -> Result<CreatedItem, String> {
        let (item_number, allocated_number) =
            get_next_number(&transaction, category_id)?;

        let series_id: i64 = transaction
            .query_row(
                "SELECT series_id FROM category WHERE id = ?1 AND is_archived = 0",
                [category_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not find category series: {error}"))?;

        let next_number = allocated_number
            .checked_add(1)
            .ok_or_else(|| "The item-number series has reached its numeric limit.".to_string())?;

        let updated_rows = transaction
            .execute(
                "UPDATE item_series
                 SET next_number = ?1
                 WHERE id = ?2 AND next_number = ?3",
                params![next_number, series_id, allocated_number],
            )
            .map_err(|error| format!("Could not advance item-number series: {error}"))?;

        if updated_rows != 1 {
            return Err("The item-number series changed unexpectedly. Please retry.".to_string());
        }

        let gross_weight_milli = gross_weight_milli
            .ok_or_else(|| "Gross weight is required to calculate net weight.".to_string())?;

        let total_diamond_weight_milli_ct = diamonds.iter().try_fold(
            0_i64,
            |total, diamond| {
                total
                    .checked_add(diamond.weight_milli)
                    .ok_or_else(|| "Total diamond weight exceeds the supported range.".to_string())
            },
        )?;

        let diamond_weight_milli_g = total_diamond_weight_milli_ct
            .checked_add(2)
            .ok_or_else(|| "Total diamond weight exceeds the supported range.".to_string())?
            / 5;

        let mut total_stone_weight_milli_g = 0_i64;

        for stone in &stones {
            let weight_unit: String = transaction
                .query_row(
                    "SELECT weight_unit FROM stone_type WHERE id = ?1 AND is_archived = 0",
                    [stone.stone_type_id],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    "A selected stone type is unavailable or archived.".to_string()
                })?;

            let weight_milli_g = match weight_unit.to_lowercase().as_str() {
                "ct" => stone
                    .weight_milli
                    .checked_add(2)
                    .ok_or_else(|| "Total stone weight exceeds the supported range.".to_string())?
                    / 5,
                "g" => stone.weight_milli,
                _ => {
                    return Err(format!(
                        "Unsupported weight unit '{weight_unit}' for a stone type."
                    ));
                }
            };

            total_stone_weight_milli_g = total_stone_weight_milli_g
                .checked_add(weight_milli_g)
                .ok_or_else(|| "Total stone weight exceeds the supported range.".to_string())?;
        }

        let net_weight_milli = gross_weight_milli
            .checked_sub(diamond_weight_milli_g)
            .and_then(|weight| weight.checked_sub(total_stone_weight_milli_g))
            .ok_or_else(|| "Diamond and other-stone weights cannot exceed gross weight.".to_string())?;

        if net_weight_milli < 0 {
            return Err(
                "Diamond and other-stone weights cannot exceed gross weight.".to_string(),
            );
        }

        let (image_path, copied_path) =
            copy_item_photo(&app, image_source.as_deref(), &item_number)?;
        copied_photo = copied_path;

        transaction
            .execute(
                "INSERT INTO item (
                    item_number, category_id, name, image_path, gross_weight_milli,
                    purity_id, gold_type_id, igi_certificate_number, huid, notes, net_weight_milli
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    item_number,
                    category_id,
                    name,
                    image_path,
                    gross_weight_milli,
                    purity_id,
                    gold_type_id,
                    igi_certificate_number,
                    huid,
                    notes,
                    net_weight_milli
                ],
            )
            .map_err(|error| format!("Could not save item: {error}"))?;

        let item_id = transaction.last_insert_rowid();

        for diamond in &diamonds {
            if diamond.weight_milli == 0
                && diamond.pieces.unwrap_or(0) == 0
                && diamond.combination_id.is_none()
            {
                continue;
            }

            transaction
                .execute(
                    "INSERT INTO item_diamond
                        (item_id, shape_id, combination_id, pieces, weight_milli)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        item_id,
                        diamond.shape_id,
                        diamond.combination_id,
                        diamond.pieces,
                        diamond.weight_milli
                    ],
                )
                .map_err(|error| format!("Could not save diamond details: {error}"))?;
        }

        for stone in &stones {
            if stone.weight_milli == 0 && stone.pieces.unwrap_or(0) == 0 {
                continue;
            }

            transaction
                .execute(
                    "INSERT INTO item_stone
                        (item_id, stone_type_id, pieces, weight_milli)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![
                        item_id,
                        stone.stone_type_id,
                        stone.pieces,
                        stone.weight_milli
                    ],
                )
                .map_err(|error| format!("Could not save other-stone details: {error}"))?;
        }

        Ok(CreatedItem {
            id: item_id,
            item_number,
        })
    })();

    match result {
        Ok(created) => {
            if let Err(error) = transaction.commit() {
                if let Some(path) = copied_photo {
                    let _ = std::fs::remove_file(path);
                }
                return Err(format!("Could not commit item: {error}"));
            }
            Ok(created)
        }
        Err(error) => {
            drop(transaction);
            if let Some(path) = copied_photo {
                let _ = std::fs::remove_file(path);
            }
            Err(error)
        }
    }
}
