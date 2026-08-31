export interface SessionDto {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface RevokedSessionsDto {
  revoked: number;
}
