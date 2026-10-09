import Database from '@tauri-apps/plugin-sql';

const DATABASE_URL = import.meta.env.DEV
  ? 'sqlite:inventory-dev.db'
  : 'sqlite:inventory.db';

let database: Database | null = null;
let databasePromise: Promise<Database> | null = null;

export async function getDatabase(): Promise<Database> {
  if (database) {
    return database;
  }

  if (databasePromise) {
    return databasePromise;
  }
  
  databasePromise = Database.load(DATABASE_URL);

  try {
    database = await databasePromise;
    return database;
  } catch (error) {
    databasePromise = null;
    throw error;
  }
}