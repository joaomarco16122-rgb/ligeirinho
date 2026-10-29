import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  // Capture selection while preserving real Argon2 computation.
  return { ...actual, verify: vi.fn(actual.verify) };
});
describe('login local não revela vínculo externo pela seleção do hash', () => {
  it('conta vinculada e conta inexistente fazem Argon real no mesmo dummy e recebem erro genérico', async () => {
    const user = {
      id: 'fixture-user',
      active: true,
      email: 'fixture@example.test',
      supabaseUserId: 'external-fixture',
      passwordHash: 'stale-hash-must-never-be-verified',
    };
    const db = {
      user: { findUnique: vi.fn().mockResolvedValueOnce(user).mockResolvedValueOnce(null) },
      session: { create: vi.fn() },
    };
    const service = new AuthService(db as any, {} as any);
    for (const email of [user.email, 'unknown@example.test']) {
      await expect(service.login(email, 'synthetic-password')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
    const verify = vi.mocked(argon2.verify);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]![0]).toEqual(verify.mock.calls[1]![0]);
    expect(verify.mock.calls[0]![0]).not.toBe(user.passwordHash);
    expect(verify.mock.calls[0]![0]).toMatch(/^\$argon2id\$/);
    expect(db.session.create).not.toHaveBeenCalled();
  });
});
