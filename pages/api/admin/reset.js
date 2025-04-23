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
    if (!user.isAdmin) {
      throw new Error('Admin access required');
    }
    return user;
  } catch (err) {
    throw new Error(err.message || 'Invalid token');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    authenticateToken(req);
    
    db.exec('BEGIN TRANSACTION');
    
    // Reset seats
    db.prepare(
      'UPDATE seats SET is_booked = 0, booked_by = NULL, booked_at = NULL'
    ).run();
    
    // Cancel all bookings
    db.prepare(
      'UPDATE bookings SET is_active = 0 WHERE is_active = 1'
    ).run();
    
    db.exec('COMMIT');
    res.json({ success: true, message: 'All bookings reset' });
  } catch (err) {
    if (err.message === 'No token provided') {
      return res.status(401).json({ error: 'No token provided' });
    }
    if (err.message === 'Invalid token') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    if (err.message === 'Admin access required') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.error('Reset error:', err);
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to reset bookings' });
  }
}