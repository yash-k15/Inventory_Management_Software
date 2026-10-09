
import Database from '@tauri-apps/plugin-sql';

let database: Database | null = null;
let databasePromise: Promise<Database> | null = null;

export async function getDatabase(): Promise<Database> {
  if (database) {
    return database;
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = Database.load('sqlite:inventory.db');

  try {
    database = await databasePromise;
    return database;
  } catch (error) {
    databasePromise = null;
    throw error;
  }
}
