import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { API, newUserSession, adminSession, authParams } from './lib/helpers.js';

const VUS = Number(__ENV.VUS || 50);
const RAMP = __ENV.RAMP || '30s';
const SUSTAIN = __ENV.SUSTAIN || '2m';

const publicLatency = new Trend('latency_public', true);
const authedLatency = new Trend('latency_authed', true);
const adminLatency = new Trend('latency_admin', true);

const ramping = (peak) => ({
  executor: 'ramping-vus',
  startVUs: 0,
  stages: [
    { duration: RAMP, target: peak },
    { duration: SUSTAIN, target: peak },
    { duration: RAMP, target: 0 },
  ],
});

export const options = {
  scenarios: {
    public_read: { ...ramping(VUS), exec: 'publicRead' },
    authed_read: { ...ramping(VUS), exec: 'authedRead' },
    admin_list: { ...ramping(Math.ceil(VUS / 2)), exec: 'adminList' },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:health:live}': ['p(95)<200'],
    'http_req_duration{name:users:me}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:admin:list}': ['p(95)<800', 'p(99)<1500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  return { user: newUserSession(), admin: adminSession() };
}

export function publicRead() {
  const res = http.get(`${API}/health/live`, { tags: { name: 'health:live' } });
  publicLatency.add(res.timings.duration);
  check(res, { 'live 200': (r) => r.status === 200 });
}

export function authedRead(data) {
  if (!data.user) return;
  const res = http.get(`${API}/users/me`, authParams(data.user, 'users:me'));
  authedLatency.add(res.timings.duration);
  check(res, { 'me 200': (r) => r.status === 200 });
}

export function adminList(data) {
  if (!data.admin) return;
  const res = http.get(`${API}/admin/users?limit=20`, authParams(data.admin, 'admin:list'));
  adminLatency.add(res.timings.duration);
  check(res, { 'admin list 200': (r) => r.status === 200 });
}
