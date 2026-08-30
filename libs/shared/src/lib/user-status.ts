export const USER_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BANNED: 'BANNED',
} as const;

export type UserStatusValue = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const PLATFORM_ROLES = {
  ADMIN: 'ADMIN',
  USER: 'USER',
} as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[keyof typeof PLATFORM_ROLES];

export const ALL_PLATFORM_ROLES: readonly PlatformRole[] = Object.values(PLATFORM_ROLES);

export function isPlatformRole(value: string): value is PlatformRole {
  return (ALL_PLATFORM_ROLES as readonly string[]).includes(value);
}
