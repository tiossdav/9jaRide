import { Global, Module } from '@nestjs/common';
import { AssetTypesController } from './asset-types.controller';
import { AssetTypesService } from './asset-types.service';

@Global()
@Module({ controllers: [AssetTypesController], providers: [AssetTypesService], exports: [AssetTypesService] })
export class CatalogModule {}
