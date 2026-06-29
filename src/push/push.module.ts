import { Module } from '@nestjs/common';
import { FcmService } from './fcm.service';
import { PushDeviceService } from './push-device.service';
import { PushDeviceController } from './push-device.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PushDeviceController],
  providers: [FcmService, PushDeviceService],
  exports: [FcmService, PushDeviceService],
})
export class PushModule {}
