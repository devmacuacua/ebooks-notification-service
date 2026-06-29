import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { PushDeviceService } from './push-device.service';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

class RegisterDeviceDto {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

@ApiTags('Push Devices')
@Controller('notifications/push-devices')
export class PushDeviceController {
  constructor(private readonly pushDeviceService: PushDeviceService) {}

  @Post()
  @ApiOperation({ summary: 'Register a device for push notifications' })
  async register(
    @Headers('x-user-id') userId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    if (!userId) throw new BadRequestException('Missing X-User-Id header');
    if (!dto.token) throw new BadRequestException('token is required');
    return this.pushDeviceService.register(userId, dto.token, dto.platform ?? 'web');
  }

  @Delete(':token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unregister a device token' })
  async unregister(
    @Headers('x-user-id') userId: string,
    @Param('token') token: string,
  ) {
    if (!userId) throw new BadRequestException('Missing X-User-Id header');
    await this.pushDeviceService.unregister(userId, token);
  }

  @Get()
  @ApiOperation({ summary: 'List registered devices for the authenticated user' })
  listDevices(@Headers('x-user-id') userId: string) {
    if (!userId) throw new BadRequestException('Missing X-User-Id header');
    return this.pushDeviceService.listForUser(userId);
  }
}
