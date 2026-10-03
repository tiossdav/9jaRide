import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseInterceptors } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { PromoService } from './promo.service';

const CODE = /^[A-Za-z0-9]{3,20}$/;

class CreatePromoDto {
  @IsString() @Matches(CODE) code!: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsIn(['percent', 'fixed']) kind!: 'percent' | 'fixed';
  @IsInt() @Min(1) @Max(100_000_000_000) value!: number;
  @IsOptional() @IsInt() @Min(0) maxDiscountKobo?: number;
  @IsOptional() @IsInt() @Min(0) minFareKobo?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @ValidateIf((o) => o.endsAt !== null) @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date | null;
  @ValidateIf((o) => o.maxUses !== null) @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) perRiderLimit?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

class UpdatePromoDto {
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000_000) value?: number;
  @IsOptional() @IsInt() @Min(0) maxDiscountKobo?: number;
  @IsOptional() @IsInt() @Min(0) minFareKobo?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @ValidateIf((o) => o.endsAt !== null) @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date | null;
  @ValidateIf((o) => o.maxUses !== null) @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) perRiderLimit?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

@Controller('admin/promos')
@Roles('finance', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class PromoAdminController {
  constructor(private readonly promos: PromoService) {}

  @Get() list() { return this.promos.list(); }
  @Get(':id/uses') uses(@Param('id', ParseUUIDPipe) id: string) { return this.promos.redemptions(id); }
  @Post() @HttpCode(200) create(@CurrentUser() me: Principal, @Body() dto: CreatePromoDto) { return this.promos.create(me.id, dto); }
  @Patch(':id') @HttpCode(204) async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromoDto) { await this.promos.update(id, dto); }
}

