import { db } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const seats = db.prepare('SELECT * FROM seats ORDER BY row_number, position_in_row').all();
    res.json(seats);
  } catch (err) {
    console.error('Error fetching seats:', err);
    res.status(500).json({ error: 'Failed to fetch seats' });
  }
}