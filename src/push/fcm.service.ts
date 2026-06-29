import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private messaging: admin.messaging.Messaging | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const credentialsJson = this.config.get<string>('FIREBASE_CREDENTIALS_JSON');
    if (!credentialsJson) {
      this.logger.warn('FIREBASE_CREDENTIALS_JSON not set — push notifications disabled');
      return;
    }
    try {
      const serviceAccount = JSON.parse(credentialsJson);
      const app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      this.messaging = admin.messaging(app);
      this.logger.log('Firebase Admin SDK initialised');
    } catch (err: any) {
      this.logger.error(`Failed to initialise Firebase: ${err.message}`);
    }
  }

  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.messaging || tokens.length === 0) return;

    const message: admin.messaging.MulticastMessage = {
      notification: { title, body },
      data,
      tokens,
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    };

    try {
      const response = await this.messaging.sendEachForMulticast(message);
      if (response.failureCount > 0) {
        const failed = response.responses
          .map((r, i) => (!r.success ? tokens[i] : null))
          .filter(Boolean);
        this.logger.warn(`FCM: ${response.failureCount} tokens failed — ${failed.join(', ')}`);
      }
    } catch (err: any) {
      this.logger.error(`FCM multicast failed: ${err.message}`);
    }
  }
}
