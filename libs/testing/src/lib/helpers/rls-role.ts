import { Client } from 'pg';

const RLS_ROLE = 'app_request_e2e';
const RLS_PASSWORD = 'app-request-e2e';

const ENSURE_ROLE_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
    ALTER ROLE ${RLS_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${RLS_PASSWORD}';
  ELSE
    CREATE ROLE ${RLS_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${RLS_PASSWORD}';
  END IF;
END
$$;
`;

export async function provisionRlsRole(adminDatabaseUrl: string): Promise<string> {
  const admin = new Client({ connectionString: adminDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(ENSURE_ROLE_SQL);
    await admin.query(`
      GRANT USAGE ON SCHEMA public TO ${RLS_ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
        ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE};
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${RLS_ROLE};
    `);
  } finally {
    await admin.end();
  }

  const url = new URL(adminDatabaseUrl);
  url.username = RLS_ROLE;
  url.password = RLS_PASSWORD;
  return url.toString();
}
