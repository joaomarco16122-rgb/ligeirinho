import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env'), quiet: true });
config({ quiet: true });
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorsFilter } from './common/errors.filter';
import { configureProxyTrust, trafficKey, trafficLimit } from './common/traffic';
import { AppModule } from './app.module';
import { DispatchService } from './dispatch/dispatch.service';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ErrorsFilter());
  configureProxyTrust(app, process.env.TRUST_LOCAL_PROXY, process.env.TRUST_PROXY_ADDRESS);
  app.use(helmet());
  app.useBodyParser('json', { limit: '64kb' });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'PATCH', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  const redis = app.get(DispatchService).redis;
  app.use(async (req: any, res: any, next: () => void) => {
    const key = trafficKey(req);
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, 65);
      if (count > trafficLimit(req))
        return res.status(429).json({ message: 'Muitas requisições; aguarde um minuto.' });
      next();
    } catch {
      return res.status(503).json({ message: 'Proteção de tráfego indisponível.' });
    }
  });
  const config = new DocumentBuilder()
    .setTitle('Ligeirinho API')
    .setDescription('API de operação — integrações externas desativadas no desenvolvimento.')
    .setVersion('1')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT) || 3001, '0.0.0.0');
}
bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'api_start_failed',
      message: error instanceof Error ? error.message : 'unknown',
    }),
  );
  process.exitCode = 1;
});
