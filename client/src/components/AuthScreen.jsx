import React, { useState } from 'react';
import './AuthScreen.css';

export default function AuthScreen({ onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (response.ok) {
        const { token } = await response.json();
        localStorage.setItem('auth-token', token);
        onAuthenticated();
      } else {
        setError('Invalid password');
      }
    } catch (error) {
      setError('Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-container">
        <div className="auth-header">
          <span className="auth-icon">🎲</span>
          <h1>TTRPG Game Master</h1>
          <p>Enter password to access the application</p>
        </div>
        
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              disabled={isLoading}
              autoFocus
            />
          </div>
          
          {error && <div className="auth-error">{error}</div>}
          
          <button
            type="submit"
            className="auth-submit"
            disabled={!password.trim() || isLoading}
          >
            {isLoading ? 'Verifying...' : 'Access Application'}
          </button>
        </form>
      </div>
    </div>
  );
}