import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AppConfigModule } from './app-config/app-config.module';
import { AuthModule } from './auth/auth.module';
import { TeamModule } from './team/team.module';
import { PromoModule } from './promo/promo.module';
import { SupportModule } from './support/support.module';
import { StakeholdersModule } from './stakeholders/stakeholders.module';
import { CatalogModule } from './catalog/catalog.module';
import { SettingsModule } from './settings/settings.module';
import { DriverProfileModule } from './driver-profile/driver-profile.module';
import { FleetModule } from './fleet/fleet.module';
import { FilesModule } from './files/files.module';
import { ConsoleModule } from './console/console.module';
import { VehiclePlansModule } from './vehicle-plans/vehicle-plans.module';
import { HealthController } from './common/health.controller';
import { InfraModule } from './common/infra.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { FareModule } from './fare/fare.module';
import { LedgerModule } from './ledger/ledger.module';
import { PaymentsModule } from './payments/payments.module';
import { RidesModule } from './rides/rides.module';
import { SafetyModule } from './safety/safety.module';
import { HomeContentModule } from './home-content/home-content.module';
import { PushModule } from './push/push.module';
import { MapsModule } from './maps/maps.controller';

@Module({
  controllers: [HealthController],
  imports: [ScheduleModule.forRoot(), InfraModule, SettingsModule, CatalogModule, AuthModule, LedgerModule, FareModule, PaymentsModule, DispatchModule, RidesModule, SafetyModule, AdminModule, ConsoleModule, FilesModule, FleetModule, DriverProfileModule, VehiclePlansModule, TeamModule, StakeholdersModule, PromoModule, SupportModule, AppConfigModule, HomeContentModule, PushModule, MapsModule],
})
export class AppModule {}
