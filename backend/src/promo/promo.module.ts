import { Global, Module } from '@nestjs/common';
import { PromoAdminController } from './promo.controller';
import { PromoService } from './promo.service';

@Global()
@Module({ controllers: [PromoAdminController], providers: [PromoService], exports: [PromoService] })
export class PromoModule {}
