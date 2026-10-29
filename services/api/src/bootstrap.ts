import 'dotenv/config';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
async function bootstrap() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !password ||
    password.length < 12 ||
    password.length > 128
  )
    throw new Error(
      'Configure BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (12–128 caracteres) de forma segura antes do bootstrap.',
    );
  const db = new PrismaClient();
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(734538129)`;
      const existing = await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      if (existing) {
        console.log('Super Admin já existe. Nenhuma credencial foi alterada.');
        return;
      }
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const user = await tx.user.create({
        data: {
          name: 'Super Admin',
          email,
          passwordHash,
          role: 'SUPER_ADMIN',
          mustChangePassword: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: 'SUPER_ADMIN_BOOTSTRAPPED',
          entityType: 'User',
          entityId: user.id,
        },
      });
      console.log('Super Admin criado. Troca de senha obrigatória no primeiro acesso.');
    });
  } finally {
    await db.$disconnect();
  }
}
bootstrap().catch(() => {
  console.error(
    'Bootstrap falhou. Verifique os requisitos, o banco e a disponibilidade de um e-mail exclusivo; nenhum segredo foi registrado.',
  );
  process.exitCode = 1;
});
