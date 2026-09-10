BEGIN;

-- Serialize the counter backfill with concurrent membership writes.
LOCK TABLE teams, team_members IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE teams ADD COLUMN "memberCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN "membershipKey" TEXT;
CREATE UNIQUE INDEX "team_members_membershipKey_key" ON team_members("membershipKey");

-- Better Auth supports legacy memberships with a null membershipKey.
UPDATE teams AS t
SET "memberCount" = (
  SELECT COUNT(*)::integer FROM team_members AS tm WHERE tm."teamId" = t.id
);

COMMIT;
