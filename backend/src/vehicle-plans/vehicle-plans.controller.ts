import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { PAYMENT_METHODS, VehiclePlansService } from './vehicle-plans.service';

class ListQuery {
  @IsOptional() @IsIn(['all', 'active', 'defaulted', 'completed', 'cancelled']) status?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

class PaymentDto {
  @IsIn(['deposit', 'instalment', 'reversal']) kind!: 'deposit' | 'instalment' | 'reversal';
  @IsInt() @Min(1) @Max(10_000_000_000) amountKobo!: number;
  @IsIn(PAYMENT_METHODS) method!: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsDateString({ strict: true }) paidOn?: string;
}

class StatusDto {
  @IsIn(['active', 'defaulted', 'cancelled']) status!: 'active' | 'defaulted' | 'cancelled';
  @IsString() @MinLength(3) @MaxLength(500) note!: string;
}

/** Staff side of vehicle payment plans. Everyone on the team can look; finance records money; only an admin changes a plan's standing. */
@Controller('admin')
@UseInterceptors(StaffAuditInterceptor)
export class VehiclePlansAdminController {
  constructor(private readonly plans: VehiclePlansService) {}

  @Roles('support', 'finance', 'admin') @Get('console/vehicle-plans')
  list(@Query() q: ListQuery) { return this.plans.list(q); }

  @Roles('support', 'finance', 'admin') @Get('console/vehicle-plans/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.plans.get(id); }

  @Roles('finance', 'admin') @Post('vehicle-plans/:id/payments') @HttpCode(200)
  pay(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDto) { return this.plans.recordPayment(id, me.id, dto); }

  @Roles('admin') @Post('vehicle-plans/:id/status') @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) { return this.plans.setStatus(id, dto.status, dto.note); }
}

/** What a driver sees of their own vehicle plan. */
@Controller('driver/vehicle-plan')
@Roles('driver')
export class DriverVehiclePlanController {
  constructor(private readonly plans: VehiclePlansService) {}

  @Get()
  async mine(@CurrentUser() me: Principal) { return { plan: await this.plans.forDriver(me.id) }; }
}
