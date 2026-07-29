# AionUi v2.1.41 Retention Matrix

This document is the non-regression contract for using AionUi as Actestra's
product UI and general-work foundation. The default is to retain the original
function and its functional UI. A feature is not removed merely because its
Actestra provider is not ready in the current phase.

The exact baseline is AionUi `v2.1.41` at commit
`2d8925fc67a97a20996fadcd2a0862b778b572ba`. Its 1,766-file runnable desktop
snapshot is stored under
[`foundation/aionui-v2.1.41`](../../foundation/aionui-v2.1.41), protected by a
SHA-256 manifest and a machine check.

## Retention levels

| Level | Contract |
| --- | --- |
| **R0 — exact retain** | Keep the original UI, interaction model, source, and behavior as the golden baseline. |
| **R1 — compatible provider** | Keep the original UI and user-visible semantics while replacing an upstream data, process, identity, permission, or runtime provider behind a compatibility seam. |
| **R2 — retained but isolated** | Keep the source, route, settings entry, and intended workflow, but prevent external effects until an Actestra-owned endpoint, policy, credential, license, or release boundary is ready. The UI must explain why it is unavailable. |

No user feature has a default **remove** disposition. Test showcases,
promotional media, publishing credentials, and upstream release infrastructure
are not end-user functions; their source may remain in the frozen snapshot
without becoming Actestra product authority.

## Functional and UI preservation contract

| Area | Native evidence | Level | What must remain visible and usable | Actestra fusion boundary | Required acceptance proof |
| --- | --- | --- | --- | --- | --- |
| Desktop frame and navigation | `renderer/components/layout`, Sider, title bar, window controls | R0/R1 | Original window proportions, sidebar, collapse behavior, New Conversation, Assistants, Scheduled Tasks, Team, Settings, history, search, drag regions, and platform window controls | Identity, window lifecycle, safe navigation, and trusted main-frame operations move behind Actestra main without redesigning the frame | Golden screenshots on macOS, Windows, and Linux; keyboard, collapse, navigation, and window-control E2E |
| Guide and new-work surface | `renderer/pages/guid` | R0/R1 | Original Guide layout, composer, suggestions, attachments, agent/model/assistant choice, workspace choice, slash commands, recent locations, and draft continuity | Conversation creation is adapted to Actestra task/session creation while keeping the same controls and states | Upstream Guide tests plus create, cancel, restore, invalid-provider, and offline fixtures |
| Conversation lifecycle | `renderer/pages/conversation`, `ipcBridge.conversation` | R0/R1 | Streaming messages, queued turns, stop/cancel, retry, confirmations, side questions, artifacts, errors, completion, and multi-platform conversation layouts | Actestra event projection becomes authoritative one domain at a time; bridge adapters preserve AionUi response and event shapes | Golden transcript fixtures, restart recovery, stream ordering, denial, cancellation, crash, and duplicate-event tests |
| Conversation history | `GroupedHistory`, conversation search/export hooks | R0/R1 | Grouped history, selection, search, rename, delete, export, associations, active state, and restore | Actestra persistence replaces the upstream conversation store through a compatibility repository; no hidden dual-authority writes | Migration fixture, restart proof, search parity, rename/delete/export E2E, ownership-isolation tests |
| Files, attachments, and workspace | `Workspace`, file hooks, `fs`, `fileWatch`, `fileStream`, `fileSnapshot` bridges | R0/R1 | Attach/paste/drop, workspace tree, recent workspaces, open/reveal, watch, streaming reads, snapshot/diff, stage/unstage, discard/reset, rename, delete, and download | Every privileged operation is mapped to workspace grants, policy, approval, audit, and safe path validation; renderer API shape remains compatible | Path traversal, symlink, denial, overwrite, conflict, cancellation, diff, and workspace E2E fixtures |
| Rich messages and previews | Markdown, media, Preview panel, document bridges | R0/R1 | Markdown, code, math, Mermaid, links, images, audio/video, HTML, text, PDF, PPT, Word, Excel, history, and generated-document previews | File access and document generation route through Actestra artifact and tool services; unsafe HTML and external navigation remain sandboxed | Representative preview corpus, CSP and sandbox tests, local-resource tests, document generation and failure fixtures |
| Model and provider settings | Mode Settings, provider hooks, `mode`, `google`, `bedrock` bridges | R0/R1 | Provider/model CRUD, model selection, custom endpoints/protocols, health checks, default model, Google and Bedrock flows, validation, and search | Credentials use the Actestra broker; outbound endpoints use allowlisted providers; persisted secrets never reach renderer state or model text | Provider contract suite, masked-secret restart proof, health-check denial/offline cases, UI parity screenshots |
| Agent registry and ACP clients | Agent Settings, repair page, ACP platform, `runtime`, `acpConversation` | R0/R1 | Original built-in agent choices, installation/detection, override settings, repair, status, permission modes, slash commands, and conversation behavior | Existing ACP/agent surfaces become the common worker entry. Goose is added here through `AgentAdapter`; it does not introduce a second application UI | Agent-detection, incompatible-version, install/repair, lifecycle, permissions, cancel, and Goose-adapter parity tests |
| Assistants | Assistant Settings, `ipcBridge.assistants` | R0/R1 | List, create, edit, delete, import, enable/disable, avatar, prompt/context, default agent/model/workspace, permission defaults, and Skill bindings | The same UI reads and writes Actestra-owned assistant records through a shape-compatible provider | Existing assistant unit/E2E suites, migration fixtures, import conflicts, restart, permission-default tests |
| Skills and Skills Hub | Skills Settings, detail/history pages, extension contributions | R0/R2 | Installed Skills, built-ins, search, detail, import by folder/archive/path, batch import, history, error reporting, external paths, extension contributions, and Hub browsing | Local Skills use Actestra workspace and provenance rules. Network catalogs stay visible but isolated until a signed, allowlisted Actestra catalog exists | Existing Skills E2E suite, malicious archive/path tests, provenance display, offline and unavailable-catalog states |
| MCP and tools | Tools Settings, settings modal, `mcpService` | R0/R1 | Server list/import/edit/delete, enable/disable, connection test, OAuth, server tools, session binding, and error states | Calls route through the Actestra tool gateway, policy, one-shot approval, credential lease, timeout, redaction, and audit contracts | MCP fixtures, OAuth cancellation, unknown tool, denial, timeout, restart, metadata-only audit, and bypass tests |
| Scheduled tasks | Scheduled Tasks pages, `ipcBridge.cron` | R0/R1 | Create, edit, enable/disable, run, view detail/history, associate conversations, and delete schedules | Scheduling and execution move to Actestra-owned durable task/approval semantics; no unattended protected operation is grandfathered | Time-zone, restart, missed-run, duplicate-run, approval-block, cancellation, and CRUD E2E |
| Team experience | Team pages/hooks/types, `ipcBridge.team` | R0/R1 | Team creation, presets, leader/member selection, chat, child turns, status, task/slot views, messaging, rename/pin/delete, pause/cancel, and recovery states | Eigent-style planning and Actestra orchestration are mapped into the preserved Team UI and event vocabulary; no separate Eigent UI or competing store | Existing AionUi team suites plus dependency, retry, partial failure, handoff, approval-node, aggregation, and restart fixtures |
| Appearance and accessibility | themes, Appearance Settings, `theme`, `systemSettings` | R0/R1 | Light/dark/system themes, CSS themes, custom styles, font/zoom scale, language, persisted layout preferences, reduced-motion and accessible interaction behavior | Actestra identity tokens are introduced as a compatible theme/product patch, not a replacement design system | Theme and scale E2E, persistence, contrast, focus, keyboard, reduced-motion, and screenshot baselines |
| Extensions and Hub | extension loader/contributions, Extension Settings, `extensions`, `hub` | R0/R2 | Discovery, lifecycle, contributed agents/assistants/Skills/MCP/channels/settings/themes/WebUI, permissions, errors, and extension settings tabs | Local reviewed extensions may run through signed manifests and capability grants. Remote Hub install/update remains isolated until catalog integrity and rollback exist | Existing extension suites, signature/capability tests, malicious manifest tests, offline Hub behavior, rollback proof |
| WebUI, remote agents, and channels | WebUI Settings, remote modules, `webui`, `remoteAgent`, `openclawConversation`, `channel`, `realtime` | R0/R2 | WebUI configuration, remote sessions, channel setup/status, QR or token flows, conversation routing, and contributed channel UI | Entries and semantics remain; listeners, credentials, public exposure, and message sends require Actestra identity, secret isolation, network policy, and explicit material-action confirmation | Local-only WebUI test, bind/auth tests, no-public-listener default, send confirmation, disconnect/reconnect, secret-redaction suites |
| Notifications, deep links, tray, startup, GPU, and pet | application process, pet process/pages, `notification`, `deepLink`, `application`, `windowControls` | R0/R1 | Notifications, deep links, tray behavior, start-on-boot preference, GPU recovery, dev settings, desktop pet UI/window/settings, and platform-specific behavior | Native operations remain main-owned and policy-scoped. Product identifiers and startup registration change to Actestra while interaction behavior remains | Deep-link allowlist, second-instance, notification, startup toggle, GPU recovery, pet lifecycle, and platform smoke tests |
| Login and identity | Login page, Auth context, WebUI auth | R1/R2 | Original local desktop entry must remain non-blocking; WebUI login/session/expiry/error UI remains available | Desktop becomes guest/local-first under Actestra identity. Remote/WebUI login swaps to Actestra session and secure storage when ready | Fresh-profile launch without account, optional login, expiry/revocation, profile isolation, and no-secret-in-renderer tests |
| About, feedback, diagnostics, and updates | System/About Settings, feedback flows, updater bridges, Sentry/log modules | R1/R2 | About/version UI, update status/progress/error/cancel, feedback entry, diagnostics export, and recovery guidance remain recognizable | AionUi feeds, telemetry, feedback endpoints, DSN, and publisher credentials are disabled. Actestra-signed update metadata, explicit telemetry consent, redaction, and owned endpoints replace providers | Disabled-by-default network proof, signed update/rollback tests, diagnostic redaction, consent, failure and cancellation UI tests |
| Packaging and platform resources | builder config, entitlements, icons, scripts, public/resources | R1/R2 | The product must retain platform behavior and all functionally required assets; installer and update UX remain | Bundle ID, executable, icons, protocol, entitlements, signing, notarization, provenance, SBOM, and release channels are Actestra-owned | Clean-machine install/upgrade/uninstall, Gatekeeper/Windows signing/Linux packaging, resource integrity, exact-source provenance |

## Route inventory

The frozen router exposes 27 paths. The preservation checker requires all of
them, including compatibility redirects:

```text
/login
/guid
/conversation/:id
/team/:id
/settings/model
/assistants
/settings/assistants
/settings/agent
/settings/agent/:id/repair
/settings/skills
/settings/skills/import-history
/settings/skills/detail/:skillName
/settings/tools
/settings/capabilities
/settings/capabilities/skills/import-history
/settings/skills-hub
/settings/appearance
/settings/display
/settings/webui
/settings/pet
/settings/system
/settings/about
/settings/ext/:tabId
/settings
/test/components
/scheduled
/scheduled/:job_id
```

`/test/components` is preserved as upstream diagnostic source and test support;
it need not be exposed in the normal Actestra navigation.

## Bridge-domain inventory

The frozen adapter exports 41 functional domains:

```text
shell, assistants, conversation, runtime, application, update, autoUpdate,
dialog, fs, fileWatch, workspaceOfficeWatch, fileStream, fileSnapshot,
googleAuth, google, bedrock, mode, acpConversation, mcpService,
openclawConversation, remoteAgent, database, previewHistory, preview, document,
pptPreview, wordPreview, excelPreview, deepLink, windowControls, theme,
systemSettings, notification, task, webui, cron, extensions, channel, hub,
realtime, team
```

The list is a compatibility surface, not a grant of renderer authority.
Actestra may implement a domain through IPC, HTTP, WebSocket, a local
repository, or a supervised worker as long as the renderer-facing contract,
user-visible semantics, validation, and error states remain compatible.

## Change rule

Every downstream change that touches an R0-R2 area must state:

1. the retained route, component, bridge domain, and user journey;
2. whether the change is R0, R1, or R2;
3. the provider or authority being replaced;
4. screenshots and automated tests proving no unrelated regression;
5. the reason for any user-visible difference and the owner-approved decision
   that permits it.

An unavailable provider is a reason to isolate an effect, not to delete the
corresponding function or UI.
