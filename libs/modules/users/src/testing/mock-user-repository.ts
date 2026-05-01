import type {
  FindAllOptions,
  FindAllResult,
  UserRepositoryPort,
} from '../domain/ports/user-repository.port';
import type { User } from '../domain/entities/user.entity';

export class MockUserRepository implements UserRepositoryPort {
  private store = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.store.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return [...this.store.values()].find((u) => u.email.toString() === email) ?? null;
  }

  async findAll(options: FindAllOptions): Promise<FindAllResult> {
    const { page, pageSize, role, status, search } = options;
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
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const total = rows.length;
    const items = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { items, total };
  }

  async save(user: User): Promise<void> {
    this.store.set(user.id, user);
  }

  async exists(email: string): Promise<boolean> {
    return [...this.store.values()].some((u) => u.email.toString() === email);
  }

  clear(): void {
    this.store.clear();
  }
}
