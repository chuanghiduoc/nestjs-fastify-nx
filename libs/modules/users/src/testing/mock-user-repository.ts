import type {
  FindAllCursorOptions,
  FindAllCursorResult,
  UserRepositoryPort,
} from '../domain/ports/user-repository.port';
import type { User } from '../domain/entities/user.entity';

export class MockUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();

  findById(id: string): Promise<User | null> {
    return Promise.resolve(this.store.get(id) ?? null);
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(
      [...this.store.values()].find((u) => u.email.toString() === email) ?? null,
    );
  }

  findAllCursor(options: FindAllCursorOptions): Promise<FindAllCursorResult> {
    const { startingAfter, limit, role, status, search } = options;
    let rows = [...this.store.values()];

    if (role) rows = rows.filter((u) => u.role === role);
    if (status) rows = rows.filter((u) => u.status === status);
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (u) =>
          u.email.toString().toLowerCase().includes(needle) ||
          u.name.toLowerCase().includes(needle),
      );
    }

    // Mimic DB ordering: createdAt DESC, id DESC
    rows.sort((a, b) => {
      const tDiff = b.createdAt.getTime() - a.createdAt.getTime();
      if (tDiff !== 0) return tDiff;
      return b.id < a.id ? -1 : 1;
    });

    if (startingAfter) {
      rows = rows.filter((u) => {
        const tDiff = u.createdAt.getTime() - startingAfter.createdAt.getTime();
        if (tDiff < 0) return true;
        if (tDiff === 0) return u.id < startingAfter.id;
        return false;
      });
    }

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return Promise.resolve({ items, hasMore });
  }

  save(user: User): Promise<void> {
    this.store.set(user.id, user);
    return Promise.resolve();
  }

  exists(email: string): Promise<boolean> {
    return Promise.resolve([...this.store.values()].some((u) => u.email.toString() === email));
  }

  clear(): void {
    this.store.clear();
  }
}
