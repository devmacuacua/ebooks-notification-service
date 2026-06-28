import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  private baseTemplate(title: string, content: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif; background-color: #f4f4f7; color: #333; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); padding: 32px 40px; text-align: center; }
    .header h1 { color: #e94560; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: #a0aec0; font-size: 14px; margin-top: 4px; }
    .body { padding: 40px; }
    .body h2 { font-size: 22px; color: #1a1a2e; margin-bottom: 12px; }
    .body p { font-size: 15px; line-height: 1.7; color: #555; margin-bottom: 16px; }
    .btn { display: inline-block; padding: 14px 32px; background: #e94560; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0; }
    .btn:hover { background: #c73652; }
    .info-box { background: #f8f9fa; border-left: 4px solid #e94560; border-radius: 4px; padding: 16px 20px; margin: 20px 0; }
    .info-box p { margin-bottom: 6px; font-size: 14px; }
    .info-box p:last-child { margin-bottom: 0; }
    .info-box strong { color: #1a1a2e; }
    .divider { border: none; border-top: 1px solid #eee; margin: 24px 0; }
    .footer { background: #f8f9fa; padding: 24px 40px; text-align: center; border-top: 1px solid #eee; }
    .footer p { font-size: 13px; color: #999; line-height: 1.6; }
    .footer a { color: #e94560; text-decoration: none; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
    .badge-warning { background: #fff3cd; color: #856404; }
    .badge-success { background: #d4edda; color: #155724; }
    .badge-danger { background: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>EBooksStore</h1>
      <p>Your Digital Library</p>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} EBooksStore. All rights reserved.</p>
      <p>You received this email because you have an account with us.<br/>
      <a href="${this.config.get('FRONTEND_URL')}/settings/notifications">Manage notifications</a></p>
    </div>
  </div>
</body>
</html>`;
  }

  private async sendAndLog(
    to: string,
    subject: string,
    template: string,
    html: string,
  ): Promise<void> {
    const from = this.config.get<string>('SMTP_FROM', 'EBooksStore <noreply@ebooksstore.com>');
    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Email [${template}] sent to ${to}`);
      await this.prisma.emailLog.create({
        data: { to, subject, template, status: 'SENT' },
      });
    } catch (err: any) {
      this.logger.error(`Failed to send email [${template}] to ${to}: ${err.message}`);
      await this.prisma.emailLog.create({
        data: { to, subject, template, status: 'FAILED', error: err.message },
      });
      throw err;
    }
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    verificationUrl: string,
  ): Promise<void> {
    const subject = 'Verify your EBooksStore account';
    const content = `
      <h2>Welcome to EBooksStore, ${name}! 👋</h2>
      <p>Thanks for signing up! Please verify your email address to activate your account and start exploring thousands of ebooks.</p>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${verificationUrl}" class="btn">Verify Email Address</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">This link expires in <strong>24 hours</strong>. If you didn't create an account, you can safely ignore this email.</p>
      <p style="font-size:13px; color:#999;">Or copy this link into your browser:<br/><a href="${verificationUrl}" style="color:#e94560; word-break:break-all;">${verificationUrl}</a></p>
    `;
    await this.sendAndLog(to, subject, 'verification', this.baseTemplate(subject, content));
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    resetUrl: string,
  ): Promise<void> {
    const subject = 'Reset your EBooksStore password';
    const content = `
      <h2>Password Reset Request</h2>
      <p>Hi ${name},</p>
      <p>We received a request to reset the password for your EBooksStore account. Click the button below to choose a new password.</p>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </p>
      <div class="info-box">
        <p>⏰ This link will expire in <strong>1 hour</strong> for security reasons.</p>
      </div>
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">If you didn't request a password reset, your account is safe — just ignore this email. No changes have been made.</p>
      <p style="font-size:13px; color:#999;">Or copy this link into your browser:<br/><a href="${resetUrl}" style="color:#e94560; word-break:break-all;">${resetUrl}</a></p>
    `;
    await this.sendAndLog(to, subject, 'password-reset', this.baseTemplate(subject, content));
  }

  async sendSubscriptionExpiringEmail(
    to: string,
    name: string,
    daysLeft: number,
    renewUrl: string,
  ): Promise<void> {
    const subject = `Your EBooksStore subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
    const urgency = daysLeft === 1 ? 'badge-danger' : daysLeft <= 3 ? 'badge-warning' : 'badge-warning';
    const content = `
      <h2>Subscription Expiring Soon</h2>
      <p>Hi ${name},</p>
      <p>Your EBooksStore subscription is expiring soon. Don't lose access to your favorite ebooks!</p>
      <div class="info-box">
        <p>⏳ Your subscription expires in: <span class="badge ${urgency}">${daysLeft} day${daysLeft !== 1 ? 's' : ''}</span></p>
        <p>Renew now to keep uninterrupted access to your digital library.</p>
      </div>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${renewUrl}" class="btn">Renew Subscription</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">If you choose not to renew, your account will revert to free tier access. Your purchased books will remain available.</p>
    `;
    await this.sendAndLog(to, subject, 'subscription-expiring', this.baseTemplate(subject, content));
  }

  async sendOrderConfirmationEmail(
    to: string,
    name: string,
    order: {
      id: string;
      status: string;
      items: Array<{ title: string; author: string; price: number }>;
      total: number;
      createdAt?: string;
    },
  ): Promise<void> {
    const subject = `Order Confirmation — EBooksStore #${order.id.substring(0, 8).toUpperCase()}`;
    const itemRows = order.items
      .map(
        (item) => `
        <tr>
          <td style="padding:12px 8px; border-bottom:1px solid #eee;">
            <strong>${item.title}</strong><br/>
            <span style="color:#888; font-size:13px;">${item.author}</span>
          </td>
          <td style="padding:12px 8px; border-bottom:1px solid #eee; text-align:right; white-space:nowrap;">
            $${item.price.toFixed(2)}
          </td>
        </tr>`,
      )
      .join('');

    const content = `
      <h2>Order Confirmed! 🎉</h2>
      <p>Hi ${name},</p>
      <p>Thank you for your purchase. Your order has been received and is being processed.</p>
      <div class="info-box">
        <p><strong>Order ID:</strong> #${order.id.substring(0, 8).toUpperCase()}</p>
        <p><strong>Status:</strong> <span class="badge badge-success">${order.status}</span></p>
        ${order.createdAt ? `<p><strong>Date:</strong> ${new Date(order.createdAt).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>` : ''}
      </div>
      <table style="width:100%; border-collapse:collapse; margin: 20px 0;">
        <thead>
          <tr style="background:#f8f9fa;">
            <th style="padding:12px 8px; text-align:left; font-size:13px; color:#666; font-weight:600;">Book</th>
            <th style="padding:12px 8px; text-align:right; font-size:13px; color:#666; font-weight:600;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td style="padding:16px 8px; font-weight:700; font-size:16px;">Total</td>
            <td style="padding:16px 8px; font-weight:700; font-size:16px; text-align:right; color:#e94560;">$${order.total.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p style="text-align:center; margin: 24px 0;">
        <a href="${this.config.get('FRONTEND_URL')}/orders/${order.id}" class="btn">View Order Details</a>
      </p>
    `;
    await this.sendAndLog(to, subject, 'order-confirmation', this.baseTemplate(subject, content));
  }

  async sendDeliveryUpdateEmail(
    to: string,
    name: string,
    delivery: {
      orderId: string;
      status: string;
      estimatedDelivery?: string;
      trackingUrl?: string;
      notes?: string;
    },
  ): Promise<void> {
    const subject = `Delivery Update — Your EBooksStore order #${delivery.orderId.substring(0, 8).toUpperCase()}`;
    const content = `
      <h2>Delivery Status Update</h2>
      <p>Hi ${name},</p>
      <p>There's an update on your recent order. Here are the latest details:</p>
      <div class="info-box">
        <p><strong>Order ID:</strong> #${delivery.orderId.substring(0, 8).toUpperCase()}</p>
        <p><strong>Current Status:</strong> <span class="badge badge-success">${delivery.status}</span></p>
        ${delivery.estimatedDelivery ? `<p><strong>Estimated Delivery:</strong> ${delivery.estimatedDelivery}</p>` : ''}
        ${delivery.notes ? `<p><strong>Notes:</strong> ${delivery.notes}</p>` : ''}
      </div>
      ${
        delivery.trackingUrl
          ? `<p style="text-align:center; margin: 32px 0;"><a href="${delivery.trackingUrl}" class="btn">Track Your Order</a></p>`
          : `<p style="text-align:center; margin: 32px 0;"><a href="${this.config.get('FRONTEND_URL')}/orders/${delivery.orderId}" class="btn">View Order Details</a></p>`
      }
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">Digital books are available immediately in your library. Physical items will be shipped to your registered address.</p>
    `;
    await this.sendAndLog(to, subject, 'delivery-update', this.baseTemplate(subject, content));
  }

  async sendSubscriptionActivatedEmail(
    to: string,
    name: string,
    planName: string,
    expiresAt: string,
  ): Promise<void> {
    const subject = 'Welcome to EBooksStore — Subscription Active!';
    const expiry = new Date(expiresAt).toLocaleDateString('en-US', { dateStyle: 'long' });
    const content = `
      <h2>Your subscription is active 🎉</h2>
      <p>Hi ${name},</p>
      <p>Thank you for subscribing to EBooksStore. Your <strong>${planName}</strong> plan is now active and you have unlimited access to our entire ebook library.</p>
      <div class="info-box">
        <p><strong>Plan:</strong> ${planName}</p>
        <p><strong>Access until:</strong> ${expiry}</p>
        <p><strong>Status:</strong> <span class="badge badge-success">Active</span></p>
      </div>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${this.config.get('FRONTEND_URL')}/catalog" class="btn">Start Reading</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">Your subscription renews automatically. You can manage it anytime from your account settings.</p>
    `;
    await this.sendAndLog(to, subject, 'subscription-activated', this.baseTemplate(subject, content));
  }

  async sendPaymentConfirmedEmail(
    to: string,
    name: string,
    payment: {
      id: string;
      amount: number;
      currency?: string;
      method?: string;
      orderId?: string;
      date?: string;
    },
  ): Promise<void> {
    const subject = 'Payment Confirmed — EBooksStore Receipt';
    const currency = payment.currency || 'USD';
    const content = `
      <h2>Payment Received ✅</h2>
      <p>Hi ${name},</p>
      <p>We've successfully received your payment. Here's your receipt:</p>
      <div class="info-box">
        <p><strong>Payment ID:</strong> ${payment.id.substring(0, 8).toUpperCase()}</p>
        ${payment.orderId ? `<p><strong>Order ID:</strong> #${payment.orderId.substring(0, 8).toUpperCase()}</p>` : ''}
        <p><strong>Amount Paid:</strong> <span style="color:#155724; font-weight:700;">$${payment.amount.toFixed(2)} ${currency}</span></p>
        ${payment.method ? `<p><strong>Payment Method:</strong> ${payment.method}</p>` : ''}
        ${payment.date ? `<p><strong>Date:</strong> ${new Date(payment.date).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>` : ''}
        <p><strong>Status:</strong> <span class="badge badge-success">Confirmed</span></p>
      </div>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${this.config.get('FRONTEND_URL')}/orders${payment.orderId ? `/${payment.orderId}` : ''}" class="btn">View Purchase</a>
      </p>
      <hr class="divider" />
      <p style="font-size:13px; color:#999;">This email serves as your official receipt. Keep it for your records. If you have any questions about this charge, please contact our support team.</p>
    `;
    await this.sendAndLog(to, subject, 'payment-confirmed', this.baseTemplate(subject, content));
  }
}
