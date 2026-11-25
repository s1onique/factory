# REBOOT-CORR01 — Reproduced Review Findings

> Every finding below was reproduced by executing the **actual** REBOOT-01
> oracle (`labs/model-lab/d01_acceptance_oracle.sh`), not a paraphrase and
> not a reconstruction from the digest.

---

## 1. P0.1 — the mutation introduced a syntax error

### The implementation

```bash
MUTATION_ANCHOR='const tmpRoot = await fs.mkdtemp('
MUTATION_BAD='const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));'
...
fh.write(text.replace(anchor, bad, 1))
```

`replace` substitutes the **prefix** only. The original call's arguments remain
after the injected `;`.

### Reproduction against the historical fixed fixture

The historical fixed statement (`5c51615`) is on **one line**:

```text
ORIGINAL LINE: const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));
MUTATED  LINE: const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));join(tmpdir(), "factory-rec-tmp01-"));
```

The mutant is **syntactically invalid**:

```text
ERROR: Expected ";" but found ")"   (esbuild transform, cp-crash.test.ts:255)
```

### What the mutant actually did

```text
not ok 1 - test/recovery/cp-crash.test.ts
```

The file failed to **load**. REC-TMP01 never executed. The oracle nevertheless
recorded `D01_ORACLE_MUTATION_DETECTED=YES`, because its rule was "any nonzero
mutant exit OR any `not ok` line". A parser error satisfied that rule.

**Confirmed: the P0.1 mutation witness was invalid.** It never exercised the
intended behavioral defect.

## 2. P0.2 — skipped tests were counted as passed tests

Node's TAP reporter emits `ok N - <name> # SKIP <reason>` for a skipped test.
The oracle counted every line beginning with `ok ` as a pass.

### Reproduction — synthetic fixture, every test skipped

```text
# RAW TAP
ok 1 - SOCK06: skipped for reproduction # SKIP repro
ok 2 - REC-TMP01: skipped for reproduction # SKIP repro
# tests 2
# pass 0
# fail 0
# skipped 2
```

The oracle reported `GATE_PASSED=2` while TAP itself said `pass 0`.

### Reproduction — the complete false PASS

A fixture with the required test skipped plus a helper test that passes, and
a mutation whose failure came from a syntax error:

```text
D01_ORACLE_SCOPE_VIOLATIONS=0
D01_ORACLE_GATE_EXIT=0
D01_ORACLE_GATE_PASSED=3
D01_ORACLE_GATE_FAILED=0
D01_ORACLE_ACCEPTANCE=PASS
D01_ORACLE_MUTATION_DETECTED=YES
D01_ORACLE_DISPOSITION=PASS
```

**Confirmed: the REBOOT-01 oracle produced a demonstrated FALSE PASS.** This
matches the independent reviewer's synthetic counterexample exactly.

## 3. P0.3 — the task and the oracle disagreed about the defect set

The historical LH-07 D01 task prompt (from `qualification/lh07-duty-corpus.json`):

```text
"allowed_paths": ["labs/long-horizon-harness/test/recovery/cp-crash.test.ts"]
"forbidden_paths": ["labs/long-horizon-harness/src/**"]
```

It asks only for the REC-TMP01 repair and permits **one** file.

The historical fix commit `5c51615` changed **two** files:

```text
 labs/.../test/ledger-writer/ledger-writer-socket-probe.test.ts | 43 +++++---
 labs/.../test/recovery/cp-crash.test.ts                                | 15 +++++-
```

The REBOOT-01 oracle required **both** repairs and allowed **both** files
(`ALLOWED_PATHS` listed two paths, and the gate ran both test files).

**Confirmed:** a candidate that followed the historical prompt exactly could
have failed the gate for an undisclosed, independent defect. The first
experiment would have been unfair.

## 4. P1.1 — scope enforcement weaknesses (confirmed by inspection)

| Implementation | Problem | Status |
| --- | --- | --- |
| `git ls-tree` via process substitution | enumeration failure not propagated | CONFIRMED — fixed |
| missing base blob → `continue` | missing evidence silently disappears | CONFIRMED — fixed |
| `hash-object` | content identity only, no file-mode/type enforcement | PARTIALLY ADDRESSED — symlinks now rejected |
| `find . -type f` | does not enumerate added symlinks | CONFIRMED — fixed (`-type f -o -type l`) |
| `node_modules` changes ignored | candidate could alter executable dependencies | CONFIRMED — fixed (evaluator-owned, with an independent trust assertion) |
| scope checked only before the gate | no post-run scope check | ACCEPTED — the runner (ML-02) will re-check after execution |
| gate run directly in the supplied workspace | no independent reconstruction | ADDRESSED FOR THE ORACLE — the oracle now compares against an evaluator-owned prepared reference |

**One documented falsehood corrected:** the REBOOT-01 oracle's header claimed
it "never modifies the workspace", while `run_gate()` removed `.tmp-home` from
it. The corrected oracle states that it removes ambient state from the
workspace it is given.

## 5. P1.2 — the proposed commit manifest omitted the README

The REBOOT-01 exit report listed eleven files in Commit 2 and omitted
`labs/model-lab/README.md`. Confirmed: the digest contained **twenty**
untracked files (8 LH-07 + 12 REBOOT-01), and the manifest listed eleven.

## 6. Review finding that was CORRECTED: the MCP conclusion was too broad

REBOOT-01 concluded from the absence of `StreamableHTTPServerTransport` and
an empty `contributes.mcp` that "MCP is not the control transport".

The reviewer was right that this was too broad. Investigation of the ClineMM
source tree found an **existing embedded MCP control seam**:

```text
~/Projects/SPbNIX/clinemm/apps/vscode/src/sdk/control-seam/
├── control-seam-proxy-main.ts     MCP stdio server entry point
├── control-seam-proxy.ts          McpServer + StdioServerTransport
├── control-seam-client.ts         transport-agnostic NDJSON client
├── control-seam-server.ts         AF_UNIX listener
├── control-seam-protocol.ts       frozen operation registry
└── ... (12 test files)
```

with prior Factory evidence at
`~/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01/`
(`PASS_STRUCTURAL_ONLY`).

**However**, the MCP proxy is **source-only**. The installed bundle contains
the control seam itself but not the proxy:

```text
grep -c 'runControlSeamProxy' <installed>/dist/extension.js   -> 0
grep -oE 'clinemm_(capabilities|get_run|...)' <installed>/...     -> all six present
```

So the accurate statement is: **the MCP bridge exists in source and is not
shipped in the installed build; the native NDJSON control seam is what is
installed and reachable.** See `03-codium-lab-provisioning.md`.

## 7. Summary

| Finding | Reproduced | Disposition |
| --- | --- | --- |
| P0.1 invalid mutation | **YES** | FIXED — statement-level regex mutation + syntax validity check + intended-signature check |
| P0.2 skipped tests counted as passed | **YES** | FIXED — TAP classification into passed/failed/skipped/todo/cancelled + required-test identity |
| P0.3 task/oracle defect-set mismatch | **YES** | FIXED — new single-defect fixture `ML-SMOKE-01` |
| P1.1 scope weaknesses | **YES** | FIXED (enumeration propagation, symlink rejection, dependency trust) / ACCEPTED (post-run re-check belongs to ML-02) |
| P1.2 README omitted from manifest | **YES** | FIXED |
| MCP conclusion too broad | **YES** | CORRECTED — MCP bridge found in source, not in the installed build |
