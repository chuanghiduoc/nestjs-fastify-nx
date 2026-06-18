import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1`;
export const AUTH = `${BASE_URL}/api/auth`;

const SESSION_COOKIE = 'better-auth.session_token';

// Spread sign-up across unique emails so the IP+email auth rate-limit bucket
// (5 / 15 min) never trips during setup, even without the load-test env profile.
export function uniqueEmail(prefix = 'load') {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@loadtest.invalid`;
}

function sessionCookie(res) {
  const jar = res.cookies[SESSION_COOKIE];
  return jar && jar.length ? `${SESSION_COOKIE}=${jar[0].value}` : null;
}

export function signUp(email, password = 'password123', name = 'Load Test') {
  const res = http.post(`${AUTH}/sign-up/email`, JSON.stringify({ email, password, name }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'auth:sign-up' },
  });
  check(res, { 'sign-up 200': (r) => r.status === 200 });
  return sessionCookie(res);
}

export function signIn(email, password) {
  const res = http.post(`${AUTH}/sign-in/email`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'auth:sign-in' },
  });
  check(res, { 'sign-in 200': (r) => r.status === 200 });
  return sessionCookie(res);
}

// Cookie for a fresh USER-role session; null only if the API is unreachable.
export function newUserSession() {
  return signUp(uniqueEmail());
}

// Cookie for the seeded ADMIN; null when SEED_ADMIN_* are not provided, so the
// caller can skip admin-only scenarios instead of flooding the logs with 403s.
export function adminSession() {
  const email = __ENV.SEED_ADMIN_EMAIL;
  const password = __ENV.SEED_ADMIN_PASSWORD;
  if (!email || !password) return null;
  return signIn(email, password);
}

export function authParams(cookie, name) {
  return { headers: { Cookie: cookie }, tags: { name } };
}
