export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  sessionId: string;
  sessionToken: string;
}
