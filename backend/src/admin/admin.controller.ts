import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsDefined, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
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
  @IsOptional() @IsString() @MaxLength(50) make?: string;
  @IsOptional() @IsString() @MaxLength(30) colour?: string;
  @IsOptional() @IsString() @MaxLength(14) plate?: string;
}

class OwnerDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MaxLength(20) phone!: string;
}

/** The car staff give a driver on a payment plan. All of it is required, unlike the driver's own declaration. */
class AssignedVehicleDto {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: string;
  @IsString() @MinLength(2) @MaxLength(50) make!: string;
  @IsString() @MinLength(2) @MaxLength(30) colour!: string;
  @IsString() @MinLength(5) @MaxLength(14) plate!: string;
}

class PlanDto {
  @IsInt() @Min(1) @Max(10_000_000_000) totalKobo!: number;
  @IsInt() @Min(0) @Max(10_000_000_000) depositKobo!: number;
  @IsInt() @Min(1) @Max(10_000_000_000) instalmentKobo!: number;
  @IsIn(['daily', 'weekly', 'monthly']) frequency!: 'daily' | 'weekly' | 'monthly';
  @IsDateString({ strict: true }) startsOn!: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

class AssignmentDto {
  @ValidateNested() @Type(() => AssignedVehicleDto) vehicle!: AssignedVehicleDto;
  @ValidateNested() @Type(() => PlanDto) plan!: PlanDto;
}

/** Giving a business vehicle to the driver at approval. Optional: a business can also give one later from its own list. */
class FleetAssignDto {
  @IsUUID() fleetVehicleId!: string;
  @IsInt() @Min(0) @Max(9000) deductionBps!: number;
  @IsOptional() @IsInt() @Min(1) targetKobo?: number;
}

class ApproveDto {
  @IsOptional() @ValidateNested() @Type(() => FleetAssignDto) fleet?: FleetAssignDto;
  @IsOptional() @ValidateNested() @Type(() => AssignmentDto) assignment?: AssignmentDto;
  /** The category the reviewer confirmed after inspecting the vehicle. Defaults to the one the driver asked for. */
  @IsOptional() @Matches(/^[a-z][a-z0-9_]{1,29}$/) category?: string;
}

const RETIRED_DOCUMENTS = ['inspection_certificate', 'owner_consent', 'insurance'];

class DocumentDto {
  @IsIn(DOCUMENT_KINDS) kind!: DocumentKind;
  @IsOptional() @IsString() @MaxLength(60) number?: string;
  @IsUUID() fileId!: string;
  @IsOptional() @IsDateString({ strict: true }) expiresOn?: string;
}

class NextOfKinDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsString() @MaxLength(40) relationship?: string;
  @IsString() @MinLength(5) @MaxLength(300) address!: string;
}

class PersonalDto {
  @IsString() @MaxLength(120) email!: string;
  @IsIn(['whatsapp', 'email']) contactPreference!: 'whatsapp' | 'email';
  @IsOptional() @IsDateString({ strict: true }) dateOfBirth?: string;
  @IsString() @MaxLength(11) nin!: string;
  @IsString() @MaxLength(30) lassdri!: string;
  @IsString() @MinLength(5) @MaxLength(300) address!: string;
  @IsDefined() @ValidateNested() @Type(() => NextOfKinDto) nextOfKin!: NextOfKinDto;
}

class ApplicationDto {
  @IsOptional() @IsString() @MaxLength(30) arrangement?: string;
  @IsOptional() @IsInt() @Min(100) @Max(9000) deductionBps?: number;
  @IsDefined() @ValidateNested() @Type(() => VehicleDto) vehicle!: VehicleDto;
  @IsOptional() @ValidateNested() @Type(() => OwnerDto) owner?: OwnerDto;
  @IsDefined() @ValidateNested() @Type(() => PersonalDto) personal!: PersonalDto;
  // Older copies of the apps still send documents that are no longer asked for (the inspection certificate, owner consent and insurance). They are left out instead of failing the whole application.
  @Transform(({ value }) => (Array.isArray(value) ? value.filter((d) => !RETIRED_DOCUMENTS.includes(d?.kind)) : value))
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => DocumentDto) documents!: DocumentDto[];
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

  /** The ways to get a vehicle, shown on the sign-up screen. */
  @Get('arrangements')
  async arrangements() {
    return { items: await this.applications.arrangements() };
  }
}

// ---------------------------------------------------------------- staff: driver review and accounts

class ApplicationQuery {
  @IsOptional() @IsIn(['SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED']) status?: string;
}

class ChangesDto {
  @Reason() note!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) items?: string[];
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
  async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveDto) {
    // giving a driver a car on a payment plan commits company money, so it is an admin decision
    if ((dto.assignment || dto.fleet) && me.role !== 'admin') throw new ForbiddenException('only an admin can assign a vehicle at approval');
    await this.applications.approve(id, me.id, { assignment: dto.assignment, category: dto.category, fleet: dto.fleet });
  }

  /** Admin only: accept the NIN of an application by hand when the check could not settle it. */
  @Roles('admin') @Post('driver-applications/:id/accept-nin') @HttpCode(204)
  async acceptNin(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NoteDto) {
    await this.applications.acceptNinByHand(id, me.id, dto.note);
  }

  @Post('driver-applications/:id/request-changes') @HttpCode(204)
  async changes(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangesDto) {
    await this.applications.requestChanges(id, me.id, dto.note, dto.items ?? []);
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
