// routes/admin.js
module.exports = function(app, pool, authenticateToken) {
    // Reset all bookings (admin only)
    app.post('/api/admin/reset', authenticateToken, async (req, res) => {
      if (!req.user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        // Reset seats
        await client.query(
          `UPDATE seats 
           SET is_booked = false, booked_by = NULL, booked_at = NULL`
        );
        
        // Cancel all bookings
        await client.query(
          `UPDATE bookings SET is_active = false WHERE is_active = true`
        );
        
        await client.query('COMMIT');
        res.json({ success: true, message: 'All bookings reset' });
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('Reset error:', err);
        res.status(500).json({ error: 'Failed to reset bookings' });
      } finally {
        client.release();
      }
    });
  };