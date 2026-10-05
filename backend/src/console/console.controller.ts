import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import { CurrentUser, Principal } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { NotificationsService } from './notifications.service';
import { PricingAdminService } from './pricing-admin.service';
import { VehiclesAdminService } from './vehicles-admin.service';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Matches, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.types';
import { ConsoleService } from './console.service';

class TripsQuery {
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsIn(['completed', 'cancelled', 'active', 'scheduled']) status?: 'completed' | 'cancelled' | 'active' | 'scheduled';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

class PeopleQuery {
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsIn(['active', 'suspended']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

class LedgerQuery {
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @IsString() @MaxLength(40) kind?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

class SinceQuery { @IsOptional() @Type(() => Date) @IsDate() since?: Date; }

class DaysQuery { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days?: number; }

class ProposalDto {
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: string;
  @Type(() => Date) @IsDate() effectiveFrom!: Date;
  @IsInt() @Min(0) @Max(100_000_000) baseKobo!: number;
  @IsInt() @Min(0) @Max(10_000_000) perKmKobo!: number;
  @IsInt() @Min(0) @Max(10_000_000) perMinuteKobo!: number;
  @IsInt() @Min(0) @Max(10_000_000) waitingPerMinuteKobo!: number;
  @IsInt() @Min(0) @Max(7200) freeWaitingSeconds!: number;
  @IsInt() @Min(0) @Max(10_000_000) taxKobo!: number;
  @IsInt() @Min(1) @Max(100_000) roundingStepKobo!: number;
  @IsInt() @Min(1) @Max(10_000) estimateLowBps!: number;
  @IsInt() @Min(10_000) @Max(30_000) estimateHighBps!: number;
}

class ReasonDto { @IsString() @MinLength(3) @MaxLength(500) reason!: string; }

class NewVehicleDto {
  @IsUUID() driverId!: string;
  @Matches(/^[a-z][a-z0-9_]{1,29}$/) category!: string;
  @IsString() @MinLength(2) @MaxLength(50) make!: string;
  @IsString() @MinLength(2) @MaxLength(30) colour!: string;
  @IsString() @MinLength(5) @MaxLength(14) plate!: string;
}

class SafetyQuery {
  @IsOptional() @IsIn(['open', 'acknowledged', 'resolved']) status?: 'open' | 'acknowledged' | 'resolved';
}

/** Read-only screens for the admin portal. Support and admin staff only. */
@Controller('admin/console')
@Roles('support', 'admin')
export class ConsoleController {
  constructor(private readonly console: ConsoleService, private readonly pricingAdmin: PricingAdminService, private readonly vehiclesAdmin: VehiclesAdminService, private readonly notices: NotificationsService) {}

  /** What happened since the given moment, for the pop-ups. Every team sees its own kinds of event. */
  @Roles('support', 'finance', 'admin') @Get('notifications')
  notifications(@CurrentUser() me: Principal, @Query() q: SinceQuery) { return this.notices.feed(me.role, q.since ?? new Date(Date.now() - 3_600_000)); }

  @Get('dashboard') dashboard() { return this.console.dashboard(); }
  @Get('live') live() { return this.console.live(); }
  @Get('trips/overview') tripsOverview() { return this.console.tripsOverview(); }

  @Get('trips')
  trips(@Query() q: TripsQuery) {
    return this.console.trips({ search: q.search, status: q.status, page: q.page ?? 1, pageSize: q.pageSize ?? 20 });
  }

  @Get('trips/:id') trip(@Param('id', ParseUUIDPipe) id: string) { return this.console.trip(id); }
  @Get('drivers') drivers(@Query() q: PeopleQuery) { return this.console.drivers({ search: q.search, status: q.status, page: q.page ?? 1, pageSize: q.pageSize ?? 20 }); }
  @Get('people/:id') person(@Param('id', ParseUUIDPipe) id: string) { return this.console.person(id); }
  @Get('vehicles') vehicles(@Query() q: PeopleQuery) { return this.console.vehicles({ search: q.search, page: q.page ?? 1, pageSize: q.pageSize ?? 20 }); }
  @Roles('finance', 'admin') @Get('finance') finance() { return this.console.finance(); }
  @Roles('admin') @Get('activity') activity(@Query() q: PeopleQuery) { return this.console.activity({ search: q.search, page: q.page ?? 1, pageSize: q.pageSize ?? 25 }); }
  @Roles('finance', 'admin') @Get('revenue') revenue(@Query() q: DaysQuery) { return this.console.revenue(q.days ?? 30); }
  @Roles('finance', 'admin') @Get('ledger') ledger(@Query() q: LedgerQuery) { return this.console.ledger({ search: q.search, kind: q.kind, page: q.page ?? 1, pageSize: q.pageSize ?? 25 }); }
  @Roles('finance', 'admin') @Get('ledger/:id') ledgerEntries(@Param('id', ParseUUIDPipe) id: string) { return this.console.ledgerEntries(id); }
  @Get('ratings') ratings() { return this.console.ratings(); }
  @Get('trips.csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="trips.csv"')
  tripsCsv(@Query() q: TripsQuery) { return this.console.tripsCsv(q.status); }
  @Roles('admin') @Get('activity.csv') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="activity.csv"')
  activityCsv() { return this.console.activityCsv(); }

  // fee changes: propose, approve by a different admin, or discard
  @Roles('admin') @UseInterceptors(StaffAuditInterceptor) @Post('pricing') @HttpCode(200)
  propose(@CurrentUser() me: Principal, @Body() dto: ProposalDto) { return this.pricingAdmin.propose(me.id, dto); }
  @Roles('admin') @UseInterceptors(StaffAuditInterceptor) @Post('pricing/:id/approve') @HttpCode(204)
  async approvePricing(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) { await this.pricingAdmin.approve(me.id, id); }
  @Roles('admin') @UseInterceptors(StaffAuditInterceptor) @Delete('pricing/:id') @HttpCode(204)
  async discardPricing(@Param('id', ParseUUIDPipe) id: string) { await this.pricingAdmin.discard(id); }

  @Get('vehicles/:id') vehicle(@Param('id', ParseUUIDPipe) id: string) { return this.vehiclesAdmin.get(id); }
  @UseInterceptors(StaffAuditInterceptor) @Post('vehicles/:id/suspend') @HttpCode(204)
  async suspendVehicle(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { await this.vehiclesAdmin.suspend(me.id, id, dto.reason); }
  @UseInterceptors(StaffAuditInterceptor) @Post('vehicles/:id/reinstate') @HttpCode(204)
  async reinstateVehicle(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) { await this.vehiclesAdmin.reinstate(me.id, id, dto.reason); }
  @Roles('admin') @UseInterceptors(StaffAuditInterceptor) @Post('vehicles') @HttpCode(200)
  addVehicle(@CurrentUser() me: Principal, @Body() dto: NewVehicleDto) { return this.vehiclesAdmin.add(me.id, dto); }

  @Get('customers') customers() { return this.console.customers(); }
  @Get('safety') safety(@Query() q: SafetyQuery) { return this.console.safety(q.status); }
  @Get('sos/:id') sos(@Param('id', ParseUUIDPipe) id: string) { return this.console.sos(id); }
  @Get('pricing') pricing() { return this.console.pricing(); }
}
