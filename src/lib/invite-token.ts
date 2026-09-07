// Bearer-secret minting and digesting — the single place the app and the database agree on
// how a caretaker's credentials are encoded. Two of them now live here: the invite token
// (which period is this?) and the claim capability secret (which caretaker are you?).
//
// The raw token exists exactly once: it is generated here, its digest is stored, and it is
// returned to the owner on the create/regenerate response. It is never written to the
// database and must never be logged — the same handler that would leak a DB error would
// leak this (S-01 impl-review F2).
//
// Both functions use Web Crypto only, so they run unchanged on the Workers runtime and need
// no Postgres extension on the other side.

const TOKEN_BYTES = 32;

// 32 bytes of CSPRNG entropy, base64url-encoded (URL-safe alphabet, no padding) so the value
// can sit in a path segment untouched. 256 bits is what makes the link unguessable, which is
// the whole access model — see docs/reference/data-access.md.
export function generateInviteToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// Hex SHA-256 of the UTF-8 bytes of the token — byte-for-byte what
// `encode(sha256(convert_to(token, 'UTF8')), 'hex')` produces in Postgres, so a digest
// written by the app resolves against one computed inside get_period_by_token.
export async function digestInviteToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// The caretaker's capability secret (S-03) is the SAME primitive as the invite token: 32
// bytes of CSPRNG entropy, base64url, stored only as its hex SHA-256, returned to the holder
// exactly once — into an HttpOnly cookie rather than onto a page. It is deliberately an alias
// and not a second implementation: the two values are compared against digests computed by
// the same `encode(sha256(convert_to(x, 'UTF8')), 'hex')` expression in Postgres, so any
// drift between them would be a silent never-matches bug rather than a failure.
//
// They get their own names anyway, because the call sites are about entirely different
// things and `digestInviteToken(secret)` at the claim route would read as a mistake.

export function generateClaimSecret(): string {
  return generateInviteToken();
}

export function digestClaimSecret(secret: string): Promise<string> {
  return digestInviteToken(secret);
}
