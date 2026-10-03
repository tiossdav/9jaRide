import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DispatchService } from './dispatch.service';

// Runs in the worker role. Safe to run on several instances: sweep() takes a short Redis lock.
@Injectable()
export class DispatchWorker {
  private readonly log = new Logger(DispatchWorker.name);

  constructor(private readonly dispatch: DispatchService) {}

  @Interval(5_000)
  async tick() {
    try {
      await this.dispatch.sweep();
    } catch (e) {
      this.log.error(`sweep failed: ${e}`);
    }
  }
}
