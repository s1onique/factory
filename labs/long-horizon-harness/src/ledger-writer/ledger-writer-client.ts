/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter client (public API).
 *
 * Thin facade that re-exports the public surface from the
 * three implementation modules:
 *
 *   ledger-writer-client-transport.ts   framed request/response
 *   ledger-writer-client-append.ts      append + single-RPC
 *                                       replay + writer_busy
 *                                       retry loop
 *   ledger-writer-client-identity.ts    ping + who_are_you
 *
 * This split keeps each production file under the 400-LOC
 * source-size discipline (FOUNDATION03 §29) and the
 * transport/append/identity concerns cleanly separated.
 */

export {
  type LedgerWriterClientError,
  type LedgerWriterClientOptions,
  type LedgerWriterClientResult,
  sendLedgerWriterRequest,
} from "./ledger-writer-client-transport.js";

export {
  appendToLedgerWriter,
  type LedgerWriterAppendError,
  type LedgerWriterAppendResult,
} from "./ledger-writer-client-append.js";

export {
  pingLedgerWriter,
  whoAreYouLedgerWriter,
  type PingClientResult,
  type WhoAreYouClientResult,
} from "./ledger-writer-client-identity.js";
