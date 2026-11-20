import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt, randomUUID, type KeyObject, type JsonWebKey } from 'node:crypto';
import { BotError } from './contracts.js';

export interface EnvelopeBinding { taskId: string; requestId: string; origin: string }
export interface EnvelopeChallenge extends EnvelopeBinding { id: string; expiresAt: number; publicKey: JsonWebKey }
export interface SealedEnvelope { challengeId: string; wrappedKey: string; iv: string; ciphertext: string }
interface Entry { challenge: EnvelopeChallenge; key: KeyObject; used: boolean }
/** Only ciphertext crosses the UI/gateway boundary. No values are logged or persisted here. */
export class PrivateEnvelopes {
  private entries = new Map<string, Entry>();
  constructor(private now = () => Date.now()) {}
  issue(binding: EnvelopeBinding): EnvelopeChallenge {
    for (const [id, entry] of this.entries) if (entry.challenge.expiresAt <= this.now() || entry.used) this.entries.delete(id);
    // A fresh challenge invalidates previous envelopes for the same request.
    for (const [id, entry] of this.entries) if (entry.challenge.requestId === binding.requestId) this.entries.delete(id);
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const challenge: EnvelopeChallenge = { ...binding, id: randomUUID(), expiresAt: this.now() + 10 * 60_000, publicKey: publicKey.export({ format: 'jwk' }) };
    this.entries.set(challenge.id, { challenge, key: privateKey, used: false });
    return challenge;
  }
  async consume<T>(binding: EnvelopeBinding, envelope: SealedEnvelope, fields: string[], apply: (values: Record<string, string>) => Promise<T>): Promise<T> {
    const entry = this.entries.get(envelope?.challengeId);
    if (!entry || entry.used || entry.challenge.expiresAt <= this.now()) throw new BotError('Private input expired or already consumed', 409);
    if (Object.keys(binding).some(k => binding[k as keyof EnvelopeBinding] !== entry.challenge[k as keyof EnvelopeBinding])) throw new BotError('Private input target changed', 409);
    let key: Buffer | undefined, plaintext: Buffer | undefined;
    let values: Record<string, string>;
    try {
      key = privateDecrypt({ key: entry.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, decode(envelope.wrappedKey, 256, 256));
      if (key.length !== 32) throw new Error();
      const iv = decode(envelope.iv, 12, 12), encrypted = decode(envelope.ciphertext, 17, 32768);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(Buffer.from(envelopeAAD(entry.challenge)));
      decipher.setAuthTag(encrypted.subarray(-16));
      plaintext = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
      const input = JSON.parse(plaintext.toString('utf8'));
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || fields.some(f => typeof input[f] !== 'string' || !input[f].length || input[f].length > 4096)) throw new Error();
      values = input;
    } catch { throw new BotError('Invalid private input envelope', 400); }
    finally { key?.fill(0); plaintext?.fill(0); }
    // Consume before any browser side effect, including when delivery outcome is unknown.
    entry.used = true; this.entries.delete(entry.challenge.id);
    try { return await apply(values); }
    finally { for (const key of Object.keys(values)) values[key] = ''; }
  }
  clear() { this.entries.clear(); }
}
export function envelopeAAD(c: EnvelopeChallenge): string {
  return JSON.stringify({ id: c.id, taskId: c.taskId, requestId: c.requestId, origin: c.origin, expiresAt: c.expiresAt });
}
function decode(value: string, min: number, max: number): Buffer {
  if (typeof value !== 'string' || value.length > max * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value) throw new Error();
  return bytes;
}
