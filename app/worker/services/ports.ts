/**
 * Server ports (PRD 16.3). Owner: WP-1. Implementations live in the named package's files and are
 * wired in services/registry.ts. Every port has a fake in worker/test/fakes/.
 */
import type {
  AuditActorType,
  AuditCategory,
  DayResult,
  Lang,
  NotifyEvent,
  PayrollRunView,
  Permission,
  PushPayload,
  Role,
} from '@fs/contracts';
import type { OrgDb, SystemDb } from '../db';
import type { Env } from '../env';

export interface Clock {
  now(): number;
  /** True when a test clock is set (preview/local only). */
  readonly fake: boolean;
}

export interface SessionInfo {
  tokenHash: string;
  kind: 'user' | 'door';
  orgId: string;
  userId: string | null;
  deviceId: string | null;
  createdAt: number;
  expiresAt: number;
  stepUpUntil: number | null;
}

export interface SessionUser {
  id: string;
  orgId: string;
  role: Role;
  name: string;
  status: 'invited' | 'active' | 'suspended' | 'exited';
  lang: Lang;
  phone: string | null;
  email: string | null;
  /** Owner: every permission. Manager: granted ones. Staff: none. */
  permissions: Permission[];
}

export interface AuditEntry {
  category: AuditCategory;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Defaults to the session user (or `system` when there is none). */
  actorType?: AuditActorType;
  actorId?: string | null;
}

export interface Audit {
  /** Write one row now. */
  log(ctx: Ctx, e: AuditEntry): Promise<void>;
  /** The same row as a statement, to commit inside a DB.batch with the change it records. */
  stmt(ctx: Ctx, e: AuditEntry): D1PreparedStatement;
}

export interface Notifier {
  emit(ctx: Ctx, e: NotifyEvent): Promise<void>;
}

export interface StepUp {
  /** Throws STEP_UP_REQUIRED unless the owner PIN was entered in the last 10 minutes. */
  require(ctx: Ctx): Promise<void>;
}

export interface DayService {
  /** Recompute and store attendance_days for (user, date); returns the engine result. */
  recompute(ctx: Ctx, userId: string, date: string): Promise<DayResult>;
}

export interface PayrollService {
  draft(ctx: Ctx, month: string): Promise<PayrollRunView>;
  recompute(ctx: Ctx, runId: string): Promise<PayrollRunView>;
  finalise(ctx: Ctx, runId: string, acceptDefaults: boolean): Promise<PayrollRunView>;
}

export interface PdfRenderer {
  render(
    template: 'payslip' | 'register' | 'salary_register',
    data: unknown,
    lang: 'en' | 'gu',
  ): Promise<ArrayBuffer>;
}

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOpts {
  ttlSec: number;
  urgency: 'high' | 'normal';
  topic?: string;
}

export type PushOutcome =
  | { ok: true; status: number }
  | { ok: false; status: number; gone: boolean; retryAfterSec?: number };

export interface PushSender {
  send(sub: PushSub, payload: PushPayload, opts: PushOpts): Promise<PushOutcome>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export interface MapsResolver {
  resolve(url: string): Promise<{ lat: number; lng: number; label?: string }>;
}

/** Captures pushes, emails and WhatsApp in preview/local instead of sending (PRD 9.4 test routes). */
export interface Outbox {
  record(
    ctx: Ctx,
    channel: 'push' | 'email' | 'whatsapp',
    to: string,
    payload: unknown,
  ): Promise<void>;
}

export interface Services {
  clock: Clock;
  audit: Audit;
  notifier: Notifier;
  stepUp: StepUp;
  days: DayService;
  payroll: PayrollService;
  pdf: PdfRenderer;
  push: PushSender;
  email: EmailSender;
  maps: MapsResolver;
  outbox: Outbox;
}

/** Per-request context (PRD 16.3): env, org, user, role, permissions, request id, repositories. */
export interface Ctx {
  env: Env;
  requestId: string;
  /** Current time from the request clock (fake in tests). */
  now(): number;
  session: SessionInfo | null;
  user: SessionUser | null;
  /** Org of the session, or of the single org for public routes (null before setup). */
  orgId: string | null;
  /** Org-scoped DB; throws if there is no org. */
  readonly db: OrgDb;
  /** Unscoped DB for pre-auth lookups (see db/index.ts). */
  sys: SystemDb;
  /** Raw client IP (never stored). */
  ip: string | null;
  /** HMAC(IP_HMAC_KEY, ip), computed once per request; safe to store. */
  ipHmac: string | null;
  cf: IncomingRequestCfProperties | null;
  waitUntil(p: Promise<unknown>): void;
  services: Services;
}
