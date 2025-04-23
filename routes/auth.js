// routes/auth.js
const bcrypt = require('bcrypt');

module.exports = function(app, db, jwt) {
  // Login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
      const user = db.prepare('SELECT id, username, email, password_hash, is_admin FROM users WHERE email = ?').get(email);
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const validPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      const token = jwt.sign(
        { 
          id: user.id, 
          email: user.email, 
          isAdmin: Boolean(user.is_admin) 
        },
        process.env.JWT_SECRET || 'your-secret-key-here',
        { expiresIn: '24h' }
      );
      
      res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: Boolean(user.is_admin)
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Signup
  app.post('/api/auth/signup', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    try {
      // Check if email already exists
      const emailExists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
      if (emailExists) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      // Check if username already exists
      const usernameExists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
      if (usernameExists) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      const result = db.prepare(
        'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
      ).run(username, email, hashedPassword);
      
      const user = db.prepare('SELECT id, username, email, is_admin FROM users WHERE id = ?').get(result.lastInsertRowid);
      
      res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          isAdmin: Boolean(user.is_admin)
        }
      });
    } catch (err) {
      console.error('Signup error:', err);
      res.status(500).json({ error: 'Internal server error during signup' });
    }
  });
};