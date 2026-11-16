import { paginateNewestFirst } from '@nestjs-fastify-nx/shared';
import type {
  FindAllCursorOptions,
  FindAllCursorResult,
  UserRepositoryPort,
} from '../domain/ports/user-repository.port';
import type { User } from '../domain/entities/user.entity';

type UserWithRole = User & { readonly organizationRole: string };

export class MockUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();
  private memberships = new Map<string, Map<string, string>>();

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(
      [...this.store.values()].find((u) => u.email.toString() === email) ?? null,
    );
  }

  addMembership(userId: string, organizationId: string, role: string): void {
    const forUser = this.memberships.get(userId) ?? new Map<string, string>();
    forUser.set(organizationId, role);
    this.memberships.set(userId, forUser);
  }

  findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult> {
    const { organizationId, startingAfter, limit, role, status, search } = options;

    const members: UserWithRole[] = [];
    for (const user of this.store.values()) {
      const organizationRole = this.memberships.get(user.id)?.get(organizationId);
      if (organizationRole) members.push(Object.assign(user, { organizationRole }));
    }

    let rows = members;
    if (role) rows = rows.filter((u) => u.organizationRole === role);
    if (status) rows = rows.filter((u) => u.status === status);
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.email.toString().toLowerCase().includes(needle) ||
          u.name.toLowerCase().includes(needle),
      );
    }

    return Promise.resolve(paginateNewestFirst(rows, { startingAfter, limit }));
  }

  save(user: User): Promise<void> {
    this.store.set(user.id, user);
    return Promise.resolve();
  }

  clear(): void {
    this.store.clear();
    this.memberships.clear();
  }
}
