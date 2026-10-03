import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../common/infra.module';
import { MAX_BATCH } from '../rides/location.service';

export type Platform = 'android' | 'ios';

export interface PlatformConfig {
  /** Versions below this must update before they can use the app. */
  minVersion: string;
  latestVersion: string;
  updateUrl: string;
}

export interface ClientConfig {
  android: PlatformConfig;
  ios: PlatformConfig;
}

/**
 * Behaviour the driver app reads at start-up, so it can be tuned without an app release. The numbers are the contract
 * the server enforces (batch size, how old a reading may be); the intervals are placeholders to tune on real phones.
 */
export const DRIVER_LOCATION_SETTINGS = {
  movingIntervalSeconds: 4,
  idleIntervalSeconds: 15,
  batchUploadSeconds: 20,
  batchMaxPoints: MAX_BATCH,
  bufferMaxPoints: 5000,
  bufferMaxAgeHours: 24,
  minAccuracyMeters: 100,
  liveMaxAgeSeconds: 30,
};

/** Steps shown to drivers so the phone does not stop the app in the background. Unverified on real devices: check each before shipping. */
export const BATTERY_GUIDANCE = [
  {
    brands: ['all'],
    title: 'Keep 9jaRide running',
    steps: [
      'Open phone Settings, then Apps, then 9jaRide, then Battery.',
      'Choose "Unrestricted" or "No restrictions". Do not choose "Optimised".',
      'Allow location "All the time" and turn on "Precise location".',
      'Turn off battery saver while you are online.',
    ],
  },
  {
    brands: ['tecno', 'infinix', 'itel'],
    title: 'Tecno, Infinix and itel phones',
    steps: [
      'Open Phone Master or Phone Manager, then App management, then Auto-start. Turn 9jaRide on.',
      'Open the recent apps screen and lock 9jaRide (pull the card down or tap the lock) so cleaning does not close it.',
    ],
  },
  {
    brands: ['samsung'],
    title: 'Samsung phones',
    steps: ['Settings, then Battery, then Background usage limits. Remove 9jaRide from "Sleeping apps" and "Deep sleeping apps".'],
  },
  {
    brands: ['xiaomi', 'redmi', 'poco'],
    title: 'Xiaomi, Redmi and Poco phones',
    steps: [
      'Settings, then Apps, then Manage apps, then 9jaRide. Turn on Autostart.',
      'In the same screen choose Battery saver, then "No restrictions".',
    ],
  },
  {
    brands: ['oppo', 'realme', 'oneplus'],
    title: 'Oppo, Realme and OnePlus phones',
    steps: ['Settings, then Battery, then 9jaRide. Allow background activity and auto-launch.'],
  },
];

const DEFAULTS: ClientConfig = {
  android: { minVersion: '0.0.0', latestVersion: '0.0.0', updateUrl: '' },
  ios: { minVersion: '0.0.0', latestVersion: '0.0.0', updateUrl: '' },
};

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** -1, 0 or 1. Both arguments must already be valid x.y.z. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

@Injectable()
export class AppConfigService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async stored(): Promise<ClientConfig> {
    const { rows } = await this.pool.query(`SELECT value FROM app_config WHERE key = 'client'`);
    return { ...DEFAULTS, ...(rows[0]?.value ?? {}) };
  }

  /** What an app of this platform and version should do. A missing or unreadable version never forces an update. */
  async forClient(platform: Platform | undefined, version: string | undefined) {
    const cfg = await this.stored();
    const p = platform ? cfg[platform] : undefined;
    const known = !!p && !!version && VERSION.test(version);
    return {
      forceUpdate: known ? compareVersions(version!, p!.minVersion) < 0 : false,
      updateAvailable: known ? compareVersions(version!, p!.latestVersion) < 0 : false,
      minVersion: p?.minVersion ?? null,
      latestVersion: p?.latestVersion ?? null,
      updateUrl: p?.updateUrl || null,
      driverLocation: DRIVER_LOCATION_SETTINGS,
      batteryGuidance: BATTERY_GUIDANCE,
      serverTime: new Date().toISOString(), // lets the app notice a wrong phone clock
    };
  }

  async current(): Promise<ClientConfig> {
    return this.stored();
  }

  async update(staffId: string, platform: Platform, next: PlatformConfig): Promise<ClientConfig> {
    for (const v of [next.minVersion, next.latestVersion]) if (!VERSION.test(v)) throw new BadRequestException('versions look like 1.4.0');
    // Forcing everyone above the latest release would lock drivers out of the app with no way to update.
    if (compareVersions(next.minVersion, next.latestVersion) > 0) {
      throw new BadRequestException({ code: 'min_above_latest', message: 'the minimum version cannot be higher than the latest version' });
    }
    if (compareVersions(next.minVersion, '0.0.0') > 0 && !next.updateUrl) {
      throw new BadRequestException({ code: 'update_url_required', message: 'set where people can download the update before forcing one' });
    }
    const merged = { ...(await this.stored()), [platform]: next };
    await this.pool.query(
      `INSERT INTO app_config (key, value, updated_by) VALUES ('client', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(merged), staffId],
    );
    return merged;
  }
}
