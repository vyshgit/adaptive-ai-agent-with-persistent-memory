# Remember API connections on this device

RecallLoop normally drops API connections when its one-hour wallet session ends or the
server restarts. The **optional encrypted device vault** avoids entering every key again.
It is separate for each wallet and browser origin/profile. Creating the vault is optional;
once unlocked, new verified connections save encrypted by default. Credentials are never
saved in MemWal, conversations, or project backups.

## First setup

1. Sign in with your wallet on localhost or HTTPS, using a server you trust.
2. Open **Workspace settings → Advanced → Remember connections on this device**.
3. Enter and confirm a unique passphrase of **12–256 characters**, explicitly select
   **I want encrypted credentials saved on this device**, then **Create encrypted vault**.
   Prefer a long, randomly generated passphrase. The minimum length is not a strength guarantee.
4. In **Model**, **Tatum**, or **Walrus Memory**, enter the normal connection details.
   **Save this connection in device vault** is selected by default while unlocked; uncheck
   it for a session-only connection. A locked or absent vault cannot save credentials.
5. Only a successfully verified connection is encrypted and saved. A failed verification
   leaves an existing saved copy unchanged. If saving fails after verification, the server
   connection can still be active. The key stays in the form for a deliberate retry.

Creation is local, saves an **empty** vault, and makes no API verification requests. It cannot
recover keys already cleared from a form or fetch existing server keys. Re-enter those keys
once with the save checkbox selected if you want encrypted copies.

Unsubmitted API fields and in-flight checks survive Settings section changes and browser-tab
switches while the modal remains open. Failed or cancelled connection attempts retain their
keys and selected catalogue model for retry; successful connections clear only their submitted
credential fields. Closing Settings cancels checks and disposes secret form drafts while
preserving a completed vault unlock. Non-secret setup preferences survive same-login reloads.

### Multiple provider profiles

Use **Model → Add provider** to keep multiple providers or accounts connected at once. Give
them distinct names under **Advanced connection options**. Up to **12 model profiles** can
be encrypted in one vault, alongside Tatum and Walrus. Profile identity binds each model to
its own credential even when two profiles advertise the same model ID.

The unlocked vault lists **Saved provider profiles**, with individual **Reconnect** and
**Forget** actions. Forgetting one saved profile leaves its current server connection active.
Older single-model vaults unlock as a legacy profile and migrate to the multi-profile format
on the next successful encrypted save; unlock alone does not rewrite storage.

## Returning after a restart or new login

1. Sign in with the **same wallet** in the **same browser profile and site origin**.
2. Choose **Unlock saved connections**, or open Advanced settings and **Unlock device vault**.
3. Enter the vault passphrase. Unlocking is local: it does not reconnect, contact a provider,
   enable memory capture, or write memories. The panel shows connection names, never saved keys.
4. Choose **Reconnect saved connections** when ready. This explicitly reuses the normal
   verification routes, in order: **all saved model profiles → Tatum → Walrus**. Or reconnect
   just one saved model profile with its own button. Verification can consume API/delegate quota
   and replace current connections after successful verification. Streaming/tool capability
   probes are not repeated. Independent failures are reported without retries; Walrus is
   skipped when Tatum is unavailable or its reconnection failed.
5. Inspect the resulting status. Saved credentials may have expired or been revoked, and
   Walrus still requires an account owned by the signed-in wallet and an authorized delegate.
   Encrypted storage is not authorization and does not weaken per-user isolation.

Another device/profile/origin has no copy of this vault. Connect manually there; the same
verified Walrus account can still provide portable memory. The device vault does not export
keys to Claude Code/Codex or configure their delegates; see [cross-tool setup](MEMORY_PORTABILITY.md).

## Locking, disconnecting, and forgetting are different

| Action | Effect |
| --- | --- |
| Switch browser tabs or close Settings after unlocking | Keeps this page's completed unlock and wallet/API connections. Closing Settings cancels pending checks/cryptography and disposes secret form drafts. |
| **Lock device vault**, reload, or leave the page | Drops the vault's unlocked key/connection references and cancels its pending work. Ciphertext remains. Current verified server connections are unchanged. Another page needs its own passphrase unlock. |
| Logout, login expiry, or account change | Locks/disposes the old wallet's vault; clears its server connections and revokes its tab chat/project cache. Encrypted saved copies remain wallet-specific. |
| Normal model/Tatum/Walrus disconnect | Removes the selected server connection (Tatum also removes dependent Walrus authorization), not saved vault copies. |
| **Forget** beside one saved provider profile | Re-encrypts the vault without that model profile. Other saved profiles and active server connections remain. |
| **Forget saved connections → Confirm forget saved connections** | Locks and deletes only the current wallet's encrypted copy on this site/profile. Other wallets, current server connections, chats/files, and remote memories are unchanged. |
| **Clear legacy browser caches** | Deletes obsolete plaintext chat/project caches after confirmation, not encrypted vaults or current tab work. |

Forgotten passphrases **cannot be recovered or reset to decrypt an old vault**. Forget the
saved copy, create a new vault, and enter your own keys again. Clearing site data also removes
the ciphertext. Browser backups can retain older copies; forgetting is not secure physical
erasure. Neither forgetting nor logout revokes an onchain delegate or deletes remote memory.

Storage failures are reported, with **no plaintext fallback**. If removal is blocked, the
vault still locks; clear this site's browser data yourself before sharing the device.

## Encryption and remaining trust

`src/agent/deviceVault.ts` uses native WebCrypto: **AES-GCM-256**, a fresh random **12-byte IV**
and 128-bit authentication tag per write, and **PBKDF2-SHA256 with 600,000 iterations** and a
random **32-byte salt** to derive a non-extractable wrapping key. Wallet identity, origin, and
format version are authenticated metadata, not the encryption key. Bounded versioned schemas,
tamper checks, lifecycle guards, and stale-copy checks fail closed; cross-tab changes lock
unlocked copies rather than silently reusing replaced credentials.

Only ciphertext plus public format/wallet/KDF metadata is stored under
`recallloop.device-vault.v1:<wallet-identity>` in `localStorage`. The passphrase and wrapping
key are never persisted or sent to the server. The payload is limited to model profiles/settings/keys,
Tatum key, and Walrus account ID/dedicated delegate key. Wallet private keys, seed phrases,
operator/agent/admin tokens, embedding keys, chats, and memory text do not belong in it.

This is **not an audited password manager** or protection from a compromised application,
server, extension, or browser profile. A stolen ciphertext can be attacked offline; a weak
or reused passphrase is unsafe. An unlocked page can access plaintext credentials, and explicit
reconnection sends them to the trusted server just like manual setup. Locking does not remove
already submitted server credentials or temporary request/redaction buffers. JavaScript
string/physical-memory erasure is not guaranteed. Use separate OS/browser profiles on shared
devices and dedicated, revocable API/delegate credentials.

The [vault unit tests](../tests/agent-device-vault.test.mjs) and
[Chromium scenarios](../browser/device-vault.pw.mjs) cover real cryptography, vault-creation consent,
default encrypted saving, round trips, wrong passphrases, wallet/origin isolation, cancellation, cross-tab forgetting,
and blocked storage. Connection fixtures are **offline wiring evidence**, not live API or
Mainnet validation. See [validation](VALIDATION.md) and [memory privacy](MEMORY_PRIVACY.md).
