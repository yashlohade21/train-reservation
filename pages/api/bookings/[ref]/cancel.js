import { dbOperations, db } from '../../../../lib/db';
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = authenticateToken(req);
    const { ref } = req.query;
    
    const isProd = process.env.NODE_ENV === 'production';

    if (isProd) {
      // PostgreSQL transaction
      const client = await db.connect();
      
      try {
        await client.query('BEGIN');
        
        const bookingResult = await client.query(
          'SELECT * FROM bookings WHERE booking_reference = $1 AND user_id = $2 AND is_active = true',
          [ref, user.id]
        );
        
        const booking = bookingResult.rows[0];
        
        if (!booking) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Booking not found' });
        }
        
        const seatIds = JSON.parse(booking.seat_ids);
        
        // Free seats
        for (const seatId of seatIds) {
          await client.query(
            'UPDATE seats SET is_booked = false, booked_by = NULL, booked_at = NULL WHERE id = $1',
            [seatId]
          );
        }
        
        // Cancel booking
        await client.query(
          'UPDATE bookings SET is_active = false WHERE id = $1',
          [booking.id]
        );
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'Booking cancelled' });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // SQLite transaction
      db.exec('BEGIN TRANSACTION');
      
      try {
        const booking = db.prepare(
          'SELECT * FROM bookings WHERE booking_reference = ? AND user_id = ? AND is_active = 1'
        ).get(ref, user.id);
        
        if (!booking) {
          db.exec('ROLLBACK');
          return res.status(404).json({ error: 'Booking not found' });
        }
        
        const seatIds = JSON.parse(booking.seat_ids);
        
        // Free seats
        const updateSeat = db.prepare(
          'UPDATE seats SET is_booked = 0, booked_by = NULL, booked_at = NULL WHERE id = ?'
        );
        
        seatIds.forEach(seatId => {
          updateSeat.run(seatId);
        });
        
        // Cancel booking
        db.prepare(
          'UPDATE bookings SET is_active = 0 WHERE id = ?'
        ).run(booking.id);
        
        db.exec('COMMIT');
        res.json({ success: true, message: 'Booking cancelled' });
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  } catch (err) {
    if (err.message === 'No token provided') {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (err.message === 'Invalid token') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    console.error('Cancel booking error:', err);
    return res.status(500).json({ error: 'Failed to cancel booking' });
  }
}