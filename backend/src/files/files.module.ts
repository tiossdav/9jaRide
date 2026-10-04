import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { DbFileStorage, FILE_STORAGE, FilesService, LocalFileStorage } from './files.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    // FILE_STORAGE=db keeps files in the database (for hosts without a disk); otherwise they go to UPLOAD_DIR.
    { provide: FILE_STORAGE, inject: [PG_POOL], useFactory: (pool: Pool) => (process.env.FILE_STORAGE === 'db' ? new DbFileStorage(pool) : new LocalFileStorage()) },
  ],
  exports: [FilesService],
})
export class FilesModule {}
