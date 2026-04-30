import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GetUserProfileHandler } from './get-user-profile.handler';
import { GetUserProfileQuery } from './get-user-profile.query';
import { MockUserRepository } from '../../../testing/mock-user-repository';
import { UserFactory } from '../../../testing/user.factory';
import { UserRole } from '../../../domain/entities/user.entity';

describe('GetUserProfileHandler', () => {
  let handler: GetUserProfileHandler;
  let userRepo: MockUserRepository;

  beforeEach(() => {
    userRepo = new MockUserRepository();
    handler = new GetUserProfileHandler(userRepo);
  });

  it('returns a UserProfileDto for an existing user', async () => {
    const user = UserFactory.create({ email: 'profile@example.com' });
    await userRepo.save(user);

    const result = await handler.execute(new GetUserProfileQuery(user.id));

    expect(result.id).toBe(user.id);
    expect(result.email).toBe(user.email.toString());
    expect(result.role).toBe(user.role);
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    await expect(handler.execute(new GetUserProfileQuery('non-existent-id'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns a DTO with the correct shape (id, email, role, createdAt)', async () => {
    const user = UserFactory.create({ email: 'shape@example.com', role: UserRole.ADMIN });
    await userRepo.save(user);

    const result = await handler.execute(new GetUserProfileQuery(user.id));

    expect(result).toMatchObject({
      id: expect.any(String),
      email: expect.any(String),
      role: expect.any(String),
      createdAt: expect.any(Date),
    });
  });

  it('correctly maps ADMIN role to the DTO', async () => {
    const admin = UserFactory.createAdmin({ email: 'admin@example.com' });
    await userRepo.save(admin);

    const result = await handler.execute(new GetUserProfileQuery(admin.id));

    expect(result.role).toBe(UserRole.ADMIN);
  });

  it('does not expose the password hash in the DTO', async () => {
    const user = UserFactory.create({ email: 'nohash@example.com' });
    await userRepo.save(user);

    const result = await handler.execute(new GetUserProfileQuery(user.id));

    expect(result).not.toHaveProperty('passwordHash');
    expect(Object.keys(result).sort()).toEqual(['createdAt', 'email', 'id', 'role']);
  });
});
