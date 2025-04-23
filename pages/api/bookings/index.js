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

          // Simple query to get available seats
          const availableSeatsResult = await client.query(
            'SELECT id FROM seats WHERE is_booked = false ORDER BY row_number, position_in_row LIMIT $1',
            [numSeats]
          );

          if (availableSeatsResult.rows.length < numSeats) {
            console.error('Not enough seats available:', {
              requested: numSeats,
              available: availableSeatsResult.rows.length
            });
            await client.query('ROLLBACK');
            return res.status(400).json({ 
              error: 'Not enough seats available',
              requested: numSeats,
              available: availableSeatsResult.rows.length
            });
          }

          const seatIds = availableSeatsResult.rows.map(seat => seat.id);
          const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 10).toUpperCase();

          // Create booking first
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

          console.log('Booking successful:', {
            bookingRef,
            numSeats,
            seatIds
          });

          return res.status(200).json({
            success: true,
            bookingRef,
            seatIds,
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
          // Find available seats
          const availableSeats = db.prepare(
            'SELECT id FROM seats WHERE is_booked = 0 ORDER BY row_number, position_in_row LIMIT ?'
          ).all(numSeats);
          
          if (availableSeats.length < numSeats) {
            db.exec('ROLLBACK');
            return res.status(400).json({ 
              error: 'Not enough seats available',
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
          
          return res.status(200).json({
            success: true,
            bookingRef,
            seatIds,
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