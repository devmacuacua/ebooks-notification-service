import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { FcmService } from '../push/fcm.service';
import { PushDeviceService } from '../push/push-device.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
    private readonly pushDevices: PushDeviceService,
  ) {}

  async create(dto: CreateNotificationDto) {
    this.logger.log(`Creating notification for user ${dto.userId} - type: ${dto.type}`);
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        metadata: dto.metadata ?? undefined,
      },
    });

    const tokens = await this.pushDevices.getTokensForUser(dto.userId);
    if (tokens.length > 0) {
      await this.fcm.sendToTokens(tokens, dto.title, dto.body, {
        type: dto.type,
        notificationId: notification.id,
      });
    }

    return notification;
  }

  async findByUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async remove(id: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return this.prisma.notification.delete({ where: { id } });
  }

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }
}
