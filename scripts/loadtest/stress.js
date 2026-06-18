import http from 'k6/http';
import { check } from 'k6';
import { API, newUserSession, authParams } from './lib/helpers.js';

const STEP = Number(__ENV.STEP || 50);
const STEPS = Number(__ENV.STEPS || 8);

// Climb in equal VU steps until latency/errors blow past the thresholds — the
// first step that breaches them marks the breaking point.
const stages = [];
for (let i = 1; i <= STEPS; i++) {
  stages.push({ duration: '20s', target: STEP * i });
  stages.push({ duration: '40s', target: STEP * i });
}
stages.push({ duration: '20s', target: 0 });

export const options = {
  scenarios: {
    stress: { executor: 'ramping-vus', startVUs: 0, stages, exec: 'hit' },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function setup() {
  return { user: newUserSession() };
}

export function hit(data) {
  if (!data.user) {
    const live = http.get(`${API}/health/live`, { tags: { name: 'health:live' } });
    check(live, { 'live ok': (r) => r.status === 200 });
    return;
  }
  const me = http.get(`${API}/users/me`, authParams(data.user, 'users:me'));
  check(me, { 'me ok': (r) => r.status === 200 });
}
