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
    // First try to find seats in the same row
    const sameRowQuery = `
      WITH AvailableSeatsInRows AS (
        SELECT 
          row_number,
          COUNT(*) as available_seats,
          array_agg(id ORDER BY position_in_row) as seat_ids,
          array_agg(position_in_row ORDER BY position_in_row) as positions
        FROM seats 
        WHERE is_booked = false
        GROUP BY row_number
        HAVING COUNT(*) >= $1
        ORDER BY row_number
        LIMIT 1
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
      ORDER BY s.position_in_row
      LIMIT $1
    `;

    const result = await client.query(sameRowQuery, [numSeats]);
    
    if (result.rows.length === numSeats) {
      return result.rows;
    }

    // If no single row has enough seats, find nearest available seats
    const nearbySeatsQuery = `
      WITH AvailableSeats AS (
        SELECT 
          id,
          row_number,
          position_in_row,
          seat_number,
          ROW_NUMBER() OVER (ORDER BY row_number, position_in_row) as rn
        FROM seats
        WHERE is_booked = false
      )
      SELECT 
        s1.id,
        s1.row_number,
        s1.position_in_row,
        s1.seat_number,
        MIN(s2.row_number) OVER () as min_row,
        MAX(s2.row_number) OVER () as max_row
      FROM AvailableSeats s1
      JOIN AvailableSeats s2 ON s2.rn <= s1.rn
      GROUP BY s1.id, s1.row_number, s1.position_in_row, s1.seat_number, s1.rn
      HAVING COUNT(*) <= $1
      ORDER BY ABS(s1.row_number - (SELECT AVG(row_number) FROM AvailableSeats WHERE rn <= $1)),
               s1.row_number,
               s1.position_in_row
      LIMIT $1
    `;

    const nearbyResult = await client.query(nearbySeatsQuery, [numSeats]);
    return nearbyResult.rows;
  } else {
    // SQLite queries
    // First try to find seats in the same row
    const availableRow = db.prepare(`
      SELECT row_number, COUNT(*) as count
      FROM seats
      WHERE is_booked = 0
      GROUP BY row_number
      HAVING count >= ?
      ORDER BY row_number
      LIMIT 1
    `).get(numSeats);

    if (availableRow) {
      return db.prepare(`
        SELECT id, row_number, position_in_row, seat_number
        FROM seats
        WHERE row_number = ? AND is_booked = 0
        ORDER BY position_in_row
        LIMIT ?
      `).all(availableRow.row_number, numSeats);
    }

    // If no single row has enough seats, find nearest available seats
    return db.prepare(`
      SELECT id, row_number, position_in_row, seat_number
      FROM seats
      WHERE is_booked = 0
      ORDER BY row_number, position_in_row
      LIMIT ?
    `).all(numSeats);
  }
}

export default async function handler(req, res) {
  try {
    const user = authenticateToken(req);
    const isProd = process.env.NODE_ENV === 'production';

    if (req.method === 'GET') {
      try {
        if (isProd) {
          // PostgreSQL query
          const result = await dbOperations.query(
            'SELECT b.*, array_agg(json_build_object(\'seat_number\', s.seat_number, \'row_number\', s.row_number, \'position_in_row\', s.position_in_row)) as seat_details FROM bookings b LEFT JOIN seats s ON s.id = ANY(string_to_array(b.seat_ids, \',\')::integer[]) WHERE b.user_id = $1 AND b.is_active = true GROUP BY b.id ORDER BY b.created_at DESC',
            [user.id]
          );
          return res.status(200).json(result || []);
        } else {
          // SQLite query
          try {
            // First get all active bookings for the user
            const bookings = await dbOperations.query(
              'SELECT * FROM bookings WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
              [user.id]
            );

            // Process each booking to include seat details
            const processedBookings = await Promise.all(bookings.map(async (booking) => {
              try {
                const seatIds = JSON.parse(booking.seat_ids || '[]');
                if (seatIds.length === 0) return booking;

                // Get seat details
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
          } catch (err) {
            console.error('SQLite query error:', err);
            throw err;
          }
        }
      } catch (err) {
        console.error('Database query error:', err);
        return res.status(500).json({ error: 'Failed to fetch bookings from database' });
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
        // PostgreSQL transaction
        const client = await db.connect();
        
        try {
          await client.query('BEGIN');

          // Get total available seats
          const totalAvailableResult = await client.query(
            'SELECT COUNT(*) as count FROM seats WHERE is_booked = false'
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
          const availableSeats = await findBestAvailableSeats(client, numSeats, true);
          
          if (!availableSeats || availableSeats.length < numSeats) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'Could not find suitable seats',
              requested: numSeats,
              available: availableSeats?.length || 0
            });
          }

          const seatIds = availableSeats.map(seat => seat.id);
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

          // Get seat details for response
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
          await client.query('ROLLBACK');
          console.error('Booking error:', err);
          return res.status(500).json({ 
            error: 'Failed to book seats',
            details: err.message
          });
        } finally {
          client.release();
        }
      } else {
        // SQLite transaction
        db.exec('BEGIN TRANSACTION');
        
        try {
          // Get total available seats
          const totalAvailable = db.prepare(
            'SELECT COUNT(*) as count FROM seats WHERE is_booked = 0'
          ).get().count;

          if (totalAvailable < numSeats) {
            db.exec('ROLLBACK');
            return res.status(400).json({ 
              error: 'Not enough seats available',
              requested: numSeats,
              available: totalAvailable
            });
          }

          // Find best available seats
          const availableSeats = await findBestAvailableSeats(db, numSeats, false);
          
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
          
          // Create booking
          db.prepare(
            'INSERT INTO bookings (user_id, seat_ids, booking_reference, is_active) VALUES (?, ?, ?, 1)'
          ).run(user.id, JSON.stringify(seatIds), bookingRef);
          
          // Update seats
          const updateSeat = db.prepare(
            'UPDATE seats SET is_booked = 1, booked_by = ?, booked_at = CURRENT_TIMESTAMP WHERE id = ?'
          );
          
          seatIds.forEach(seatId => {
            updateSeat.run(user.id, seatId);
          });
          
          db.exec('COMMIT');

          // Get seat details for response
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
      error: err.message || 'Internal server error'
    });
  }
}