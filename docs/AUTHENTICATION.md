# Authentication and credential boundaries

RecallLoop has **three independent authorization layers**. None substitutes for another:

| Layer | Applies to | Proves / grants |
| --- | --- | --- |
| Workspace origin policy | All `/api/agent/*` | Access to this app origin/deployment, not a user identity. |
| Signed Sui wallet session | Protected workspace routes | Possession of a wallet signing key, not authorization for MemWal or spending. |
| Agent/admin bearer keys | `/api/memory/*`, `/api/walrus/*` | External logical-agent scope or legacy/operator controls, not wallet login. |

None of the identity/deployment layers above authorizes
execution, reconnects a model, or approves a memory write on its own.

## Wallet login

1. The client requests a challenge for its canonical Sui address at `/auth/challenge`.
2. The server creates a random nonce, a five-minute challenge cookie, and a message binding
   the **origin, app URI, address, Mainnet intent, issue time, and expiry**. No transaction
   is requested. The UI checks origin/address before asking the wallet to sign.
3. The wallet signs the exact bytes using `sui:signPersonalMessage`.
4. `/auth/verify` consumes the challenge **before** verification, verifies locally, and
   rotates the cookie into a fresh one-hour session. Replay, wrong origin/address, failed
   verification, expired proofs, or logout during verification cannot resurrect a session.

The server accepts locally verified Ed25519, Secp256k1, Secp256r1, passkey, and ML-DSA
personal-message schemes supported by the installed Sui SDK. Automated cryptographic tests
cover the first three. **zkLogin and multisig are excluded**; no login proof is silently sent
to an RPC for verification. Real extension/passkey/ML-DSA compatibility needs live checks.

The `recallloop_wallet` cookie is random, httpOnly, SameSite=Strict, and scoped to
`/api/agent`; Secure is set for trusted HTTPS origins. Sessions are in-process, non-sliding,
and last at most one hour. A server restart requires a new sign-in and API reconnection;
the optional device vault can supply explicitly saved keys after local unlock.
Logout/expiry abort attached requests, destroy clients, and clear credential references.
This is not a claim of cryptographically erasing immutable strings from physical memory.

The UI distinguishes **Connecting wallet**, **Requesting sign-in challenge**, personal-message
signing, and ownership verification. The wallet dialog shows address/network/expiry and
actionable disconnect errors. It waits for server logout before optionally removing wallet
extension permission; an extension refusal cannot revive that server session. Retired
Wallet Standard callbacks are bound to their original session and ignored after it changes.

### Stable identity and stale tabs

`walletAgentId(address)` uses the canonical address to derive a stable, hashed namespace
identity. Reconnecting the same wallet/account can recall the same remote memory across
new sessions/devices; a different wallet must connect a separately owned account and gets
different browser caches and namespaces. Every wallet/demo memory service is principal-bound;
ingest, recall, inventory, remembering, seed, and restore reject a borrowed identity before SDK access.
The namespace ID is **not** the delegate public key requested by the submission form.

Every protected workspace call sends `X-RecallLoop-Session` with the public `sessionTag`
returned from `/auth/session`. Cookies are shared by tabs, so this binding prevents an old
tab from submitting its project under a new wallet's cookie or logging out/replacing that
new session. A mismatch returns `409 session_changed`. Refresh identity and discard old
draft context before making new requests. The UI revokes old cache leases before remounting.
Cross-tab `BroadcastChannel` notifications clear stale work even if a subsequent session
check fails; focus/API/expiry checks remain the fallback when that API is unavailable.

`sessionTag` is not a standalone bearer credential; the cookie is also required. Conversation
and browser-project edits use **wallet + login-tagged `sessionStorage`**, not persistent `localStorage`.
The same valid login can reload its tab work. Logout revokes its cache lease before teardown;
expired/changed login checks prune inactive leases, and late autosaves/exit callbacks cannot
recreate revoked caches. New logins do not restore old conversation/project caches.

Old persistent caches are neither loaded nor migrated. The sign-in screen and Advanced
settings offer an explicit, confirmed cleanup of old RecallLoop chat/project entries for all
wallets on this site; theme/unrelated settings are retained. Browser caches are unencrypted
conveniences, not authorization against a person inspecting an active browser profile.
Use separate browser/OS profiles on shared devices and export needed work before logout.
Logout does not delete remote Walrus memories or revoke the onchain delegate.

User credential connections use targeted verification and disconnect controls; disconnect
never deletes remote memories.

### Explicit offline demo

`/auth/demo` is available only when `RECALLLOOP_ENABLE_DEMO=true` or both explicit mock
environment modes are configured. `npm run dev:demo` enables this mock path. Each demo
login has a random, one-hour scope, its own scripted model and in-process memories, and
cannot connect live credentials. Leaving/expiring the demo destroys its mock memory.
A demo cookie is **not** a wallet-authenticated session or Mainnet evidence.

## User credential connections

Wallet workspaces inherit **operator policy only**. They never fall back to environment
Tatum, MemWal, model, external-agent, or admin credentials—even after a failed connection,
disconnect, demo selection, session change, or expiry.

Enter credentials only on localhost or HTTPS on a trusted server:

1. **Tatum:** verify the user's Mainnet key with a bounded Sui checkpoint read. Wallet
   connections use the fixed `sui-mainnet.gateway.tatum.io/graphql` host and explicit key,
   never the operator's `TATUM_API_BASE` or a missing-key fallback.
2. **MemWal:** after Tatum is connected, verify the official deployment and account ID,
   Shared Sui account object's official `::account::MemWalAccount` type and JSON `owner`,
   signed-in wallet, relayer health/write readiness, and SDK-signed delegate namespace
   access. Dedicated delegate private keys only: no seed phrase, and the signed-in wallet's
   own Ed25519 key is rejected. The user must intentionally supply the revocable delegate;
    wallet login alone does not grant access to memory. A delegate's authority is account-wide;
    namespaces are **not permissions**. Different users must not share an account/delegate.
3. **Model:** validate the provider URL/key/model, attempt bounded discovery, and stage the
   key until an actual small non-streamed coding response succeeds. Public connection state
   contains no key. Discovery readiness does not prove generation/tool support. Optional
   streaming/non-executing function probes are separate, user-initiated checks. A failed
   replacement preserves the saved connection; failed re-verification retains its key but
   clears the verified indicator. No AgentRouter client impersonation is implemented.

Connections are staged: an upstream result is committed only while the originating session
remains active. Late verification cannot reinstall a logged-out user's connection. Replaced
or uncommitted clients/keys are cleared. Disconnecting Tatum also removes its dependent
MemWal connection. Model disconnect has no owner-credential fallback.
Late inventory/status/chain responses recheck the session before returning metadata, and
disposed memory operations cannot return private results or repopulate local caches.

Key fields use temporary React/tab state. Successful connections clear only the submitted
credentials; failed or cancelled checks retain them for retry. Browser-tab switches preserve
drafts and in-flight checks, while closing Settings disposes secret drafts. A tab-memory
buffer remembers submitted keys for best-effort redaction
until the wallet session changes. The server keeps keys in that session's memory until
logout/expiry/restart, and response-time
redaction retains request-time snapshots to handle logout races. Plaintext keys are not
persisted in `localStorage`, `sessionStorage`, exports, prompts, or Walrus. After optional
vault setup/unlock, verified connections save encrypted by default with a per-connection
opt-out in the separate wallet-specific device vault. No `VITE_*`
secret or public frontend environment key is used. This does not detect every unrelated
secret: never place secrets in chat, selected files, or a taught memory.

Provider calls, blockchain reads, and MemWal SDK operations happen **server-side**. The
browser calls only the same-origin workspace API. A trusted server necessarily sees the
submitted provider/delegate keys; wallet login does not make it trustless.

### Optional encrypted device vault

Wallet users may explicitly create an empty device vault in Advanced settings, using a
confirmed 12–256-character passphrase and consent checkbox. Saving verified connections is
then selected by default while unlocked, with a per-connection opt-out. Up to 12 model
profiles keep account credentials separate even when model IDs overlap.
The passphrase stays local; it is not a wallet signature, server secret, or recoverable password.

Native WebCrypto derives a non-extractable AES-GCM-256 key with PBKDF2-SHA256 (600,000
iterations, random 32-byte salt). Each write uses a fresh 12-byte IV, 128-bit tag, and
wallet/origin/version authenticated metadata. Bounded schemas reject unsupported or tampered
records. Only encrypted connection payloads and public envelope metadata enter `localStorage`;
operator/agent/admin/embedding secrets, wallet keys, chats, and memories are excluded.

Explicit lock, page exit/reload, expiry and logout lock the vault; a new login starts locked.
Tab switches and Settings closure preserve completed unlocks. Closing cancels unfinished
checks/cryptography and disposes secret form drafts; each page has its own unlock.
Local unlock makes no API calls. **Reconnect saved connections** separately reruns normal
verification in the originating wallet/login, with Tatum required for Walrus. Stale work
cannot continue after lock, teardown, cancellation, or a detected cross-tab replacement.
Forgetting a saved copy locks/deletes only that wallet's local ciphertext, not active server
connections, remote memories, or onchain delegates. A lost passphrase requires forgetting
the copy and entering credentials again; there is no recovery, device sync, or plaintext fallback.

Encryption protects a locked saved copy, not a compromised application, weak passphrase,
active browser/profile, or trusted server that receives reconnected keys. Temporary redaction
buffers and in-flight requests can retain submitted keys after vault lock; JavaScript physical
memory erasure is not guaranteed. This feature is not an audited password manager. See
[device-vault usage and limits](DEVICE_VAULT.md).

### Memory consent and cross-tool handoff

Hosted chat and local prompts default to facts-only Auto-memory after successful completion;
`capture: false` disables it. Only eligible current-user prose is analyzed, excluding history,
files, assistant claims and tool/terminal output. Local filters skip obvious code/logs/quotes,
filler, recognized-secret lines and explicit privacy requests. Raw chat requires explicit
`capture: true` with `captureMode: "both"` or `"verbatim"`. The browser never inherits an
operator's raw setting; disabling Auto-memory or reloading clears raw consent. Auto-memory's
disable choice is login-scoped. The model's `remember` tool is always disabled; capture off
does not disable hosted recall or independent teaching/outcome writes.

`GET /memory/handoff` requires an active, owner-verified official Mainnet wallet connection
and accepts no query overrides. It exports account/setup metadata and existing `profile`/
`facts` namespaces only. It contains no keys, session credentials, memory text, chat, or exact
raw namespace and grants no access. The other trusted tool needs its own authorized delegate
on the same account and its own save consent. See [portability](MEMORY_PORTABILITY.md).

Walrus blobs are encrypted at rest; the relayer processes plaintext for embedding/encryption
and the model receives recalled context. The legacy publisher is plaintext storage, not
private wallet memory. See [privacy boundaries](MEMORY_PRIVACY.md).

Assistant Markdown is untrusted display content. Raw HTML is ignored, remote images are
not loaded, and links are limited to explicit credential-free HTTP(S) URLs. Formatting never
executes code or approves an action. Conversation browser edits remain separate. See [client formatting](API.md#client-response-formatting).

## Origin and deployment policy

The default server binds `127.0.0.1:3000`. Development accepts local
loopback requests, but still rejects cross-origin/fetch-site requests and DNS-rebinding
Hosts. Protected routes still require signed wallet or explicit demo identity.

For an HTTPS remote deployment:

- Build the UI and run `npm start`; bind externally only when intentionally deploying.
- Set `RECALLLOOP_ALLOWED_ORIGINS` to the exact public origin, for example
  `https://recallloop.example`. Origins must still match the request Host. Preserve Host at
  the reverse proxy; an allowlist entry is not a grant of arbitrary cross-origin access.
- Use a trusted HTTPS reverse proxy. Explicit HTTPS origin policy allows secure cookies
  without blindly trusting forwarded headers. Do not expose development/Vite serving.
- Disable `RECALLLOOP_ENABLE_DEMO` for a live-only deployment. Configure independent
  external-agent/admin keys or restrict their routes at the proxy.
- Allow only trusted model hosts. Additional `AGENT_LLM_ALLOWED_HOSTS` and production
  loopback access are operator trust grants, not user-controlled arbitrary network access.

All workspace responses are marked no-store. Login is bounded to 12 challenge/demo attempts
per socket peer per minute, 100 concurrent challenge/wallet/demo sessions, and 1,000 tracked
peers. Protected requests, chat/connection operations, mock storage, and pending writes are
also bounded; see [API limits](API.md#bounded-tools-and-concurrency).

This remains a **single-process prototype**: no distributed sessions/limiter, durable server
secret store, encrypted chat/project cache, teams, tenant billing, or full security audit.
The opt-in credential vault is browser-local, not a server storage replacement. Behind a
proxy, sign-in peers may collapse into the proxy address; plan edge abuse controls rather
than treating these in-process bounds as production capacity guarantees. The preview
provides no durable runtime server storage; no database or new disk index is introduced.

## External agent bearer keys

Configure a JSON map of logical agent IDs to high-entropy secrets of at least 32 characters:

```sh
export RECALLLOOP_API_KEYS='{"support-agent-prod":"REPLACE_WITH_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS"}'
```

These protect `/api/memory/ingest`, `/recall`, `/inventory`, `/restore`, plus legacy
`/api/walrus/store` and `/recall`. Send `Authorization: Bearer <key>`. The body `agentId`
(query `agentId` for GET inventory) must exactly match the key's configured identity.
Namespace sanitization includes a hash when needed so different logical identities do not
collapse into the same namespace.

```sh
curl -X POST http://127.0.0.1:3000/api/memory/recall \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer REPLACE_WITH_YOUR_AGENT_KEY' \
  -d '{"agentId":"support-agent-prod","query":"provider timeout"}'
```

These routes use the operator's `.env`/deployment memory configuration, not a wallet's
browser connections. Missing key configuration fails closed with HTTP 503 in **all modes**,
including local development. Each logical agent needs a **different** 32–4096-character
printable ASCII key without whitespace. Empty/malformed maps, duplicate keys, oversized
configuration, noncanonical IDs, and reserved wallet/demo/dashboard namespace identities
are rejected. Routes derive the effective identity from authentication, not caller-selected
namespaces or accounts. Key configuration is read per request for operator-managed
rotation; no persistent revocation/audit or distributed key store is provided.

## Admin and legacy console keys

Set a separate random 32+ character `RECALLLOOP_ADMIN_API_KEY` for `/api/memory/status` and
`/seed`, and legacy `/api/walrus/state`, `/blob/:blobId`, `/task/outcome`, `/plan/generate`,
and `/slice/run`. Send it from a trusted server-side client, never hard-code it in browser
JavaScript. Missing admin configuration fails closed with HTTP 503 in **development and
production**; keys must contain 32–4096 printable ASCII characters without whitespace.
Use a different secret from every agent/provider/workspace key.

The legacy browser console has **no wallet-backed admin login**. To operate it remotely,
use a trusted authenticated proxy that injects the admin key server-side. External `/store`
and `/recall` require a separately configured logical-agent key; such a key cannot authorize
the reserved dashboard scope. Dashboard outcome controls remain admin-only. Its records and
Testnet-default/file-backed retrieval are separate from wallet memory and are not Mainnet
evidence. The new wallet login must not be described as protecting these legacy routes.

Never commit `.env`/`.env.local`, delegate keys, wallet keys, or bearer secrets. Generate
random credentials with a cryptographically secure generator and store them through your
deployment's secret mechanism, not in source. For testing, share only sanitized error codes
and public account/blob IDs—not request headers, cookies, private keys, or seed phrases.
