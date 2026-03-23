import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SwapsService } from './swaps.service';

@Injectable()
export class SwapsScheduler {
  constructor(private swapsService: SwapsService) {}

  @Cron('*/15 * * * *')
  async expireDropRequests() {
    await this.swapsService.expireDropRequests();
  }
}
