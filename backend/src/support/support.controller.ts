import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { SupportService, TOPICS, Topic } from './support.service';

class RaiseDto {
  @IsIn(TOPICS as unknown as string[]) topic!: Topic;
  @IsString() @MinLength(5) @MaxLength(2000) message!: string;
  @IsOptional() @IsUUID() rideId?: string;
}
class NoteDto { @IsString() @MinLength(1) @MaxLength(2000) body!: string; }
class StatusDto {
  @IsIn(['RESOLVED', 'OPEN']) status!: 'RESOLVED' | 'OPEN';
  @IsOptional() @IsString() @MaxLength(1000) resolution?: string;
}
class QueueQuery {
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string;
}

/** "Report a problem" in the rider and driver apps. */
@Controller('support/tickets')
@Roles('rider', 'driver')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post() @HttpCode(200)
  raise(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: RaiseDto) {
    return this.support.raise(me.id, me.role as 'rider' | 'driver', key, dto);
  }

  @Get() mine(@CurrentUser() me: Principal) { return this.support.mine(me.id); }
}

@Controller('admin/support')
@Roles('support', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class SupportAdminController {
  constructor(private readonly support: SupportService) {}

  @Get() queue(@Query() q: QueueQuery) { return this.support.queue(q); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.support.get(id); }
  @Post(':id/take') @HttpCode(204) async take(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) { await this.support.take(me.id, id); }
  @Post(':id/notes') @HttpCode(204) async note(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) { await this.support.addNote(me.id, id, dto.body); }
  @Post(':id/status') @HttpCode(204) async status(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { await this.support.setStatus(me.id, id, dto.status, dto.resolution); }
}
