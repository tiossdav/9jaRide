import { Module } from '@nestjs/common';
import { HomeContentAdminController, HomeContentController } from './home-content.controller';
import { HomeContentService } from './home-content.service';

@Module({ controllers: [HomeContentController, HomeContentAdminController], providers: [HomeContentService] })
export class HomeContentModule {}
