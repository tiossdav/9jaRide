import { Module } from '@nestjs/common';
import { FleetModule } from '../fleet/fleet.module';
import { FilesModule } from '../files/files.module';
import { VehiclePlansModule } from '../vehicle-plans/vehicle-plans.module';
import { DriverProfileController } from './driver-profile.controller';
import { DriverProfileService } from './driver-profile.service';

@Module({ imports: [FilesModule, VehiclePlansModule, FleetModule], controllers: [DriverProfileController], providers: [DriverProfileService] })
export class DriverProfileModule {}
