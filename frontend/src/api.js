/**
 * api.js — the axios instance every screen uses.
 *
 * Two behaviours worth knowing about:
 *   · the JWT is attached from localStorage on every request
 *   · a 401 clears the session and bounces to login, so an expired token shows
 *     the login page rather than a wall of failed requests
 */
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 30000,
});

export const TOKEN_KEY = 'pea_token';
export const USER_KEY = 'pea_user';

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    // Surface the server's message rather than axios's generic one.
    err.friendlyMessage =
      err.response?.data?.message || err.message || 'Something went wrong';
    return Promise.reject(err);
  }
);

export default api;

/** Unwrap the standard { status, message, data } envelope. */
export const unwrap = (res) => res.data?.data ?? res.data;
