# FOUNDATION04 — Authority Mechanisms

## The Central Question

> After the original supervisor process dies, how can a new
> supervisor prove that it is talking to the **same execution
> authority** that originally spawned the candidate, and safely
> request control actions without trusting a recycled numeric
> PID/PGID?

The answer FOUNDATION04 selects is: **a persistent authenticated
witness process**.

## Mechanism Comparison

| Mechanism | restart-safe identity | restart-safe authority | Darwin | Linux | PID reuse safe | decision |
|---|---|---|---|---|---|---|
| numeric PID | ❌ recycles | ❌ no | ✅ | ✅ | ❌ | rejected |
| PID + start_time | ❌ bootstraps | ❌ no | ✅ | ✅ | ⚠ partial | corroborating only |
| Linux pidfd | ⚠ per-fd lifetime | ❌ fd dies | ❌ | ✅ | ✅ (one fd) | rejected (Darwin) |
| persistent witness | ✅ key-bound | ✅ control plane | ✅ | ✅ | ✅ | **selected** |

## Why PID/PGID is not authority

PID and PGID are 32-bit integers recycled by the kernel. A
restarted supervisor that remembers `PID 12345` cannot prove the
process it sees today is the same one. POSIX process-start identity
(`/proc/<pid>/stat` start_time) gives a corroborating signal but
does not survive supervisor restart either, and still leaves a
check-then-signal race.

## Why pidfd alone does not survive supervisor death

A pidfd is a reference to one Linux process held by one
descriptor in one supervisor. When the supervisor dies, the fd
disappears. A witness process internalising pidfds does close the
race but only within one witness lifetime. The supervisor must
already have authenticated that witness (via persistent state) to
trust the pidfd reference inside it.

## Why persistent witness is the portable baseline

A witness process that:

1. holds the live `ChildProcess` handle and PGID authority
2. has a fresh Ed25519 keypair
3. persists the **public** key + binding to the run's
   `events.jsonl`
4. exposes a Unix-domain control socket requiring signed commands

is the only portable, restart-safe authority carrier that works
on both Darwin and Linux without kernel-specific dependencies.

## Restart sequence

```
Supervisor S1
   │
   │ boots witness; witness binds UDS; signs witness_ready
   ▼
Witness W
   │
   │ owns
   ▼
Candidate C (PGID X)
```

```
Supervisor S2 (restarted)
   │
   │ reads witness_ready from events.jsonl → (public_key, binding)
   │ dials W via UDS
   │ HELLO + signed nonce
   ▼
Witness W
   │
   │ signs canonical (witness_state, client_nonce, ...)
   ▼
Supervisor S2
   │
   │ verifies signature with persisted public_key
   │ sends signed CANCEL/TERMINATE/QUERY
   ▼
Witness W  →  performs termination engine against PGID X
```

## Critical security statement

> The witness public key proves witness instance identity.
> It does NOT prove: code integrity, host integrity, root trust,
> same-UID attacker exclusion.

The witness is a real, separate Node process. It must be assumed
that a same-UID attacker with `kill(2)` access to the witness can
also kill the witness (kernel boundary). The witness private key
is memory-only and never persisted. The witness is bound to a
specific (run, mission, attempt, process) tuple at bootstrap and
cannot be reused across runs.

## Documentation scope

The full architecture, bootstrap sequence, and acceptance
matrices live in `FOUNDATION04-AUTHORITY-MECHANISMS.md` (this
file) and the main `README.md`.

The detailed protocol surface is split across:

- `witness-types.ts` — typed state, authority, and command ADTs
- `witness-protocol.ts` — wire-format message types
- `witness-codec-*.ts` — canonical signing payload, framing, decoders
- `witness-crypto.ts` — narrow crypto adapter (Ed25519)
- `witness-key-store.ts` — 0600 durable key-file primitive
- `witness-server.ts` — Unix-domain stream socket server
- `witness-client.ts` — Unix-domain stream socket client
- `witness-runtime.ts` — witness process entry
- `witness-runtime-handlers.ts` — per-frame message handlers
- `witness-runtime-sm.ts` — pure state machine
- `witness-projector.ts` — pure projector for evidence replay
- `witness-ledger.ts` — witness_evidence envelope appender

## Comparative lab: pidfd (Linux-only)

The TypeScript lab does not require pidfd. On Linux, the witness
process MAY internally use pidfd_send_signal as a follow-up to
the F02 termination engine; this is an implementation detail of
the witness, not a foundation requirement.

`PIDFD_CAPABILITY`:

- Linux: AVAILABLE
- Darwin: NOT_PLATFORM

There is no `pidfd` requirement in the foundation contract. Any
pidfd use lives inside the witness process; the supervisor does
not see a `pidfd` API.
