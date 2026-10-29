import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { closeIntegrationTransport } from './transport';
@Injectable()
class IntegrationLifecycle implements OnModuleDestroy {
  async onModuleDestroy() {
    await closeIntegrationTransport();
  }
}
@Module({ providers: [IntegrationLifecycle] })
export class IntegrationsModule {}
