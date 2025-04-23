// routes/seats.js
module.exports = function(app, db, authenticateToken) {
  // Get all seats
  app.get('/api/seats', async (req, res) => {
    try {
      const seats = db.prepare('SELECT * FROM seats ORDER BY row_number, position_in_row').all();
      res.json(seats);
    } catch (err) {
      console.error('Error fetching seats:', err);
      res.status(500).json({ error: 'Failed to fetch seats' });
    }
  });

  // Get a specific seat
  app.get('/api/seats/:id', authenticateToken, async (req, res) => {
    try {
      const seat = db.prepare('SELECT * FROM seats WHERE id = ?').get(req.params.id);
      if (!seat) {
        return res.status(404).json({ error: 'Seat not found' });
      }
      res.json(seat);
    } catch (err) {
      console.error('Error fetching seat:', err);
      res.status(500).json({ error: 'Failed to fetch seat' });
    }
  });
};