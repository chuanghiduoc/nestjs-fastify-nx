export const TABLE_OWNERS = {
  User: 'modules/users',
  Session: 'modules/sessions',
  Account: 'infra/auth',
  Verification: 'infra/auth',
  Organization: 'modules/organizations',
  Member: 'modules/organizations',
  Invitation: 'modules/organizations',
  Team: 'modules/organizations',
  TeamMember: 'modules/organizations',
  OrganizationRole: 'modules/organizations',
  StoredFile: 'modules/upload',
  OutboxEvent: 'infra/messaging',
  AuditLog: 'modules/audit-log',
  ApiKey: 'modules/api-keys',
  Notification: 'modules/notifications',
  FeatureFlag: 'modules/feature-flags',
  Term: 'modules/terms',
  TermAcceptance: 'modules/terms',
};

export const TABLE_GRANTS = [
  {
    accessor: 'modules/organizations',
    model: 'User',
    access: 'read',
    reason:
      'EnsurePersonalOrganization reads the name and email of the user to name the workspace.',
  },
  {
    accessor: 'modules/users',
    model: 'Member',
    access: 'read',
    reason:
      'ListUsersCursor scopes the member list to one organization and reads the membership role.',
  },
  {
    accessor: 'apps/api',
    model: 'OutboxEvent',
    access: 'read',
    reason: 'OutboxLagCollector reads the oldest pending row for the outbox_lag_seconds gauge.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'User',
    access: 'write',
    reason:
      'CleanupTask purges inactive users; StoredFileCleanupTask anti-joins users to find orphans.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'StoredFile',
    access: 'write',
    reason: 'StoredFileCleanupTask and UploadVerificationRecoveryTask scan and purge stored files.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'Organization',
    access: 'read',
    reason: 'StoredFileCleanupTask anti-joins organizations to find files of deleted tenants.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'OutboxEvent',
    access: 'write',
    reason: 'OutboxCleanupTask purges processed rows and parked rows.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'Session',
    access: 'write',
    reason: 'SessionCleanupTask purges expired sessions through BatchedPurgeRunner.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'Verification',
    access: 'write',
    reason: 'VerificationCleanupTask purges expired tokens through BatchedPurgeRunner.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'Invitation',
    access: 'write',
    reason: 'InvitationCleanupTask purges expired invitations through BatchedPurgeRunner.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'Notification',
    access: 'write',
    reason: 'NotificationCleanupTask purges old notifications through BatchedPurgeRunner.',
  },
  {
    accessor: 'apps/scheduler',
    model: 'AuditLog',
    access: 'write',
    reason: 'CleanupTask creates and drops audit_logs partitions through SQL functions.',
  },
];
