// public/js/app.js
class TrainReservationApp {
    constructor() {
      this.token = localStorage.getItem('token');
      this.user = JSON.parse(localStorage.getItem('user'));
      this.initEventListeners();
      
      if (this.token && this.user) {
        this.loadDashboard();
      } else {
        this.showLogin();
      }
    }
  
    initEventListeners() {
      // Login form
      document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleLogin();
      });
      
      // Signup form
      document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSignup();
      });
      
      // Logout button
      document.getElementById('logoutBtn')?.addEventListener('click', () => {
        this.handleLogout();
      });
      
      // Book seats form
      document.getElementById('bookForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleBookSeats();
      });
    }
  
    async handleLogin() {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          localStorage.setItem('token', data.token);
          localStorage.setItem('user', JSON.stringify(data.user));
          this.token = data.token;
          this.user = data.user;
          this.loadDashboard();
        } else {
          this.showError(data.error || 'Login failed');
        }
      } catch (err) {
        this.showError('Network error. Please try again.');
      }
    }
  
    async handleSignup() {
      const username = document.getElementById('username').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      
      if (password !== confirmPassword) {
        this.showError('Passwords do not match');
        return;
      }
      
      try {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Auto-login after signup
          await this.handleLogin();
        } else {
          this.showError(data.error || 'Signup failed');
        }
      } catch (err) {
        this.showError('Network error. Please try again.');
      }
    }
  
    handleLogout() {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      this.token = null;
      this.user = null;
      this.showLogin();
    }
  
    async loadDashboard() {
      try {
        // Load seats and bookings in parallel
        const [seatsResponse, bookingsResponse] = await Promise.all([
          fetch('/api/seats'),
          fetch('/api/bookings', {
            headers: { 'Authorization': `Bearer ${this.token}` }
          })
        ]);
        
        if (!seatsResponse.ok || !bookingsResponse.ok) {
          throw new Error('Failed to load data');
        }
        
        const seats = await seatsResponse.json();
        const bookings = await bookingsResponse.json();
        
        this.renderDashboard(seats, bookings);
      } catch (err) {
        this.showError('Failed to load dashboard data');
      }
    }
  
    renderDashboard(seats, bookings) {
      // Render seat map
      const seatMap = document.getElementById('seatMap');
      seatMap.innerHTML = '';
      
      for (let row = 1; row <= 12; row++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'seat-row';
        rowDiv.innerHTML = `<div class="row-label">Row ${row}</div>`;
        
        const seatsInRow = row === 12 ? 3 : 7;
        for (let pos = 1; pos <= seatsInRow; pos++) {
          const seat = seats.find(s => s.row_number === row && s.position_in_row === pos);
          const seatDiv = document.createElement('div');
          seatDiv.className = `seat ${seat?.is_booked ? 'booked' : 'available'}`;
          seatDiv.textContent = pos;
          rowDiv.appendChild(seatDiv);
        }
        
        seatMap.appendChild(rowDiv);
      }
      
      // Render bookings
      const bookingsList = document.getElementById('bookingsList');
      bookingsList.innerHTML = bookings.map(booking => `
        <div class="booking">
          <div>Ref: ${booking.booking_reference}</div>
          <div>Seats: ${booking.seat_ids.length}</div>
          <button class="cancel-btn" data-ref="${booking.booking_reference}">Cancel</button>
        </div>
      `).join('');
      
      // Show dashboard and hide other sections
      document.getElementById('loginSection').style.display = 'none';
      document.getElementById('signupSection').style.display = 'none';
      document.getElementById('dashboard').style.display = 'block';
    }
  
    showLogin() {
      document.getElementById('loginSection').style.display = 'block';
      document.getElementById('signupSection').style.display = 'none';
      document.getElementById('dashboard').style.display = 'none';
    }
  
    showError(message) {
      const errorDiv = document.getElementById('errorMessage');
      errorDiv.textContent = message;
      errorDiv.style.display = 'block';
      setTimeout(() => errorDiv.style.display = 'none', 5000);
    }
  }
  
  // Initialize app when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    new TrainReservationApp();
  });