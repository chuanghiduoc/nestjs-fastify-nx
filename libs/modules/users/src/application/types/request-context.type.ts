/**
 * Lightweight, transport-agnostic context passed from the controller layer
 * down into application command handlers. Domain events that are interested
 * in HTTP-level metadata (audit trail, rate-limit attribution, etc.) read
 * these fields off the published payload.
 */
export interface RequestContext {
  readonly ip?: string;
  readonly userAgent?: string;
}
