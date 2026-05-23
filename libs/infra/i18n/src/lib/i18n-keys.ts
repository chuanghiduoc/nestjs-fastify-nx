// Single source of truth for translation keys. Every JSON namespace MUST mirror this map — see libs/infra/i18n/README.md for the workflow.
// Naming: <namespace>.<group>.<key>. Namespaces line up with JSON files: common, validation, errors, emails.
export const I18N_KEYS = {
  common: {
    internal_server_error: 'common.internal_server_error',
    not_found: 'common.not_found',
    bad_request: 'common.bad_request',
    unauthorized: 'common.unauthorized',
    forbidden: 'common.forbidden',
    conflict: 'common.conflict',
    too_many_requests: 'common.too_many_requests',
    payload_too_large: 'common.payload_too_large',
    unsupported_media_type: 'common.unsupported_media_type',
    unprocessable_entity: 'common.unprocessable_entity',
  },
  validation: {
    failed_title: 'validation.failed_title',
    failed_detail: 'validation.failed_detail',
    required: 'validation.required',
    wrong_type: 'validation.wrong_type',
    invalid_enum_value: 'validation.invalid_enum_value',
    invalid_email: 'validation.invalid_email',
    invalid_url: 'validation.invalid_url',
    invalid_uuid: 'validation.invalid_uuid',
    invalid_phone: 'validation.invalid_phone',
    invalid_credit_card: 'validation.invalid_credit_card',
    pattern_mismatch: 'validation.pattern_mismatch',
    out_of_range: 'validation.out_of_range',
    too_short: 'validation.too_short',
    too_long: 'validation.too_long',
    wrong_length: 'validation.wrong_length',
    forbidden_value: 'validation.forbidden_value',
    unknown_field: 'validation.unknown_field',
    invalid_value: 'validation.invalid_value',
  },
  errors: {
    audit_log: {
      invalid_id_empty: 'errors.audit_log.invalid_id_empty',
      invalid_id_uuid: 'errors.audit_log.invalid_id_uuid',
      title_invalid_id: 'errors.audit_log.title_invalid_id',
    },
    upload: {
      mime_not_allowed: 'errors.upload.mime_not_allowed',
      object_not_found: 'errors.upload.object_not_found',
      size_out_of_range: 'errors.upload.size_out_of_range',
      magic_bytes_mismatch: 'errors.upload.magic_bytes_mismatch',
      magic_bytes_unknown: 'errors.upload.magic_bytes_unknown',
      commit_failed: 'errors.upload.commit_failed',
    },
    users: {
      not_found: 'errors.users.not_found',
      already_exists: 'errors.users.already_exists',
      database_error: 'errors.users.database_error',
    },
    auth: {
      session_missing: 'errors.auth.session_missing',
      session_expired: 'errors.auth.session_expired',
      account_inactive: 'errors.auth.account_inactive',
      insufficient_permissions: 'errors.auth.insufficient_permissions',
    },
    storage: {
      body_empty: 'errors.storage.body_empty',
      upload_failed: 'errors.storage.upload_failed',
      presign_failed: 'errors.storage.presign_failed',
      head_failed: 'errors.storage.head_failed',
      signed_url_failed: 'errors.storage.signed_url_failed',
      delete_failed: 'errors.storage.delete_failed',
      commit_failed: 'errors.storage.commit_failed',
      read_range_failed: 'errors.storage.read_range_failed',
    },
  },
  emails: {
    password_reset: {
      subject: 'emails.password_reset.subject',
      greeting: 'emails.password_reset.greeting',
      greeting_named: 'emails.password_reset.greeting_named',
      lead: 'emails.password_reset.lead',
      ignore: 'emails.password_reset.ignore',
    },
    email_verification: {
      subject: 'emails.email_verification.subject',
      greeting: 'emails.email_verification.greeting',
      greeting_named: 'emails.email_verification.greeting_named',
      lead: 'emails.email_verification.lead',
      expiry: 'emails.email_verification.expiry',
    },
    account_deletion: {
      subject: 'emails.account_deletion.subject',
      greeting: 'emails.account_deletion.greeting',
      greeting_named: 'emails.account_deletion.greeting_named',
      warning: 'emails.account_deletion.warning',
      confirm: 'emails.account_deletion.confirm',
      not_you: 'emails.account_deletion.not_you',
    },
  },
} as const;

type LeafValues<T> = T extends string
  ? T
  : T[keyof T] extends string | object
    ? LeafValues<T[keyof T]>
    : never;
export type I18nKey = LeafValues<typeof I18N_KEYS>;
