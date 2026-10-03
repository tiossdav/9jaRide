import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { IdempotencyKey } from '../common/idempotency-key';
import { AdjustmentsService } from './adjustments.service';
import { DOCUMENT_KINDS, DocumentKind, DriverApplicationsService } from './driver-applications.service';
import { PaymentExceptionsService } from './payment-exceptions.service';

const reason = () => [IsString(), MinLength(3), MaxLength(500)];
function Reason() {
  return (target: object, key: string) => reason().forEach((d) => d(target, key));
}

// ---------------------------------------------------------------- driver side

class VehicleDto {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: string;
  @IsString() @MinLength(2) @MaxLength(50) make!: string;
  @IsString() @MinLength(2) @MaxLength(30) colour!: string;
  @IsString() @MinLength(5) @MaxLength(14) plate!: string;
}

class DocumentDto {
  @IsIn(DOCUMENT_KINDS) kind!: DocumentKind;
  @IsString() @MinLength(3) @MaxLength(300) fileRef!: string;
  @IsOptional() @IsDateString({ strict: true }) expiresOn?: string;
}

class ApplicationDto {
  @ValidateNested() @Type(() => VehicleDto) vehicle!: VehicleDto;
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => DocumentDto) documents!: DocumentDto[];
}

@Controller('driver/application')
@Roles('driver')
export class DriverApplicationController {
  constructor(private readonly applications: DriverApplicationsService) {}

  @Post() @HttpCode(200)
  submit(@CurrentUser() me: Principal, @Body() dto: ApplicationDto) {
    return this.applications.submit(me.id, dto);
  }

  @Get()
  mine(@CurrentUser() me: Principal) {
    return this.applications.mine(me.id);
  }
}

// ---------------------------------------------------------------- staff: driver review and accounts

class ApplicationQuery {
  @IsOptional() @IsIn(['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED']) status?: string;
}

class NoteDto {
  @Reason() note!: string;
}

class ReasonDto {
  @Reason() reason!: string;
}

@Controller('admin')
@Roles('support', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminDriversController {
  constructor(private readonly applications: DriverApplicationsService) {}

  @Get('driver-applications')
  queue(@Query() q: ApplicationQuery) {
    return this.applications.queue(q.status);
  }

  @Get('driver-applications/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.applications.get(id);
  }

  @Post('driver-applications/:id/approve') @HttpCode(204)
  async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.applications.approve(id, me.id);
  }

  @Post('driver-applications/:id/request-changes') @HttpCode(204)
  async changes(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    await this.applications.requestChanges(id, me.id, dto.note);
  }

  @Post('driver-applications/:id/reject') @HttpCode(204)
  async reject(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    await this.applications.reject(id, me.id, dto.reason);
  }

  @Post('users/:id/suspend') @HttpCode(200)
  async suspend(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return { changed: await this.applications.setAccountStatus(id, me.id, 'suspended', dto.reason) };
  }

  @Post('users/:id/reinstate') @HttpCode(200)
  async reinstate(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return { changed: await this.applications.setAccountStatus(id, me.id, 'active', dto.reason) };
  }
}

// ---------------------------------------------------------------- staff: adjustments and payment exceptions

class AdjustmentDto {
  @IsIn(['refund', 'credit', 'debit', 'topup_correction']) kind!: 'refund' | 'credit' | 'debit' | 'topup_correction';
  @IsUUID() userId!: string;
  @IsInt() @Min(1) @Max(1_000_000_000) amountKobo!: number;
  @Reason() reason!: string;
  @ValidateIf((o) => o.kind === 'refund') @IsUUID() rideId?: string;
  @ValidateIf((o) => o.kind === 'topup_correction') @IsString() @Matches(/^[A-Za-z0-9_.-]{6,100}$/) providerReference?: string;
}

class AdjustmentQuery {
  @IsOptional() @IsIn(['PENDING_APPROVAL', 'POSTED', 'REJECTED']) status?: string;
}

class ResolveDto {
  @IsIn(['intent', 'finding', 'payout']) sourceKind!: 'intent' | 'finding' | 'payout';
  @IsString() @MinLength(1) @MaxLength(300) sourceId!: string;
  @IsIn(['corrected', 'dismissed', 'contacted_user']) resolution!: 'corrected' | 'dismissed' | 'contacted_user';
  @Reason() note!: string;
  @IsOptional() @IsUUID() adjustmentId?: string;
}

/** Support can ask for a refund; finance and admin decide. Nobody decides their own request. */
@Controller('admin')
@UseInterceptors(StaffAuditInterceptor)
export class AdminMoneyController {
  constructor(private readonly adjustments: AdjustmentsService, private readonly exceptions: PaymentExceptionsService) {}

  @Roles('support', 'finance', 'admin') @Post('adjustments') @HttpCode(200)
  request(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: AdjustmentDto) {
    return this.adjustments.request({ ...dto, idempotencyKey: key, requestedBy: me.id });
  }

  @Roles('support', 'finance', 'admin') @Get('adjustments')
  list(@Query() q: AdjustmentQuery) {
    return this.adjustments.list(q.status);
  }

  @Roles('support', 'finance', 'admin') @Get('adjustments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.adjustments.get(id);
  }

  @Roles('finance', 'admin') @Post('adjustments/:id/approve') @HttpCode(200)
  async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return { approved: await this.adjustments.approve(id, me.id, me.role) };
  }

  @Roles('finance', 'admin') @Post('adjustments/:id/reject') @HttpCode(200)
  async reject(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return { rejected: await this.adjustments.reject(id, me.id, dto.reason) };
  }

  @Roles('finance', 'admin') @Get('payment-exceptions')
  openExceptions() {
    return this.exceptions.listOpen();
  }

  @Roles('finance', 'admin') @Post('payment-exceptions/resolve') @HttpCode(204)
  async resolve(@CurrentUser() me: Principal, @Body() dto: ResolveDto) {
    await this.exceptions.resolve(me.id, dto);
  }
}
