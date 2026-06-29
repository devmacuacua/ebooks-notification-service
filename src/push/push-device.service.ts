import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PushDeviceService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, token: string, platform: string) {
    return this.prisma.pushDevice.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async unregister(userId: string, token: string) {
    return this.prisma.pushDevice.deleteMany({ where: { token, userId } });
  }

  async getTokensForUser(userId: string): Promise<string[]> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId },
      select: { token: true },
    });
    return devices.map((d) => d.token);
  }

  async listForUser(userId: string) {
    return this.prisma.pushDevice.findMany({
      where: { userId },
      select: { id: true, platform: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
