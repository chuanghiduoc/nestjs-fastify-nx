export interface AuditLogListItemDto {
  id: string;
  organizationId: string | null;
  userId: string | null;
  action: string;
  resource: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}
