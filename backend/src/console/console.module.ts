import { Module } from '@nestjs/common';
import { VehiclePlansModule } from '../vehicle-plans/vehicle-plans.module';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { PricingAdminService } from './pricing-admin.service';
import { VehiclesAdminService } from './vehicles-admin.service';

@Module({ imports: [VehiclePlansModule], controllers: [ConsoleController], providers: [ConsoleService, PricingAdminService, VehiclesAdminService] })
export class ConsoleModule {}
