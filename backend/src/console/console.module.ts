import { Module } from '@nestjs/common';
import { ConsoleController } from './console.controller';
import { ConsoleService } from './console.service';
import { PricingAdminService } from './pricing-admin.service';
import { VehiclesAdminService } from './vehicles-admin.service';

@Module({ controllers: [ConsoleController], providers: [ConsoleService, PricingAdminService, VehiclesAdminService] })
export class ConsoleModule {}
