import http from 'k6/http';
import { check, group } from 'k6';
import { API, newUserSession, adminSession, authParams } from './lib/helpers.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'],
  },
};

export function setup() {
  return { user: newUserSession(), admin: adminSession() };
}

export default function (data) {
  group('public', () => {
    const live = http.get(`${API}/health/live`, { tags: { name: 'health:live' } });
    check(live, { 'live 200': (r) => r.status === 200 });

    const ready = http.get(`${API}/health/ready`, { tags: { name: 'health:ready' } });
    check(ready, { 'ready 200|503': (r) => r.status === 200 || r.status === 503 });
  });

  group('authenticated', () => {
    if (!data.user) return;
    const me = http.get(`${API}/users/me`, authParams(data.user, 'users:me'));
    check(me, { 'me 200': (r) => r.status === 200 });
  });

  group('admin', () => {
    if (!data.admin) return;
    const list = http.get(`${API}/admin/users?limit=20`, authParams(data.admin, 'admin:list'));
    check(list, { 'admin list 200': (r) => r.status === 200 });
  });
}
