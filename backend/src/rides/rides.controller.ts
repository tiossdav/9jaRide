import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateNested, IsBoolean } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { IdempotencyKey } from '../common/idempotency-key';
import { RidesService } from './rides.service';

const CATEGORIES = ['regular', 'comfort', 'package'] as const;
type Cat = (typeof CATEGORIES)[number];

class LatLng {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

class QuoteDto {
  @IsIn(CATEGORIES) category!: Cat;
  @IsInt() @Min(1) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
}

class RequestRideDto {
  @IsUUID() quoteId!: string;
  @IsIn(CATEGORIES) category!: Cat;
  @IsIn(['cash', 'wallet']) paymentMethod!: 'cash' | 'wallet';
  @ValidateNested() @Type(() => LatLng) pickup!: LatLng;
  @ValidateNested() @Type(() => LatLng) dropoff!: LatLng;
}

class PingDto extends LatLng {
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracyM?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(400) speedKmh?: number;
  @IsOptional() @IsBoolean() mockLocation?: boolean;
}

class CompleteDto {
  @IsInt() @Min(0) @Max(500_000) distanceM!: number;
  @IsInt() @Min(0) @Max(86_400) durationS!: number;
  @IsInt() @Min(0) @Max(86_400) waitingS!: number;
}

@Controller()
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  // ------------------------------------------------------------------ rider

  @Roles('rider') @Post('rides/quote') @HttpCode(200)
  quote(@CurrentUser() me: Principal, @Body() dto: QuoteDto) {
    return this.rides.quote(me.id, dto.category, { distanceM: dto.distanceM, durationS: dto.durationS });
  }

  @Roles('rider') @Post('rides') @HttpCode(200)
  async request(@CurrentUser() me: Principal, @IdempotencyKey() key: string, @Body() dto: RequestRideDto) {
    const r = await this.rides.request(me.id, key, dto);
    return { rideId: r.rideId, duplicate: !r.created };
  }

  // ------------------------------------------------------------------ rider, driver and staff

  @Get('rides/:id')
  get(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.get(me, id);
  }

  @Get('rides/:id/receipt')
  receipt(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.receipt(me, id);
  }

  // ------------------------------------------------------------------ driver

  @Roles('driver') @Post('driver/location') @HttpCode(204)
  async ping(@CurrentUser() me: Principal, @Body() dto: PingDto) {
    await this.rides.ping(me.id, dto);
  }

  @Roles('driver') @Post('driver/rides/:id/accept') @HttpCode(200)
  accept(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.rides.accept(me.id, id);
  }

  @Roles('driver') @Post('driver/rides/:id/decline') @HttpCode(204)
  async decline(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.decline(me.id, id);
  }

  @Roles('driver') @Post('driver/rides/:id/arrive') @HttpCode(204)
  async arrive(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.advanceTrip(me.id, id, 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED');
  }

  @Roles('driver') @Post('driver/rides/:id/start') @HttpCode(204)
  async start(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.rides.advanceTrip(me.id, id, 'DRIVER_ARRIVED', 'TRIP_STARTED');
  }

  @Roles('driver') @Post('driver/rides/:id/complete') @HttpCode(200)
  complete(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteDto) {
    return this.rides.complete(me.id, id, dto);
  }
}
