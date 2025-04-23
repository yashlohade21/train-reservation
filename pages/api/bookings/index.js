import { db } from '../../../lib/db';
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

    if (req.method === 'GET') {
      const bookings = db.prepare(
        'SELECT * FROM bookings WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC'
      ).all(user.id);
      
      return res.json(bookings);
    }
    
    if (req.method === 'POST') {
      const { numSeats } = req.body;
      
      if (numSeats < 1 || numSeats > 7) {
        return res.status(400).json({ error: 'You can book between 1 and 7 seats' });
      }

      // Start transaction
      db.exec('BEGIN TRANSACTION');
      
      // Find available seats
      const availableSeats = db.prepare(
        'SELECT id FROM seats WHERE is_booked = 0 ORDER BY row_number, position_in_row LIMIT ?'
      ).all(numSeats);
      
      if (availableSeats.length < numSeats) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: 'Not enough seats available' });
      }
      
      const seatIds = availableSeats.map(seat => seat.id);
      const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      
      // Create booking
      db.prepare(
        'INSERT INTO bookings (user_id, seat_ids, booking_reference) VALUES (?, ?, ?)'
      ).run(user.id, JSON.stringify(seatIds), bookingRef);
      
      // Update seats
      const updateSeat = db.prepare(
        'UPDATE seats SET is_booked = 1, booked_by = ?, booked_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      
      seatIds.forEach(seatId => {
        updateSeat.run(user.id, seatId);
      });
      
      db.exec('COMMIT');
      
      return res.json({
        success: true,
        bookingRef,
        seatIds,
        message: `Successfully booked ${numSeats} seats`
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err.message === 'No token provided') {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (err.message === 'Invalid token') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    
    console.error('API error:', err);
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Internal server error' });
  }
}