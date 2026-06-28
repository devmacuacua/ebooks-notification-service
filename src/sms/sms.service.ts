import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly gatewayUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.gatewayUrl = config.get<string>('SMS_GATEWAY_URL', '');
    this.apiKey = config.get<string>('SMS_API_KEY', '');
    this.senderId = config.get<string>('SMS_SENDER_ID', 'EBooksStore');
    this.enabled = !!this.gatewayUrl && !!this.apiKey;
  }

  async send(to: string, message: string): Promise<SmsResult> {
    if (!this.enabled) {
      this.logger.warn(`SMS disabled (no gateway configured). Would send to ${to}: ${message}`);
      return { success: false, error: 'SMS gateway not configured' };
    }

    const normalised = this.normaliseMozambiquePhone(to);
    if (!normalised) {
      return { success: false, error: `Invalid phone number: ${to}` };
    }

    try {
      const { data } = await axios.post(
        this.gatewayUrl,
        {
          to: normalised,
          message,
          sender: this.senderId,
          apiKey: this.apiKey,
        },
        { timeout: 10_000 },
      );

      this.logger.log(`SMS sent to ${normalised} — id: ${data?.messageId}`);
      return { success: true, messageId: data?.messageId };
    } catch (err: any) {
      this.logger.error(`SMS failed to ${normalised}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Normalises Mozambican phone numbers to E.164 format (+258XXXXXXXXX) */
  private normaliseMozambiquePhone(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('258') && digits.length === 12) return `+${digits}`;
    if (digits.length === 9) return `+258${digits}`;
    return null;
  }
}
