/**
 * A software authenticator for the owner passkey tests (docs/owner-access.md, slice 4). It builds the
 * registration and assertion responses a browser sends (`PublicKeyCredential.toJSON()`), signed with
 * WebCrypto keys (ES256 or RS256), so the Worker's @simplewebauthn/server checks run for real. Each
 * knob breaks one thing: the origin, the relying-party id, the user-verified flag, the counter, the
 * challenge. Test-only module.
 */
import { fromBase64Url, toBase64Url } from '@fs/contracts';

const enc = new TextEncoder();

// ---- Minimal CBOR (unsigned and negative integers, byte and text strings, maps) ------------------

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function cbor(v: Cbor): number[] {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') {
    const b = enc.encode(v);
    return [...head(3, b.length), ...b];
  }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  const out = head(5, v.size);
  for (const [k, val] of v) out.push(...cbor(k), ...cbor(val));
  return out;
}

// ---- Helpers -------------------------------------------------------------------------------------

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)));
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return new Uint8Array(out);
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** ECDSA signatures in WebAuthn are ASN.1 DER; WebCrypto gives r || s. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array): number[] => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = [...b.slice(i)];
    if (((v[0] ?? 0) & 0x80) !== 0) v.unshift(0);
    return [0x02, v.length, ...v];
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export type Alg = 'ES256' | 'RS256';

/** What the server's options tell the authenticator (the parts it uses). */
export interface ChallengeOptions {
  challenge: string;
}

/** One way to break a response; the defaults make a valid one. */
export interface Knobs {
  origin?: string;
  rpId?: string;
  /** Leave the user-verified flag out (a tap without fingerprint or PIN). */
  noUserVerification?: boolean;
  /** Sign this challenge instead of the one in the options. */
  challenge?: string;
  /** clientDataJSON type (`webauthn.create` / `webauthn.get`). */
  type?: string;
}

export interface RegistrationJson {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment: 'platform';
  clientExtensionResults: Record<string, never>;
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
}

export interface AssertionJson {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment: 'platform';
  clientExtensionResults: Record<string, never>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

export class SoftAuthenticator {
  /** Signature counter put in the next response (0 stays 0, like a synced passkey). */
  counter = 0;
  /** User handle from the registration options (sent back with assertions). */
  userHandle: string | undefined;

  private constructor(
    readonly alg: Alg,
    readonly rpId: string,
    readonly origin: string,
    readonly credentialId: Uint8Array,
    private readonly keys: CryptoKeyPair,
  ) {}

  static async create(opts: {
    rpId: string;
    origin: string;
    alg?: Alg;
  }): Promise<SoftAuthenticator> {
    const alg = opts.alg ?? 'ES256';
    const keys = (await crypto.subtle.generateKey(
      alg === 'ES256'
        ? { name: 'ECDSA', namedCurve: 'P-256' }
        : {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const id = new Uint8Array(32);
    crypto.getRandomValues(id);
    return new SoftAuthenticator(alg, opts.rpId, opts.origin, id, keys);
  }

  get id(): string {
    return toBase64Url(this.credentialId);
  }

  private async coseKey(): Promise<Uint8Array> {
    const jwk = (await crypto.subtle.exportKey('jwk', this.keys.publicKey)) as JsonWebKey;
    const b = (s: string | undefined) => fromBase64Url(s ?? '');
    const key: Map<Cbor, Cbor> =
      this.alg === 'ES256'
        ? new Map<Cbor, Cbor>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, b(jwk.x)],
            [-3, b(jwk.y)],
          ])
        : new Map<Cbor, Cbor>([
            [1, 3],
            [3, -257],
            [-1, b(jwk.n)],
            [-2, b(jwk.e)],
          ]);
    return new Uint8Array(cbor(key));
  }

  private clientData(type: string, challenge: string, knobs: Knobs): Uint8Array {
    return enc.encode(
      JSON.stringify({
        type: knobs.type ?? type,
        challenge: knobs.challenge ?? challenge,
        origin: knobs.origin ?? this.origin,
        crossOrigin: false,
      }),
    );
  }

  private async flagsAndHash(knobs: Knobs, extra: number): Promise<[Uint8Array, number]> {
    const rpIdHash = await sha256(enc.encode(knobs.rpId ?? this.rpId));
    const flags = FLAG_UP | (knobs.noUserVerification ? 0 : FLAG_UV) | extra;
    return [rpIdHash, flags];
  }

  /** The answer to `navigator.credentials.create()` with attestation "none". */
  async register(
    options: ChallengeOptions & { user?: { id: string } },
    knobs: Knobs = {},
  ): Promise<RegistrationJson> {
    this.userHandle = options.user?.id;
    const [rpIdHash, flags] = await this.flagsAndHash(knobs, FLAG_AT);
    const authData = concat(
      rpIdHash,
      [flags],
      u32(this.counter),
      new Uint8Array(16), // AAGUID: zeros, as many platform authenticators send with attestation "none"
      [(this.credentialId.length >> 8) & 0xff, this.credentialId.length & 0xff],
      this.credentialId,
      await this.coseKey(),
    );
    const attestationObject = new Uint8Array(
      cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(this.clientData('webauthn.create', options.challenge, knobs)),
        attestationObject: toBase64Url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** The answer to `navigator.credentials.get()`. */
  async assert(options: ChallengeOptions, knobs: Knobs = {}): Promise<AssertionJson> {
    const [rpIdHash, flags] = await this.flagsAndHash(knobs, 0);
    const authData = concat(rpIdHash, [flags], u32(this.counter));
    const clientData = this.clientData('webauthn.get', options.challenge, knobs);
    const signed = concat(authData, await sha256(clientData));
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        this.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' },
        this.keys.privateKey,
        new Uint8Array(signed),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(clientData),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(this.alg === 'ES256' ? derSignature(raw) : raw),
        ...(this.userHandle ? { userHandle: this.userHandle } : {}),
      },
    };
  }
}
