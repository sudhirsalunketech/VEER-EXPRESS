import { Injectable } from '@nestjs/common';

/**
 * Per-email failed-login throttle (in-process). Production behind multiple instances should move
 * this to a shared store; a single Render instance is fine for the initial launch.
 */
@Injectable()
export class LoginThrottle {
  static readonly MAX_FAILURES = 5;
  static readonly WINDOW_MS = 15 * 60e3;
  private failures = new Map<string, number[]>();

  private recent(email: string, now: number) {
    const list = (this.failures.get(email) ?? []).filter((t) => now - t < LoginThrottle.WINDOW_MS);
    this.failures.set(email, list);
    return list;
  }
  isLocked(email: string, now = Date.now()) { return this.recent(email.toLowerCase(), now).length >= LoginThrottle.MAX_FAILURES; }
  fail(email: string, now = Date.now()) { this.recent(email.toLowerCase(), now).push(now); }
  succeed(email: string) { this.failures.delete(email.toLowerCase()); }
}
