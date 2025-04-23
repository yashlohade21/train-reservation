/**
 * Dashboard Component
 * 
 * Main interface for the train seat reservation system.
 * Handles seat booking, booking management, and displays the seat map.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Dashboard.module.css';

export default function Dashboard() {
  // State management for user data and UI
  const [user, setUser] = useState(null);
  const [seats, setSeats] = useState([]);
  const [numSeats, setNumSeats] = useState(1);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  // Initialize dashboard data on component mount
  useEffect(() => {
    const initializeDashboard = async () => {
      const token = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      
      if (!token || !storedUser) {
        router.push('/login');
        return;
      }

      try {
        setUser(JSON.parse(storedUser));
        setIsLoading(true);
        await Promise.all([fetchSeats(), fetchBookings()]);
      } catch (err) {
        console.error('Dashboard initialization error:', err);
        setError('Failed to initialize dashboard. Please try refreshing the page.');
      } finally {
        setIsLoading(false);
      }
    };

    initializeDashboard();
  }, [router]);

  /**
   * Fetches current seat status from the server
   */
  const fetchSeats = async () => {
    try {
      const response = await fetch('/api/seats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login');
          return;
        }
        throw new Error('Failed to fetch seats');
      }
      
      const data = await response.json();
      setSeats(data);
    } catch (err) {
      console.error('Fetch seats error:', err);
      setError('Failed to load seat data');
    }
  };

  /**
   * Fetches user's active bookings
   */
  const fetchBookings = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/bookings', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          router.push('/login');
          return;
        }
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch bookings');
      }

      const data = await response.json();
      
      // Ensure we have an array of bookings
      const bookingsArray = Array.isArray(data) ? data : [];
      
      // Process the bookings to ensure seat_ids is always an array
      const processedBookings = bookingsArray.map(booking => ({
        ...booking,
        seat_details: Array.isArray(booking.seat_details) ? booking.seat_details : 
                 typeof booking.seat_details === 'string' ? booking.seat_details.split(',').map(id => parseInt(id)) :
                 []
      }));
      
      setBookings(processedBookings);
    } catch (err) {
      console.error('Fetch bookings error:', err);
      setError('Failed to load bookings. Please try refreshing the page.');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles the seat booking process
   * Validates input and sends booking request to server
   */
  const handleBookSeats = async () => {
    setError('');
    setSuccess('');
    setIsLoading(true);
    
    try {
      if (numSeats < 1 || numSeats > 7) {
        setError('You can book between 1 and 7 seats at a time');
        return;
      }
  
      const token = localStorage.getItem('token');
      if (!token) {
        router.push('/login');
        return;
      }
  
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ numSeats }),
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data.error || 'Failed to book seats');
      }
  
      setSuccess(`Successfully booked ${numSeats} seats. Reference: ${data.bookingRef}`);
      await Promise.all([fetchSeats(), fetchBookings()]);
      
    } catch (err) {
      console.error('Booking error:', err);
      setError(err.message || 'An error occurred while booking seats');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles booking cancellation
   * @param {string} bookingRef - Booking reference number
   */
  const handleCancelBooking = async (bookingRef) => {
    setError('');
    setSuccess('');
    setIsLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/bookings/${bookingRef}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to cancel booking');
      }

      setSuccess('Booking cancelled successfully');
      await Promise.all([fetchSeats(), fetchBookings()]);
    } catch (err) {
      console.error('Cancel booking error:', err);
      setError(err.message || 'Failed to cancel booking');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Admin function to reset all bookings
   * Requires confirmation before execution
   */
  const handleResetAll = async () => {
    if (!window.confirm('Are you sure you want to reset all bookings? This cannot be undone.')) {
      return;
    }

    setError('');
    setSuccess('');
    setIsLoading(true);
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset bookings');
      }

      setSuccess('All bookings have been reset');
      await Promise.all([fetchSeats(), fetchBookings()]);
    } catch (err) {
      console.error('Reset error:', err);
      setError(err.message || 'Failed to reset bookings');
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles user logout
   * Clears local storage and redirects to home
   */
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/');
  };

  // Loading state handler
  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}>Loading...</div>
      </div>
    );
  }

  // Authentication check
  if (!user) {
    router.push('/login');
    return null;
  }

  // Main dashboard render
  return (
    <div className={styles.container}>
      <Head>
        <title>Dashboard | Train Seat Reservation</title>
      </Head>

      <header className={styles.header}>
        <h1>Welcome, {user.username}</h1>
        <button onClick={handleLogout} className={styles.logoutButton}>Logout</button>
      </header>

      <main className={styles.main}>
        {error && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}
        
        <section className={styles.bookingSection}>
          <h2>Book Your Train Seats</h2>
          <div className={styles.bookingForm}>
            <label htmlFor="numSeats">How many seats would you like? (1-7)</label>
            <input
              type="number"
              id="numSeats"
              min="1"
              max="7"
              value={numSeats}
              onChange={(e) => {
                const value = parseInt(e.target.value) || 1;
                setNumSeats(Math.min(Math.max(value, 1), 7));
              }}
              disabled={isLoading}
            />
            <button 
              onClick={handleBookSeats} 
              className={styles.bookButton}
              disabled={isLoading}
            >
              {isLoading ? 'Booking...' : '🎫 Book Seats Now'}
            </button>
          </div>
        </section>
        
        <section className={styles.seatMapSection}>
          <h2>Seat Map</h2>
          <div className={styles.seatMap}>
            {Array.from({ length: 12 }, (_, rowIndex) => {
              const row = rowIndex + 1;
              const rowSeats = seats.filter(s => s.row_number === row);
              const seatsInRow = row === 12 ? 3 : 7;
              
              return (
                <div key={`row-${row}`} className={styles.seatRow}>
                  <div className={styles.rowLabel}>Row {row}</div>
                  {Array.from({ length: seatsInRow }, (_, posIndex) => {
                    const pos = posIndex + 1;
                    const seat = rowSeats.find(s => s.position_in_row === pos);
                    const isBooked = seat?.is_booked;
                    
                    return (
                      <div
                        key={`seat-${row}-${pos}`}
                        className={`${styles.seat} ${isBooked ? styles.booked : styles.available}`}
                        title={`${seat?.seat_number || `R${row}-S${pos}`}${isBooked ? ' (Booked)' : ' (Available)'}`}
                      >
                        {pos}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <div className={`${styles.legendColor} ${styles.available}`}></div>
              <span>Available</span>
            </div>
            <div className={styles.legendItem}>
              <div className={`${styles.legendColor} ${styles.booked}`}></div>
              <span>Booked</span>
            </div>
          </div>
        </section>
        
        <section className={styles.bookingsSection}>
          <h2>Your Bookings</h2>
          {bookings.length === 0 ? (
            <p>You have no active bookings</p>
          ) : (
            <ul className={styles.bookingList}>
              {bookings.map(booking => (
                <li key={booking.id} className={styles.bookingItem}>
                  <div>
                    <div>Reference: {booking.booking_reference}</div>
                    <div>
                      Seats: {
                        booking.seat_details?.length > 0 
                          ? booking.seat_details.map(seat => seat.seat_number).join(', ')
                          : `${booking.seat_ids?.length || 0} seats`
                      }
                    </div>
                    <div>Date: {new Date(booking.created_at).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => handleCancelBooking(booking.booking_reference)}
                    className={styles.cancelButton}
                    disabled={isLoading}
                  >
                    Cancel Booking
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {isAdmin && (
          <section className={styles.adminSection}>
            <h2>Admin Controls</h2>
            <button
              onClick={handleResetAll}
              className={styles.resetButton}
              disabled={isLoading}
            >
              Reset All Bookings
            </button>
          </section>
        )}
      </main>
    </div>
  );
}