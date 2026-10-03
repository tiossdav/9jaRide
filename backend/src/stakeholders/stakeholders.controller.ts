import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { StakeholdersService } from './stakeholders.service';

class RequestDto {
  @IsString() @MinLength(2) @MaxLength(60) stakeholder!: string;
  @IsInt() @Min(1) @Max(100_000_000_000) amountKobo!: number;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class RejectDto { @IsString() @MinLength(3) @MaxLength(300) reason!: string; }
class StatusQuery { @IsOptional() @IsIn(['PENDING_APPROVAL', 'PAID', 'REJECTED']) status?: string; }

@Controller('admin/stakeholders')
@Roles('finance', 'admin')
@UseInterceptors(StaffAuditInterceptor)
export class StakeholdersController {
  constructor(private readonly s: StakeholdersService) {}

  @Get() overview() { return this.s.overview(); }
  @Get('payouts') list(@Query() q: StatusQuery) { return this.s.list(q.status); }
  @Post('payouts') @HttpCode(200) request(@CurrentUser() me: Principal, @Body() dto: RequestDto) { return this.s.request(me.id, dto); }
  @Post('payouts/:id/approve') @HttpCode(204) async approve(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) { await this.s.approve(me.id, id); }
  @Post('payouts/:id/reject') @HttpCode(204) async reject(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto) { await this.s.reject(me.id, id, dto.reason); }
}
