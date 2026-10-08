import { Body, Controller, Get, HttpCode, Module, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CurrentUser, Principal, Roles } from '../auth/auth.types';
import { MapsService } from './maps.service';

class PlacesQuery {
  @IsString() @MinLength(1) @MaxLength(120) q!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
}
class PointQuery {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
}
class PointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}
class RouteDto {
  @ValidateNested() @Type(() => PointDto) from!: PointDto;
  @ValidateNested() @Type(() => PointDto) to!: PointDto;
}

/** Google Maps for the apps, asked through the server so the key never ships inside an app. */
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  /** Place search. Send the phone's position as lat and lng and nearby matches come first; without it the search is Nigeria-wide. */
  @Roles('rider', 'driver') @Get('places')
  async places(@CurrentUser() me: Principal, @Query() q: PlacesQuery) {
    const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    return { places: await this.maps.searchPlaces(me.id, q.q, near) };
  }

  @Roles('rider', 'driver') @Get('reverse')
  async reverse(@CurrentUser() me: Principal, @Query() q: PointQuery) {
    return { address: await this.maps.reverse(me.id, q) };
  }

  @Roles('rider', 'driver') @Post('route') @HttpCode(200)
  route(@Body() dto: RouteDto) {
    return this.maps.route(dto.from, dto.to);
  }
}

@Module({ controllers: [MapsController], providers: [MapsService], exports: [MapsService] })
export class MapsModule {}
