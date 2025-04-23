import { dbOperations } from '../../../lib/db';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, email, password } = req.body;
    
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
  }

  try {
    console.log('Starting signup process...');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Database URL exists:', !!process.env.POSTGRES_URL);

    // Check if email already exists
    const emailExists = await dbOperations.queryOne(
      'SELECT 1 FROM users WHERE email = ?',
      [email]
    );
    if (emailExists) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Check if username already exists
    const usernameExists = await dbOperations.queryOne(
      'SELECT 1 FROM users WHERE username = ?',
      [username]
    );
    if (usernameExists) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    let userId;
    if (process.env.NODE_ENV === 'production') {
      // For PostgreSQL, use RETURNING
      const result = await dbOperations.queryOne(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?) RETURNING id',
        [username, email, hashedPassword]
      );
      userId = result.id;
    } else {
      // For SQLite
      const result = await dbOperations.execute(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
        [username, email, hashedPassword]
      );
      userId = result.lastInsertRowid;
    }
    
    const user = await dbOperations.queryOne(
      'SELECT id, username, email, is_admin FROM users WHERE id = ?',
      [userId]
    );

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        isAdmin: Boolean(user.is_admin) 
      },
      process.env.JWT_SECRET || 'your-secret-key-here',
      { expiresIn: '24h' }
    );
    
    console.log('Signup successful for:', email);
    
    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: Boolean(user.is_admin)
      }
    });
  } catch (err) {
    console.error('Signup error details:', err);
    res.status(500).json({ error: 'Internal server error during signup. Please try again.' });
  }
}