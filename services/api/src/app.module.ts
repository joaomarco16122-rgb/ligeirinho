import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { DispatchService } from './dispatch/dispatch.service';
import { CourierController } from './dispatch/courier.controller';
import { DeliveryController } from './deliveries/delivery.controller';
import { DeliveryService } from './deliveries/delivery.service';
import { HealthController } from './health.controller';
import { EventsGateway } from './realtime/events.gateway';
import { SettingsModule } from './settings/settings.module';
import { IntegrationsModule } from './integrations/integrations.module';
@Module({
  imports: [PrismaModule, AuthModule, AdminModule, SettingsModule, IntegrationsModule],
  controllers: [CourierController, DeliveryController, HealthController],
  providers: [DispatchService, DeliveryService, EventsGateway],
})
export class AppModule {}
