export interface AuthenticatedSession {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  sessionId: string;
  organizationId?: string;
  teamId?: string;
}
