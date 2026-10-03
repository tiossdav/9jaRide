import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { SosService } from './sos.service';

class LocationDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyM?: number;
}

class RaiseSosDto {
  @IsOptional() @ValidateNested() @Type(() => LocationDto) location?: LocationDto;
}

class AssignDto {
  @IsUUID() assigneeId!: string;
}

class NoteDto {
  @IsIn(['note', 'callback']) kind!: 'note' | 'callback';
  @IsObject() detail!: Record<string, unknown>;
}

class ResolveDto {
  @IsString() @MinLength(3) @MaxLength(500) outcome!: string;
}

/** The SOS button. Answers only after the alert is stored (spec: never show "sent" on tap). */
@Controller('sos')
@Roles('rider', 'driver')
export class SosController {
  constructor(private readonly sos: SosService) {}

  @Post() @HttpCode(200)
  raise(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: RaiseSosDto) {
    return this.sos.raise({ idempotencyKey: key, userId: me.id, role: me.role as 'rider' | 'driver', location: dto.location });
  }

  @Post(':id/location') @HttpCode(204)
  async location(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LocationDto) {
    await this.sos.appendLocation(id, me.id, dto);
  }
}

/** Safety Center for staff. */
@Controller('admin/sos')
@Roles('support', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminSosController {
  constructor(private readonly sos: SosService) {}

  @Get()
  list() {
    return this.sos.listActive();
  }

  @Get(':id/timeline')
  timeline(@Param('id', ParseUUIDPipe) id: string) {
    return this.sos.getTimeline(id);
  }

  @Post(':id/acknowledge') @HttpCode(200)
  async acknowledge(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return { acknowledged: await this.sos.acknowledge(id, me.id) };
  }

  @Post(':id/assign') @HttpCode(204)
  async assign(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    await this.sos.assign(id, me.id, dto.assigneeId);
  }

  @Post(':id/notes') @HttpCode(204)
  async note(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    await this.sos.addNote(id, me.id, dto.kind, dto.detail);
  }

  @Post(':id/resolve') @HttpCode(200)
  async resolve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto) {
    return { resolved: await this.sos.resolve(id, me.id, dto.outcome) };
  }
}
