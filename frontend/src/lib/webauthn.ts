/**
 * Security keys and passkeys through the browser's WebAuthn API. The server (django-foundation's
 * foundation.mfa) sends options and takes credentials in WebAuthn's JSON form, base64url
 * everywhere; the browser wants and gives ArrayBuffers. Newer browsers convert themselves
 * (parse…FromJSON, toJSON()); the fallbacks here cover the rest.
 */

type Json = Record<string, unknown>;
export type KeyOptions = { publicKey: Json };

/** WebAuthn only exists on https (or localhost). Over http on the LAN, keys can't be used. */
export const webauthnAvailable = () =>
  typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window;

/** Asks the person's key, phone or laptop for a new credential. */
export async function createCredential(options: KeyOptions): Promise<Json> {
  const publicKey =
    "parseCreationOptionsFromJSON" in PublicKeyCredential
      ? PublicKeyCredential.parseCreationOptionsFromJSON(
          options.publicKey as unknown as PublicKeyCredentialCreationOptionsJSON,
        )
      : decodeCreation(options.publicKey);
  return toJson(await navigator.credentials.create({ publicKey }));
}

/** Asks for a signature from one of the person's keys, to sign in. */
export async function getCredential(options: KeyOptions): Promise<Json> {
  const publicKey =
    "parseRequestOptionsFromJSON" in PublicKeyCredential
      ? PublicKeyCredential.parseRequestOptionsFromJSON(
          options.publicKey as unknown as PublicKeyCredentialRequestOptionsJSON,
        )
      : decodeRequest(options.publicKey);
  return toJson(await navigator.credentials.get({ publicKey }));
}

/** What to tell someone whose browser said no. */
export function keyError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "The key didn't answer, or the request was cancelled. Try again.";
    if (error.name === "InvalidStateError") return "That key is already one of yours.";
    if (error.name === "SecurityError")
      return "Security keys only work on this site's https address.";
  }
  return error instanceof Error ? error.message : "The key couldn't be used.";
}

// --- base64url <-> ArrayBuffer, for browsers without the JSON helpers ------------------------

function fromB64url(value: string): ArrayBuffer {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer;
}

function toB64url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

type Descriptor = { id: string } & Json;
const decodeDescriptors = (list: unknown) =>
  ((list as Descriptor[] | undefined) ?? []).map((d) => ({ ...d, id: fromB64url(d.id) }));

function decodeCreation(o: Json): PublicKeyCredentialCreationOptions {
  const user = o.user as { id: string } & Json;
  return {
    ...o,
    challenge: fromB64url(o.challenge as string),
    user: { ...user, id: fromB64url(user.id) },
    excludeCredentials: decodeDescriptors(o.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function decodeRequest(o: Json): PublicKeyCredentialRequestOptions {
  return {
    ...o,
    challenge: fromB64url(o.challenge as string),
    allowCredentials: decodeDescriptors(o.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
}

function toJson(credential: Credential | null): Json {
  if (!(credential instanceof PublicKeyCredential)) throw new Error("No key was used.");
  // TypeScript's DOM types assume toJSON(), which older browsers lack.
  const native = (credential as unknown as { toJSON?: () => Json }).toJSON;
  if (native) return native.call(credential);
  const response = credential.response as AuthenticatorResponse & Record<string, unknown>;
  const encoded: Json = {};
  for (const field of [
    "clientDataJSON",
    "attestationObject",
    "authenticatorData",
    "signature",
    "userHandle",
  ]) {
    const value = response[field];
    if (value instanceof ArrayBuffer) encoded[field] = toB64url(value);
    else if (field === "userHandle") encoded[field] = null;
  }
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: encoded,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}
