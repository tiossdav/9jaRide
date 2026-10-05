import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseInterceptors } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { StaffAuditInterceptor } from '../common/audit.interceptor';
import { TeamService, StaffRole } from './team.service';

class InviteDto {
  @IsEmail() @MaxLength(200) email!: string;
  @IsString() @MinLength(2) @MaxLength(100) fullName!: string;
  @IsOptional() @IsString() @Matches(/^[0-9+ ()-]{7,20}$/) phone?: string;
  @IsIn(['support', 'finance', 'admin', 'business']) role!: StaffRole;
  @IsOptional() @IsUUID() businessId?: string;
}
class RoleDto { @IsIn(['support', 'finance', 'admin']) role!: StaffRole; }
class ActiveDto { @IsBoolean() active!: boolean; }
class SearchQuery { @IsOptional() @IsString() @MaxLength(60) search?: string; }

/** Admins only. Every change is written to the staff audit log. */
@Controller('admin/team')
@Roles('admin')
@UseInterceptors(StaffAuditInterceptor)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get() list(@Query() q: SearchQuery) { return this.team.list(q.search); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.team.get(id); }

  @Post() @HttpCode(200)
  invite(@CurrentUser() me: Principal, @Body() dto: InviteDto) { return this.team.invite(me.id, dto); }

  @Post(':id/role') @HttpCode(204)
  async role(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleDto) { await this.team.setRole(me.id, id, dto.role); }

  @Post(':id/active') @HttpCode(204)
  async active(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActiveDto) { await this.team.setActive(me.id, id, dto.active); }

  @Post(':id/reset-password') @HttpCode(200)
  reset(@Param('id', ParseUUIDPipe) id: string) { return this.team.resetPassword(id); }
}
