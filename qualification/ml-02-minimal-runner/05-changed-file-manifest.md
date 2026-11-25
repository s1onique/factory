# ML-02 — Changed-file manifest

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> These are the EXACT paths staged for this ACT's commit. Nothing else
> entered the commit. No dependency tree, no disposable workspace, no raw
> session content and no credential is included.

## The changed-file manifest

| Path | Change | SHA-256 of the staged content |
| --- | --- | --- |
| `labs/model-lab/README.md` | modified | `656bac8d49c0de265528ca568cd914d135db038350e3675ff49bd77cefcb621e` |
| `labs/model-lab/ml_02_cli.mjs` | added | `f5b3b5d04f85910c688e8202140c78f9b9526096e7cfdd964a6b18f307172513` |
| `labs/model-lab/ml_02_client.mjs` | added | `3337a98bbac6a620cbcfc619b0293db6858dc61bcd8f6c71954b2b8f48975b46` |
| `labs/model-lab/ml_02_runner.mjs` | added | `c6d0fb49f6cd017b42cf1f4cad1185fdf277b98ce276e8a78530ca46ad1f125b` |
| `labs/model-lab/ml_06a_acceptance_oracle.sh` | modified | `63bfa6cf8f3118e51d1ce50722f4ad1a7ef61b1fc09b837a4b1ec8bf317c576e` |
| `labs/model-lab/ml_failclosed.mjs` | added | `41b3f4551fd9af54087f5c9f42e9c9c6d993334e320f32836446793e0c24f34d` |
| `labs/model-lab/ml_smoke_01_acceptance_oracle.sh` | modified | `29322fe78da623279b083bf70de04500c4f56de61bdfd4abe2984a4fe5a87bc5` |
| `labs/model-lab/ml_smoke_01_lib.mjs` | modified | `ac8da552c752ce41f8e17dafb8515d0a0222e04efd3832ae80b8e99cd646c185` |
| `labs/model-lab/ml_smoke_01_tool.mjs` | modified | `b427585c68d0d1c183bcc1df66a487012b02dfe2a5b1378f9dee814b6139c719` |
| `qualification/ml-02-minimal-runner/00-entry-state.md` | added | `b62fbc9a44ef7d8f932ff761d3660c1b0511a3b2eeae5307294d63b735f4912e` |
| `qualification/ml-02-minimal-runner/01-review-counterexamples.md` | added | `0ae0b0c88ef2b850266506f1f16b80ee33224d2031e661044c8a24bde8be4ba4` |
| `qualification/ml-02-minimal-runner/02-verification-log.md` | added | `51bbd8bbf17ccfcc156433dc3a04430619881b53e7685ae17c1a1f02b6cc6984` |
| `qualification/ml-02-minimal-runner/03-discipline-lab.md` | added | `5b3f9f7b4b6525005501d00fd1cc4df446a9a518f488c45713386ade2f96ef9e` |
| `qualification/ml-02-minimal-runner/05-changed-file-manifest.md` | added | (this file; the hash is recorded in the commit) |
| `qualification/reboot-corr02/07-epic-board.md` | modified | `0f99e8e620138c9097a14adc1f2e56a30ac53afceacba9fa58e6c0c189c6aaa5` |
| `qualification/reboot/08-ml02-scope.md` | modified (SUPERSEDED marker only) | `023f67012fedd29e70838591a5312e02058cc5aa5a649b564e15e064eaf47aee` |
| `scripts/verify_factory.sh` | modified | `de95992331a955fcde1b90e95cf9eef7d443f95e6962e09b04d60fb788c2511e` |
| `scripts/verify_factory_fast.sh` | modified | `eb38b47107ee700794576455f1ffa64f40602b2245e50648ef7093dfcee51f4b` |
| `tests/model_lab/test_ml_02_runner.mjs` | added | `5a2cf06705cbab7cc15c3549a2a78bda5cf9bfd1505f7727d3b678fbfd8f327d` |
| `tests/model_lab/test_ml_06a_qualification.sh` | modified | `732b504c08da03f642a4b0829e129504a80d8fd3bde9ec57f652ee806a5a3411` |
| `tests/model_lab/test_ml_smoke_01_lib.mjs` | modified | `ec659e219a93af7077558993177128b6c42bf0124337a95f11183094a27025ea` |
| `tests/model_lab/test_ml_smoke_01_oracle.sh` | modified | `34ec6e8cf191045afd7096b69f31e64beb2ad20048e1240491511f814edde758` |

## What did NOT change

- **No frozen long-horizon substrate.** `labs/long-horizon-harness/**` is
  untouched. The LH-03, LH-04, LH-05 and LH-06 frozen guards are green.
- **No historical qualification record.** `qualification/live-smoke-01*/`
  and `qualification/reboot*/` are untouched, except for the SUPERSEDED
  marker on the historical ML-02 scope proposal and the epic board's
  status line.
- **No dependency tree.** No `node_modules` directory is staged.
- **No disposable workspace.** No prepared fixture, no reference tree, no
  evaluator reconstruction and no run bundle is staged.
- **No raw session content and no credential.** The simulated seam's
  tokens are the literals `sim-read-token` and `sim-write-token`; they
  are test fixtures, not credentials. The real seam's tokens are read at
  runtime from the instance's own 0600 files and are never printed, never
  recorded and never committed.
- **No unrelated operator change.** The worktree was clean at ENTRY_HEAD,
  and every staged path belongs to this ACT.

## The new qualification identity

The oracle implementation AND the runner implementation both changed. The
previous LIVE-SMOKE-01B qualification identity does NOT apply. This ACT's
qualification identity is bound to the SHA-256 identities above.

A qualification identity may be reused ONLY when BOTH the oracle
implementation identity AND the applicable environment identity are
unchanged, and the reuse must be EXPLICIT and identity-bound.
