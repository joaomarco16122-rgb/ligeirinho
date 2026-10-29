import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { DispatchService } from './dispatch/dispatch.service';
@Controller('health')
export class HealthController {
  constructor(
    private db: PrismaService,
    private dispatch: DispatchService,
  ) {}
  @Get() async health() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      await this.dispatch.redis.ping();
      return {
        status: 'ok',
        database: 'ready',
        redis: 'ready',
        integrations: {
          maps:
            process.env.MAPS_PROVIDER === 'google'
              ? 'google-configured-unverified'
              : 'development-straight-line',
          push: 'disabled',
          payments: 'disabled',
        },
      };
    } catch {
      throw new ServiceUnavailableException('Banco ou fila indisponível.');
    }
  }
}
