import { Pool } from 'pg';
import Database from 'better-sqlite3';
import { join } from 'path';

let db;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  // PostgreSQL for production
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL environment variable is required in production');
  }
  
  try {
    db = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });
    
    // Create tables in PostgreSQL if they don't exist
    const createTables = async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(255) UNIQUE NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_admin BOOLEAN DEFAULT FALSE
        );

        CREATE TABLE IF NOT EXISTS seats (
          id SERIAL PRIMARY KEY,
          seat_number VARCHAR(10) UNIQUE NOT NULL,
          row_number INTEGER NOT NULL,
          position_in_row INTEGER NOT NULL,
          is_booked BOOLEAN DEFAULT FALSE,
          booked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          booked_at TIMESTAMP,
          UNIQUE(row_number, position_in_row)
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
          seat_ids TEXT NOT NULL,
          booking_reference VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
        );
      `);

      // Check if seats need to be initialized
      const seatsExist = await db.query('SELECT 1 FROM seats LIMIT 1');
      if (seatsExist.rows.length === 0) {
        // Initialize seats
        for (let row = 1; row <= 11; row++) {
          for (let pos = 1; pos <= 7; pos++) {
            await db.query(
              'INSERT INTO seats (seat_number, row_number, position_in_row) VALUES ($1, $2, $3)',
              [`R${row}-S${pos}`, row, pos]
            );
          }
        }
        for (let pos = 1; pos <= 3; pos++) {
          await db.query(
            'INSERT INTO seats (seat_number, row_number, position_in_row) VALUES ($1, $2, $3)',
            [`R12-S${pos}`, 12, pos]
          );
        }
      }
    };

    // Initialize tables
    createTables().catch(err => {
      console.error('Error creating tables:', err);
    });

  } catch (err) {
    console.error('Failed to initialize PostgreSQL:', err);
    throw err;
  }
} else {
  // SQLite for development
  if (!global.db) {
    try {
      global.db = new Database(join(process.cwd(), 'database.sqlite'));
      
      global.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_admin INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS seats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          seat_number TEXT UNIQUE NOT NULL,
          row_number INTEGER NOT NULL,
          position_in_row INTEGER NOT NULL,
          is_booked INTEGER DEFAULT 0,
          booked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          booked_at TIMESTAMP,
          UNIQUE(row_number, position_in_row)
        );

        CREATE TABLE IF NOT EXISTS bookings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
          seat_ids TEXT NOT NULL,
          booking_reference TEXT UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active INTEGER DEFAULT 1
        );
      `);

      const seatsExist = global.db.prepare('SELECT 1 FROM seats LIMIT 1').get();
      if (!seatsExist) {
        const insertSeat = global.db.prepare('INSERT INTO seats (seat_number, row_number, position_in_row) VALUES (?, ?, ?)');
        
        global.db.transaction(() => {
          for (let row = 1; row <= 11; row++) {
            for (let pos = 1; pos <= 7; pos++) {
              insertSeat.run(`R${row}-S${pos}`, row, pos);
            }
          }
          for (let pos = 1; pos <= 3; pos++) {
            insertSeat.run(`R12-S${pos}`, 12, pos);
          }
        })();
      }
    } catch (err) {
      console.error('Failed to initialize SQLite:', err);
      throw err;
    }
  }
  db = global.db;
}

// Convert ? placeholders to $1, $2, etc. for PostgreSQL
function convertPlaceholders(sql) {
  if (!isProd) return sql;
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

// Helper functions for database operations
export const dbOperations = {
  async query(sql, params = []) {
    try {
      if (isProd) {
        const result = await db.query(convertPlaceholders(sql), params);
        return result.rows;
      } else {
        return db.prepare(sql).all(params);
      }
    } catch (err) {
      console.error('Database query error:', err);
      throw err;
    }
  },

  async queryOne(sql, params = []) {
    try {
      if (isProd) {
        const result = await db.query(convertPlaceholders(sql), params);
        return result.rows[0];
      } else {
        return db.prepare(sql).get(params);
      }
    } catch (err) {
      console.error('Database queryOne error:', err);
      throw err;
    }
  },

  async execute(sql, params = []) {
    try {
      if (isProd) {
        const result = await db.query(convertPlaceholders(sql), params);
        // For PostgreSQL, return an object with lastInsertRowid
        if (sql.toLowerCase().includes('insert')) {
          return { lastInsertRowid: result.rows[0]?.id };
        }
        return result;
      } else {
        return db.prepare(sql).run(params);
      }
    } catch (err) {
      console.error('Database execute error:', err);
      throw err;
    }
  }
};

export { db };