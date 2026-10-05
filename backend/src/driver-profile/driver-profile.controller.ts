import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { DriverProfileService } from './driver-profile.service';

class PhotoDto { @IsUUID() fileId!: string; }
class AccountDto {
  @IsString() @MinLength(2) @MaxLength(80) bankName!: string;
  @Matches(/^[0-9]{10}$/) accountNumber!: string;
  @IsString() @MinLength(2) @MaxLength(100) accountName!: string;
}
class TripsQuery { @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number; }

@Controller('driver')
@Roles('driver')
export class DriverProfileController {
  constructor(private readonly profiles: DriverProfileService) {}

  @Get('profile')
  profile(@CurrentUser() me: Principal) { return this.profiles.profile(me.id); }

  /** Set (or replace) the profile photo with a file the driver already uploaded to POST /files. */
  @Post('profile/photo') @HttpCode(204)
  async photo(@CurrentUser() me: Principal, @Body() dto: PhotoDto) { await this.profiles.setPhoto(me.id, dto.fileId); }

  @Get('trips')
  trips(@CurrentUser() me: Principal, @Query() q: TripsQuery) { return this.profiles.trips(me.id, q.limit); }

  @Get('settlement')
  settlement(@CurrentUser() me: Principal) { return this.profiles.settlement(me.id); }

  @Post('settlement/account') @HttpCode(204)
  async account(@CurrentUser() me: Principal, @Body() dto: AccountDto) { await this.profiles.saveAccount(me.id, dto); }

  @Post('settlement/complete') @HttpCode(204)
  async complete(@CurrentUser() me: Principal) { await this.profiles.completeSettlement(me.id); }
}
