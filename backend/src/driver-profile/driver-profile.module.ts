import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { VehiclePlansModule } from '../vehicle-plans/vehicle-plans.module';
import { DriverProfileController } from './driver-profile.controller';
import { DriverProfileService } from './driver-profile.service';

@Module({ imports: [FilesModule, VehiclePlansModule], controllers: [DriverProfileController], providers: [DriverProfileService] })
export class DriverProfileModule {}
