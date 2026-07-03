// Version of the outbox event envelope ({ schemaVersion, eventId, occurredAt, payload }).
// Bump when the envelope shape changes. Producers stamp it (OutboxPublisher + the Postgres
// triggers in the init migration); the relay refuses to dispatch rows carrying an unknown
// version so a producer/consumer deploy skew fails loud instead of silently mis-deserialising.
// Rows written before versioning existed carry no field and are treated as version 1.
export const OUTBOX_SCHEMA_VERSION = 1;
