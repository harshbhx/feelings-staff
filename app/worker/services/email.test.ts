/** Email sender routes (ADR-09) and the sign-in template (PRD 6 N31). */
import { describe, expect, it, vi } from 'vitest';
import { systemCtx } from '../cron/context';
import { testEnv } from '../test/helpers';
import { newSalon } from '../test/notify-kit';
import { createEmailSender, parseFrom } from './email';
import { signInEmail } from './email-templates';
import { translator } from './notifier-plan';

const msg = { to: 'owner@feelings.test', subject: 'Hello', text: 'Body', html: '<p>Body</p>' };

describe('EmailSender', () => {
  it('parses a display name and address', () => {
    expect(parseFrom('Feelings Staff <staff@feelingsbeautycare.in>')).toEqual({
      name: 'Feelings Staff',
      address: 'staff@feelingsbeautycare.in',
    });
    expect(parseFrom('a@b.c')).toEqual({ name: null, address: 'a@b.c' });
  });

  it('outbox mode records the message and sends nothing', async () => {
    const salon = await newSalon();
    const { ctx } = await systemCtx(testEnv, salon.orgId, Date.now());
    await createEmailSender().send(ctx, msg);
    const row = await testEnv.DB.prepare(
      "SELECT to_addr, payload_json FROM test_outbox WHERE channel = 'email'",
    ).first<{ to_addr: string; payload_json: string }>();
    expect(row?.to_addr).toBe('owner@feelings.test');
    expect(JSON.parse(row?.payload_json ?? '{}').subject).toBe('Hello');
  });

  it('cloudflare mode sends through the EMAIL binding', async () => {
    const salon = await newSalon();
    const send = vi.fn(async () => ({ messageId: 'm1' }));
    const env = { ...testEnv, EMAIL_PROVIDER: 'cloudflare' as const, EMAIL: { send } };
    const { ctx } = await systemCtx(env, salon.orgId, Date.now());
    await createEmailSender().send(ctx, msg);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@feelings.test',
        from: { email: 'staff@feelingsbeautycare.in', name: 'Feelings Staff' },
        subject: 'Hello',
        text: 'Body',
      }),
    );
  });

  it('cloudflare mode without the binding fails with UNAVAILABLE', async () => {
    const salon = await newSalon();
    const env = { ...testEnv, EMAIL_PROVIDER: 'cloudflare' as const };
    const { ctx } = await systemCtx(env, salon.orgId, Date.now());
    await expect(createEmailSender().send(ctx, msg)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('resend mode posts to the Resend API with the key', async () => {
    const salon = await newSalon();
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const env = { ...testEnv, EMAIL_PROVIDER: 'resend' as const, RESEND_API_KEY: 're_test_key' };
      const { ctx } = await systemCtx(env, salon.orgId, Date.now());
      await createEmailSender().send(ctx, msg);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://api.resend.com/emails');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
      expect(JSON.parse(init.body as string).to).toEqual(['owner@feelings.test']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('N31 sign-in email', () => {
  it('has the code in the subject, a link and a code in both text and html, valid 15 minutes', async () => {
    const t = await translator('en');
    const m = signInEmail(
      t,
      'owner@feelings.test',
      'https://staff.test/auth/owner?token=abc&x=1',
      '482913',
    );
    expect(m.subject).toBe('Your Feelings Staff sign-in code: 482913');
    expect(m.text).toContain('482913');
    expect(m.text).toContain('https://staff.test/auth/owner?token=abc&x=1');
    expect(m.text).toContain('15 minutes');
    expect(m.html).toContain('482913');
    expect(m.html).toContain('token=abc&amp;x=1');
  });
});
