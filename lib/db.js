import { Pool } from 'pg';
import Database from 'better-sqlite3';
import { join } from 'path';

let db;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  // PostgreSQL for production
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Database URL environment variable is required in production');
  }
  
  try {
    db = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Create tables in PostgreSQL if they don't exist
    const createTables = async () => {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        // Create tables
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_admin BOOLEAN DEFAULT FALSE
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS seats (
            id SERIAL PRIMARY KEY,
            seat_number VARCHAR(10) UNIQUE NOT NULL,
            row_number INTEGER NOT NULL,
            position_in_row INTEGER NOT NULL,
            is_booked BOOLEAN DEFAULT FALSE,
            booked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            booked_at TIMESTAMP,
            UNIQUE(row_number, position_in_row)
          )
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE NOT NULL,
            seat_ids TEXT NOT NULL,
            booking_reference VARCHAR(255) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
          )
        `);

        // Reset all seats to available
        await client.query('UPDATE seats SET is_booked = false, booked_by = NULL, booked_at = NULL');

        // Check if seats need to be initialized
        const seatsExist = await client.query('SELECT COUNT(*) FROM seats');
        if (parseInt(seatsExist.rows[0].count) === 0) {
          console.log('Initializing seats in production...');
          
          // Initialize seats
          // Rows 1-11 have 7 seats each
          for (let row = 1; row <= 11; row++) {
            for (let pos = 1; pos <= 7; pos++) {
              await client.query(
                'INSERT INTO seats (seat_number, row_number, position_in_row, is_booked) VALUES ($1, $2, $3, $4)',
                [`R${row}-S${pos}`, row, pos, false]
              );
            }
          }
          // Row 12 has 3 seats
          for (let pos = 1; pos <= 3; pos++) {
            await client.query(
              'INSERT INTO seats (seat_number, row_number, position_in_row, is_booked) VALUES ($1, $2, $3, $4)',
              [`R12-S${pos}`, 12, pos, false]
            );
          }
        }

        await client.query('COMMIT');
        console.log('Database initialized successfully');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error initializing database:', err);
        throw err;
      } finally {
        client.release();
      }
    };

    // Initialize tables
    createTables().catch(err => {
      console.error('Failed to initialize database:', err);
      process.exit(1); // Exit if database initialization fails
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
        const insertSeat = global.db.prepare(
          'INSERT INTO seats (seat_number, row_number, position_in_row) VALUES (?, ?, ?)'
        );
        
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

// Helper functions for database operations
export const dbOperations = {
  async query(sql, params = []) {
    if (isProd) {
      const client = await db.connect();
      try {
        const result = await client.query(sql, params);
        return result.rows;
      } catch (err) {
        console.error('Database query error:', err);
        throw err;
      } finally {
        client.release();
      }
    } else {
      try {
        return db.prepare(sql).all(params);
      } catch (err) {
        console.error('Database query error:', err);
        throw err;
      }
    }
  },

  async queryOne(sql, params = []) {
    if (isProd) {
      const client = await db.connect();
      try {
        const result = await client.query(sql, params);
        return result.rows[0];
      } catch (err) {
        console.error('Database queryOne error:', err);
        throw err;
      } finally {
        client.release();
      }
    } else {
      try {
        return db.prepare(sql).get(params);
      } catch (err) {
        console.error('Database queryOne error:', err);
        throw err;
      }
    }
  },

  async execute(sql, params = []) {
    if (isProd) {
      const client = await db.connect();
      try {
        const result = await client.query(sql, params);
        return result;
      } catch (err) {
        console.error('Database execute error:', err);
        throw err;
      } finally {
        client.release();
      }
    } else {
      try {
        return db.prepare(sql).run(params);
      } catch (err) {
        console.error('Database execute error:', err);
        throw err;
      }
    }
  }
};

// Export the database instance
export { db };