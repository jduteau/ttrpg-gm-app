// API base URL — set VITE_API_URL at build time for separate server deployments.
// In dev the Vite proxy handles /api/* so this is empty.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

export const apiUrl = (path) => `${API_BASE}${path}`;

// Helper to get auth headers
export const getAuthHeaders = () => {
  const token = localStorage.getItem('auth-token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};
