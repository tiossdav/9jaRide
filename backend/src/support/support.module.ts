import { Module } from '@nestjs/common';
import { SupportAdminController, SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({ controllers: [SupportController, SupportAdminController], providers: [SupportService] })
export class SupportModule {}
