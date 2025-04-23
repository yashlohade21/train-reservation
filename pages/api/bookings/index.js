import { dbOperations, db } from '../../../lib/db';
import jwt from 'jsonwebtoken';

// Authentication middleware
function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    throw new Error('No token provided');
  }
  
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-here');
    return user;
  } catch (err) {
    throw new Error('Invalid token');
  }
}

// Helper function to find best available seats
async function findBestAvailableSeats(client, numSeats, isProd) {
  if (isProd) {
    try {
      // First try to find seats in the same row with proper locking
      const sameRowQuery = `
        WITH AvailableSeatsInRows AS (
          SELECT 
            row_number,
            COUNT(*) as available_seats,
            array_agg(id ORDER BY position_in_row) as seat_ids,
            array_agg(position_in_row ORDER BY position_in_row) as positions
          FROM seats 
          WHERE is_booked = false
          AND booked_by IS NULL
          GROUP BY row_number
          HAVING COUNT(*) >= $1
          ORDER BY row_number
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        SELECT 
          s.id,
          s.row_number,
          s.position_in_row,
          s.seat_number
        FROM AvailableSeatsInRows ar
        JOIN seats s ON s.row_number = ar.row_number 
          AND s.id = ANY(ar.seat_ids)
        WHERE s.is_booked = false
        AND s.booked_by IS NULL
        ORDER BY s.position_in_row
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `;

      const result = await client.query(sameRowQuery, [numSeats]);
      
      if (result.rows.length === numSeats) {
        return result.rows;
      }

      // If no single row has enough seats, find nearest available seats with locking
      const nearbySeatsQuery = `
        SELECT 
          id,
          row_number,
          position_in_row,
          seat_number
        FROM seats
        WHERE is_booked = false
        AND booked_by IS NULL
        ORDER BY row_number, position_in_row
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      `;

      const nearbyResult = await client.query(nearbySeatsQuery, [numSeats]);
      return nearbyResult.rows;
    } catch (err) {
      console.error('Error finding seats:', err);
      throw err;
    }
  } else {
    // SQLite queries
    const availableRow = db.prepare(`
      SELECT row_number, COUNT(*) as count
      FROM seats
      WHERE is_booked = 0 
      AND booked_by IS NULL
      GROUP BY row_number
      HAVING count >= ?
      ORDER BY row_number
      LIMIT 1
    `).get(numSeats);

    if (availableRow) {
      return db.prepare(`
        SELECT id, row_number, position_in_row, seat_number
        FROM seats
        WHERE row_number = ? 
        AND is_booked = 0 
        AND booked_by IS NULL
        ORDER BY position_in_row
        LIMIT ?
      `).all(availableRow.row_number, numSeats);
    }

    return db.prepare(`
      SELECT id, row_number, position_in_row, seat_number
      FROM seats
      WHERE is_booked = 0 
      AND booked_by IS NULL
      ORDER BY row_number, position_in_row
      LIMIT ?
    `).all(numSeats);
  }
}

export default async function handler(req, res) {
  let client = null;
  
  try {
    const user = authenticateToken(req);
    const isProd = process.env.NODE_ENV === 'production';

    if (req.method === 'GET') {
      try {
        const bookings = await dbOperations.query(
          isProd ?
          'SELECT b.*, array_agg(json_build_object(\'seat_number\', s.seat_number, \'row_number\', s.row_number, \'position_in_row\', s.position_in_row)) as seat_details FROM bookings b LEFT JOIN seats s ON s.id = ANY(string_to_array(b.seat_ids, \',\')::integer[]) WHERE b.user_id = $1 AND b.is_active = true GROUP BY b.id ORDER BY b.created_at DESC' :
          'SELECT * FROM bookings WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
          [user.id]
        );

        if (!isProd) {
          // Process SQLite bookings
          const processedBookings = await Promise.all(bookings.map(async (booking) => {
            try {
              const seatIds = JSON.parse(booking.seat_ids || '[]');
              if (seatIds.length === 0) return booking;

              const seatDetails = await dbOperations.query(
                'SELECT seat_number, row_number, position_in_row FROM seats WHERE id IN (' + 
                seatIds.map(() => '?').join(',') + ')',
                seatIds
              );

              return {
                ...booking,
                seat_ids: seatIds,
                seat_details: seatDetails
              };
            } catch (err) {
              console.error('Error processing booking:', booking.id, err);
              return booking;
            }
          }));
          return res.status(200).json(processedBookings);
        }

        return res.status(200).json(bookings || []);
      } catch (err) {
        console.error('Database query error:', err);
        return res.status(500).json({ error: 'Failed to fetch bookings', details: err.message });
      }
    }

    if (req.method === 'POST') {
      const { numSeats } = req.body;
      
      if (!numSeats || isNaN(numSeats)) {
        return res.status(400).json({ error: 'Invalid number of seats requested' });
      }
      
      if (numSeats < 1 || numSeats > 7) {
        return res.status(400).json({ error: 'You can book between 1 and 7 seats' });
      }

      if (isProd) {
        client = await db.connect();
        
        try {
          await client.query('BEGIN');

          // Check if user already has active bookings
          const userBookings = await client.query(
            'SELECT COUNT(*) FROM bookings WHERE user_id = $1 AND is_active = true',
            [user.id]
          );

          if (userBookings.rows[0].count > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'You already have an active booking. Please cancel it before making a new one.'
            });
          }

          // Get total available seats
          const totalAvailableResult = await client.query(
            'SELECT COUNT(*) as count FROM seats WHERE is_booked = false AND booked_by IS NULL'
          );

          if (totalAvailableResult.rows[0].count < numSeats) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'Not enough seats available',
              requested: numSeats,
              available: totalAvailableResult.rows[0].count
            });
          }

          // Find best available seats
          const availableSeatsQuery = `
            SELECT id, row_number, position_in_row, seat_number
            FROM seats
            WHERE is_booked = false AND booked_by IS NULL
            ORDER BY row_number, position_in_row
            LIMIT $1
            FOR UPDATE SKIP LOCKED
          `;

          const availableSeats = await client.query(availableSeatsQuery, [numSeats]);
          
          if (!availableSeats.rows || availableSeats.rows.length < numSeats) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'Could not find suitable seats',
              requested: numSeats,
              available: availableSeats?.rows?.length || 0
            });
          }

          const seatIds = availableSeats.rows.map(seat => seat.id);
          const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 10).toUpperCase();

          // Create booking
          await client.query(
            'INSERT INTO bookings (user_id, seat_ids, booking_reference, is_active) VALUES ($1, $2, $3, true)',
            [user.id, seatIds.join(','), bookingRef]
          );

          // Update seats
          await client.query(
            'UPDATE seats SET is_booked = true, booked_by = $1, booked_at = CURRENT_TIMESTAMP WHERE id = ANY($2::int[])',
            [user.id, seatIds]
          );

          await client.query('COMMIT');

          const seatDetails = availableSeats.rows.map(seat => ({
            id: seat.id,
            row_number: seat.row_number,
            position_in_row: seat.position_in_row,
            seat_number: seat.seat_number
          }));

          return res.status(200).json({
            success: true,
            bookingRef,
            seatIds,
            seatDetails,
            message: `Successfully booked ${numSeats} seats`
          });

        } catch (err) {
          if (client) {
            await client.query('ROLLBACK');
          }
          console.error('Booking error:', err);
          return res.status(500).json({ 
            error: 'Failed to book seats',
            details: err.message
          });
        } finally {
          if (client) {
            client.release();
          }
        }
      } else {
        // SQLite transaction
        db.exec('BEGIN TRANSACTION');
        
        try {
          const userBookings = db.prepare(
            'SELECT COUNT(*) as count FROM bookings WHERE user_id = ? AND is_active = 1'
          ).get(user.id);

          if (userBookings.count > 0) {
            db.exec('ROLLBACK');
            return res.status(400).json({ 
              error: 'You already have an active booking. Please cancel it before making a new one.'
            });
          }

          const totalAvailable = db.prepare(
            'SELECT COUNT(*) as count FROM seats WHERE is_booked = 0 AND booked_by IS NULL'
          ).get().count;

          if (totalAvailable < numSeats) {
            db.exec('ROLLBACK');
            return res.status(400).json({ 
              error: 'Not enough seats available',
              requested: numSeats,
              available: totalAvailable
            });
          }

          const availableSeats = db.prepare(`
            SELECT id, row_number, position_in_row, seat_number
            FROM seats
            WHERE is_booked = 0 AND booked_by IS NULL
            ORDER BY row_number, position_in_row
            LIMIT ?
          `).all(numSeats);
          
          if (availableSeats.length < numSeats) {
            db.exec('ROLLBACK');
            return res.status(400).json({ 
              error: 'Could not find suitable seats',
              requested: numSeats,
              available: availableSeats.length
            });
          }

          const seatIds = availableSeats.map(seat => seat.id);
          const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 10).toUpperCase();
          
          db.prepare(
            'INSERT INTO bookings (user_id, seat_ids, booking_reference, is_active) VALUES (?, ?, ?, 1)'
          ).run(user.id, JSON.stringify(seatIds), bookingRef);
          
          const updateSeat = db.prepare(
            'UPDATE seats SET is_booked = 1, booked_by = ?, booked_at = CURRENT_TIMESTAMP WHERE id = ?'
          );
          
          seatIds.forEach(seatId => {
            updateSeat.run(user.id, seatId);
          });
          
          db.exec('COMMIT');

          const seatDetails = availableSeats.map(seat => ({
            id: seat.id,
            row_number: seat.row_number,
            position_in_row: seat.position_in_row,
            seat_number: seat.seat_number
          }));
          
          return res.status(200).json({
            success: true,
            bookingRef,
            seatIds,
            seatDetails,
            message: `Successfully booked ${numSeats} seats`
          });
        } catch (err) {
          db.exec('ROLLBACK');
          console.error('Booking error:', err);
          return res.status(500).json({ 
            error: 'Failed to book seats',
            details: err.message
          });
        }
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    if (err.message === 'No token provided') {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (err.message === 'Invalid token') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    return res.status(500).json({ 
      error: err.message || 'Internal server error',
      details: err.stack
    });
  } finally {
    if (client) {
      client.release();
    }
  }
}
