import { Module } from '@nestjs/common';
import { FILE_STORAGE, FilesService, LocalFileStorage } from './files.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [FilesController],
  providers: [FilesService, { provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FilesService],
})
export class FilesModule {}
