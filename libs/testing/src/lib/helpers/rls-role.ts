import { Client } from 'pg';

const RLS_ROLE = 'app_request_e2e';
const RLS_PASSWORD = 'app-request-e2e';

export async function provisionRlsRole(adminDatabaseUrl: string): Promise<string> {
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`DROP ROLE IF EXISTS ${RLS_ROLE}`);
    await admin.query(
      `CREATE ROLE ${RLS_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${RLS_PASSWORD}'`,
    );
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE}`,
    );
    await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE}`);
    await admin.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${RLS_ROLE}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminDatabaseUrl);
  url.username = RLS_ROLE;
  url.password = RLS_PASSWORD;
  return url.toString();
}
