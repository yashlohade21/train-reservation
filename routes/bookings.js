// routes/bookings.js
module.exports = function(app, db, authenticateToken) {
  // Get user bookings
  app.get('/api/bookings', authenticateToken, async (req, res) => {
    try {
      const bookings = db.prepare(
        'SELECT * FROM bookings WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC'
      ).all(req.user.id);
      
      res.json(bookings);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      res.status(500).json({ error: 'Failed to fetch bookings' });
    }
  });

  // Create booking
  app.post('/api/bookings', authenticateToken, async (req, res) => {
    const { numSeats } = req.body;
    
    try {
      if (numSeats < 1 || numSeats > 7) {
        return res.status(400).json({ error: 'You can book between 1 and 7 seats' });
      }

      // Start transaction
      db.exec('BEGIN TRANSACTION');
      
      // First check total available seats
      const totalAvailableSeats = db.prepare(
        'SELECT COUNT(*) as count FROM seats WHERE is_booked = 0'
      ).get().count;

      if (totalAvailableSeats < numSeats) {
        db.exec('ROLLBACK');
        return res.status(400).json({ error: 'Not enough seats available' });
      }

      // Find available seats
      const availableSeats = db.prepare(
        'SELECT id FROM seats WHERE is_booked = 0 ORDER BY row_number, position_in_row LIMIT ?'
      ).all(numSeats);
      
      const seatIds = availableSeats.map(seat => seat.id);
      const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 10).toUpperCase();
      
      // Create booking
      db.prepare(
        'INSERT INTO bookings (user_id, seat_ids, booking_reference) VALUES (?, ?, ?)'
      ).run(req.user.id, JSON.stringify(seatIds), bookingRef);
      
      // Update seats
      const updateSeat = db.prepare(
        'UPDATE seats SET is_booked = 1, booked_by = ?, booked_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      
      seatIds.forEach(seatId => {
        updateSeat.run(req.user.id, seatId);
      });
      
      db.exec('COMMIT');
      
      res.json({
        success: true,
        bookingRef,
        seatIds,
        message: `Successfully booked ${numSeats} seats`
      });
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('Booking error:', err);
      res.status(500).json({ error: 'Failed to book seats' });
    }
  });

  // Cancel booking
  app.post('/api/bookings/:ref/cancel', authenticateToken, async (req, res) => {
    const { ref } = req.params;
    
    try {
      db.exec('BEGIN TRANSACTION');
      
      const booking = db.prepare(
        'SELECT * FROM bookings WHERE booking_reference = ? AND user_id = ? AND is_active = 1'
      ).get(ref, req.user.id);
      
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
      console.error('Cancel booking error:', err);
      res.status(500).json({ error: 'Failed to cancel booking' });
    }
  });
};