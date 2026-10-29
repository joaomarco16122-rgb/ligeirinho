import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BearerGuard } from './bearer.guard';
import { RolesGuard } from './roles.guard';
import { SupabaseIdentityClient } from './supabase.client';
import { SupabaseAuthController } from './supabase.controller';
import { SupabaseAuthService } from './supabase.service';
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32)
          throw new Error(
            'JWT_SECRET deve conter pelo menos 32 caracteres aleatórios. Configure fora do repositório.',
          );
        return { secret, signOptions: { algorithm: 'HS256' } };
      },
    }),
  ],
  controllers: [AuthController, SupabaseAuthController],
  providers: [
    AuthService,
    BearerGuard,
    RolesGuard,
    SupabaseAuthService,
    { provide: SupabaseIdentityClient, useFactory: () => new SupabaseIdentityClient() },
  ],
  exports: [AuthService, BearerGuard, RolesGuard],
})
export class AuthModule {}
