import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { FilesService, MAX_UPLOAD_BYTES } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Send one photo or PDF as the form field "file". The answer is the id to attach it to an application. */
  @Roles('driver') @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentUser() me: Principal, @UploadedFile() file?: { buffer: Buffer }) {
    return this.files.save(me.id, file?.buffer);
  }

  @Get(':id') @Header('X-Content-Type-Options', 'nosniff') @Header('Cache-Control', 'private, max-age=600')
  async download(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.files.read(id, me);
    res.type(f.mimeType).send(f.bytes);
  }
}
