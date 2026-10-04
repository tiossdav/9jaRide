import { Module } from '@nestjs/common';
import { DriverVehiclePlanController, VehiclePlansAdminController } from './vehicle-plans.controller';
import { VehiclePlansService } from './vehicle-plans.service';

@Module({ controllers: [VehiclePlansAdminController, DriverVehiclePlanController], providers: [VehiclePlansService], exports: [VehiclePlansService] })
export class VehiclePlansModule {}
