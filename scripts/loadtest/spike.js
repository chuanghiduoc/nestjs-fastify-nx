import http from 'k6/http';
import { check } from 'k6';
import { API, newUserSession, authParams } from './lib/helpers.js';

const PEAK = Number(__ENV.PEAK || 300);

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '10s', target: PEAK },
        { duration: '30s', target: PEAK },
        { duration: '10s', target: 10 },
        { duration: '20s', target: 0 },
      ],
      exec: 'hit',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{name:users:me}': ['p(95)<1500'],
  },
};

export function setup() {
  return { user: newUserSession() };
}

export function hit(data) {
  if (data.user && Math.random() < 0.5) {
    const me = http.get(`${API}/users/me`, authParams(data.user, 'users:me'));
    check(me, { 'me ok': (r) => r.status === 200 });
    return;
  }
  const live = http.get(`${API}/health/live`, { tags: { name: 'health:live' } });
  check(live, { 'live ok': (r) => r.status === 200 });
}
