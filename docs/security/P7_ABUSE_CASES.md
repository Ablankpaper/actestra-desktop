# P7.1 Abuse-Case Ledger

**Status:** P7.1 local abuse baseline verified; all 28 catalog cases and 168
exact variants are `denied-safe` on macOS. Packaged Layer 4 physically
exercises the seven required cases `P7-A-RENDERER-002`, `P7-A-CREDENTIAL-001`,
`P7-A-CREDENTIAL-003`, `P7-A-WORKER-001`, `P7-A-NETWORK-001`,
`P7-A-PROCESS-002`, and `P7-A-ARTIFACT-001`; Windows/Linux remain P8
obligations.
**Date:** 2026-08-15
**Scope:** P7.1 security and abuse-case baseline

This ledger is the human-readable companion to the machine catalog planned in
`tests/security/abuseCaseCatalog.ts`. IDs, invariants, risk, expected boundary,
forbidden effects, and platform obligations are stable review fields. Existing
tests may satisfy a row only when the catalog binds the exact test name and the
test proves both rejection and the listed no-side-effect evidence.

The disposition below records the executable local evidence. The packaged
security hook independently exercises the seven Layer-4 rows named above; it
does not turn the other local rows into packaged or cross-platform claims.

## Result vocabulary

- `denied-safe`: rejected at the declared boundary with required bounded,
  redacted evidence and no forbidden effect;
- `unsupported-platform`: not enforceable or verifiable on that platform;
- `security-boundary-violated`: protected authority, data, approval, or state
  was bypassed;
- `cleanup-incomplete`: a privileged process, lease, lock, private root, or
  worktree remained;
- `evidence-incomplete`: rejection or no-side-effect proof is not complete; and
- `test-harness-invalid`: the fixture or precondition is not faithful.

Only `denied-safe` is a pass. The `macOS` column records the required P7.1
layer, not a claim that the layer has passed. Windows/Linux obligations remain
P8 work and are not included in the P7.1 success count.

## Attack ledger

| ID | Invariant | Risk | Layer | Expected boundary | Forbidden effects | macOS | Windows/Linux P8 obligation | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `P7-A-RENDERER-001` | `P7-I-RENDERER-001` | critical | 1 | Static Renderer/preload authority scan rejects privileged imports and escape APIs. | shell, filesystem, Git, process, persistence, credential projection | Required: Layer 1 | Re-run the same source and packaged boundary checks on Windows and Linux. | `denied-safe` |
| `P7-A-RENDERER-002` | `P7-I-RENDERER-001` | critical | 1 | Static and packaged session policy rejects direct external network clients from Renderer. | external-network, credential-read, Main-bypass | Required: Layers 1 and 4 | Verify packaged request cancellation and route policy on Windows and Linux. | `denied-safe` |
| `P7-A-IPC-001` | `P7-I-IPC-001` | high | 2 | `desktopIpc` rejects undeclared channels, stale/non-main frames, wrong senders, and disposed requests before effects. | executor-call, persistence-write, provider-request, credential-projection | Required: Layer 2 | Exercise equivalent current-frame and disposal checks in each platform shell. | `denied-safe` |
| `P7-A-IPC-002` | `P7-I-IPC-001` | high | 2 | Exact IPC normalizers reject unknown keys, prototypes, unexpected arguments, and oversized payloads. | executor-call, filesystem, persistence, audit-content | Required: Layer 2 | Confirm structured-clone and IPC payload limits on Windows and Linux. | `denied-safe` |
| `P7-A-CREDENTIAL-001` | `P7-I-CREDENTIAL-001` | critical | 2 | Main redacts provider data and disables cache persistence before Renderer projection. | credential-projection, renderer-cache, diagnostic-leak | Required: Layers 2 and 4 | Verify equivalent Main-owned redaction and cache behavior in Windows/Linux packages. | `denied-safe` |
| `P7-A-CREDENTIAL-002` | `P7-I-CREDENTIAL-001` | critical | 2 | Sentinel writes, cross-provider substitution, missing keys, and anonymous fallback fail closed. | credential-write, wrong-provider-request, raw-secret-use | Required: Layer 2 | Verify keychain/provider adapter behavior and fail-closed fetch on Windows/Linux. | `denied-safe` |
| `P7-A-CREDENTIAL-003` | `P7-I-CREDENTIAL-001` | critical | 2 | Credential-shaped values are absent from Renderer, logs, persistence, Worker environment, and diagnostics. | credential-leak, environment-secret, persistence-secret | Required: Layers 2 and 4 | Repeat environment, logging, and package evidence on Windows/Linux. | `denied-safe` |
| `P7-A-WORKSPACE-001` | `P7-I-WORKSPACE-001` | critical | 2 | Grant and canonical-root validators reject traversal, absolute paths, NULs, symlinks, and external scope. | workspace-read, workspace-write, Git-effect | Required: Layer 2 | Validate path and symlink semantics on NTFS and Linux filesystems. | `denied-safe` |
| `P7-A-WORKSPACE-002` | `P7-I-WORKSPACE-001` | high | 2 | Replaced `.git`, wrong root, subdirectory, linked worktree, and revoked grant fail closed. | wrong-repository, scope-substitution, source-write | Required: Layer 2 | Verify canonical Git binding and grant revocation on Windows/Linux. | `denied-safe` |
| `P7-A-WORKSPACE-003` | `P7-I-WORKSPACE-001` | high | 2 | Hooks, filters, includes, fsmonitor, dirty state, and HEAD drift cannot redirect an effect. | arbitrary-command, source-write, unreviewed-diff | Required: Layer 2 | Exercise Git config and process behavior on Windows/Linux. | `denied-safe` |
| `P7-A-DELIVERY-001` | `P7-I-DELIVERY-001` | critical | 2 | Isolated patch delivery requires exact digest, grant, dry-run, second approval, and post-approval revalidation. | source-write, multi-file-effect, approval-bypass | Required: Layer 2 | Verify patch apply, lock, and atomic denial semantics on Windows/Linux. | `denied-safe` |
| `P7-A-DELIVERY-002` | `P7-I-DELIVERY-001` | high | 2 | Concurrent, already-applied, lost-response, lock-held, and retry paths are serialized and idempotent. | duplicate-effect, repeated-authorization, lock-residue | Required: Layer 2 | Implement and accept equivalent repository locking and retry behavior. | `denied-safe` |
| `P7-A-TOOL-001` | `P7-I-TOOL-001` | high | 2 | ToolGateway requires an admitted manifest and one unambiguous matching policy before execution. | executor-call, widened-capability, unauthorized-audit | Required: Layer 2 | Verify manifest/policy evaluation in each platform package. | `denied-safe` |
| `P7-A-TOOL-002` | `P7-I-TOOL-001` | high | 2 | Invalid credential references, stale authorization, executor mismatch, and uncertain retries fail closed. | raw-credential-use, duplicate-effect, executor-bypass | Required: Layers 2 and 3 | Verify platform adapter and post-effect uncertainty handling on Windows/Linux. | `denied-safe` |
| `P7-A-APPROVAL-001` | `P7-I-APPROVAL-001` | high | 2 | Denied, expired, cancelled, reused, wrong-operation, wrong-attempt, and stale approvals cannot execute. | protected-effect, approval-replay, persistence-write | Required: Layer 2 | Repeat durable approval and CAS behavior on Windows/Linux. | `denied-safe` |
| `P7-A-APPROVAL-002` | `P7-I-APPROVAL-001` | high | 2 | Protected, feedback, publish, and workspace-apply approvals remain distinct. | approval-substitution, source-write, workflow-transition | Required: Layer 2 | Verify operation-purpose binding in Windows/Linux UI and Main paths. | `denied-safe` |
| `P7-A-MCP-001` | `P7-I-MCP-001` | high | 3 | Loopback lease and protocol validators reject wrong peer identity, headers, method, content type, model, or order. | unauthorized-loopback, model-request, tool-call | Required: Layer 3 | Exercise equivalent local transport and peer checks on Windows/Linux. | `denied-safe` |
| `P7-A-MCP-002` | `P7-I-MCP-001` | high | 3 | MCP/HTTP/SSE bounds reject malformed, oversized, duplicate, after-close, and in-flight-close frames. | parser-overflow, duplicate-effect, post-close-effect | Required: Layer 3 | Verify transport bounds and close races on Windows/Linux. | `denied-safe` |
| `P7-A-MCP-003` | `P7-I-MCP-001` | high | 3 | Undeclared tools, ambiguous aliases, invalid tool counts, and unmodeled provider fields are rejected. | executor-call, widened-tool-surface, false-completion | Required: Layer 3 | Repeat model and tool contract attacks on Windows/Linux. | `denied-safe` |
| `P7-A-WORKER-001` | `P7-I-WORKER-001` | critical | 3 | Worker launch admits only the external digest, closed capabilities, and filtered environment. | arbitrary-executable, capability-widening, environment-secret | Required: Layers 3 and 4 | Implement and accept equivalent executable and environment admission. | `denied-safe` |
| `P7-A-NETWORK-001` | `P7-I-NETWORK-001` | critical | 3 | Renderer and Worker external network attempts are denied except for the admitted Main provider path. | external-network, credential-exfiltration, undeclared-loopback | Required: Layers 3 and 4 | Prove network denial and bounded provider exception on Windows/Linux. | `denied-safe` |
| `P7-A-PROCESS-001` | `P7-I-PROCESS-001` | high | 3 | Unexpected child, output overflow, timeout, crash, cancellation, and leader exit settle durable state and terminate descendants. | child-process, orphan, terminal-state-drift | Required: Layer 3 | Verify process-tree supervision and resource cleanup on Windows/Linux. | `denied-safe` |
| `P7-A-PROCESS-002` | `P7-I-PROCESS-001` | high | 3 | Parent death, close races, cleanup retries, and residue scans do not leave privileged state. | process, lease, lock, private-root, worktree residue | Required: Layers 3 and 4 | Implement and accept parent-death and process-group cleanup semantics. | `denied-safe` |
| `P7-A-PERSISTENCE-001` | `P7-I-PERSISTENCE-001` | high | 2 | CAS, ownership, sequence, replay, and duplicate validators reject stale or conflicting records without a second effect. | persistence-authority, duplicate-effect, terminal-projection | Required: Layer 2 | Verify SQLite locking, CAS, and recovery semantics on Windows/Linux. | `denied-safe` |
| `P7-A-PERSISTENCE-002` | `P7-I-PERSISTENCE-001` | high | 2 | Unknown fields, truncation, digest tamper, invalid SQLite, and closed ports fail closed. | persistence-corruption, unauthorized-record, recovery-bypass | Required: Layer 2 | Repeat database and migration failure handling on Windows/Linux. | `denied-safe` |
| `P7-A-REDACTION-001` | `P7-I-REDACTION-001` | high | 2 | Sensitive credentials, paths, prompts, completions, arguments, references, patches, and environment text never enter evidence. | diagnostic-leak, audit-content, renderer-leak | Required: Layers 2 and 3 | Verify equivalent redaction and export evidence on Windows/Linux. | `denied-safe` |
| `P7-A-REDACTION-002` | `P7-I-REDACTION-001` | high | 2 | Rejected model, tool, or Worker outcomes cannot be projected as completed or unchanged. | false-completed, false-unchanged, terminal-state-drift | Required: Layer 2 | Repeat failure classification and projection checks on Windows/Linux. | `denied-safe` |
| `P7-A-ARTIFACT-001` | `P7-I-ARTIFACT-001` | critical | 1 | Manifest, digest, architecture, shape, symlink, feature, dependency, license, SBOM, audit, and source-copy checks fail closed. | arbitrary-executable, package-substitution, source-copy-drift | Required: Layers 1, 2, and 4 | Build and accept equivalent package trust and provenance checks on Windows/Linux. | `denied-safe` |

## Ownership and update rules

- `tests/security/abuseCaseCatalog.ts` owns machine-checkable metadata; it
  cannot contain credentials, prompts, arguments, content references, patches,
  environment values, or absolute paths.
- Focused security tests own attack inputs and no-side-effect assertions.
- A demonstrated critical or high finding is repaired only at the existing
  Main/Core/ToolGateway/Worker/package authority boundary and retains its RED
  regression test.
- A medium or low deferral names an owner, invariant, workaround, target P7
  batch, and regression guard; it is not silently removed.
- The final ledger update records exact local, packaged, CI, merge, and
  merged-main evidence separately from release, deployment, and user
  acceptance.

## Related authority

- [Repository Threat Model](THREAT_MODEL.md)
- [P7 Security and Reliability Hardening Design](../superpowers/specs/2026-08-13-p7-security-hardening-design.md)
- [P7.1 Implementation Plan](../superpowers/plans/2026-08-13-p7-1-threat-model-abuse-baseline.md)
- [ADR-0027](../architecture/decisions/0027-p7-threat-model-and-abuse-authority.md)
