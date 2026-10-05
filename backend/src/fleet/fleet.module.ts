import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { DriverVehicleTermsController, FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';

@Module({ imports: [FilesModule], controllers: [FleetController, DriverVehicleTermsController], providers: [FleetService], exports: [FleetService] })
export class FleetModule {}
