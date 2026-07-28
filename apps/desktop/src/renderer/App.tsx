import { useEffect, useState, type JSX } from "react";
import type { AppInfo, PlatformSnapshot } from "../shared/contracts";

const NAVIGATION = [
  { label: "Home", glyph: "⌂", active: true },
  { label: "Tasks", glyph: "◇", active: false },
  { label: "Workspaces", glyph: "▱", active: false },
  { label: "Artifacts", glyph: "□", active: false },
] as const;

const CAPABILITIES = [
  {
    eyebrow: "Private by default",
    title: "Local-first shell",
    description: "No account, telemetry, update feed, or external network endpoint is active.",
  },
  {
    eyebrow: "Bounded authority",
    title: "Renderer stays unprivileged",
    description:
      "The UI can request typed intents, but it cannot reach Node, Electron, files, or the shell.",
  },
  {
    eyebrow: "Proof before claims",
    title: "Evidence-led delivery",
    description:
      "Every worker, permission, package, and release will carry explicit verification state.",
  },
] as const;

const ROADMAP = [
  {
    phase: "P3",
    label: "Platform contracts",
    detail: "Tasks, events, approvals, and worker lifecycle",
  },
  {
    phase: "P4",
    label: "General work",
    detail: "Research, files, writing, and artifact workflows",
  },
  {
    phase: "P5",
    label: "Coding worker",
    detail: "Isolated repositories, commands, diffs, and tests",
  },
] as const;

function BrandMark(): JSX.Element {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span className="brand-mark__stroke" />
    </span>
  );
}

function StatusDot(): JSX.Element {
  return <span className="status-dot" aria-hidden="true" />;
}

export function App(): JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [infoError, setInfoError] = useState(false);
  const [platformSnapshot, setPlatformSnapshot] = useState<PlatformSnapshot | null>(null);
  const [platformError, setPlatformError] = useState(false);
  const [draftVisible, setDraftVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.actestra.notifyRendererReady();
    window.actestra
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfoError(true);
        }
      });
    window.actestra
      .getPlatformSnapshot()
      .then((snapshot) => {
        if (!cancelled) {
          setPlatformSnapshot(snapshot);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlatformError(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="window-drag-region" aria-hidden="true" />

      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand__name">Actestra</div>
            <div className="brand__tagline">Work, orchestrated.</div>
          </div>
        </div>

        <nav className="navigation" aria-label="Primary navigation">
          <div className="navigation__label">Workspace</div>
          {NAVIGATION.map((item) => (
            <button
              className={`navigation__item${item.active ? " navigation__item--active" : ""}`}
              type="button"
              key={item.label}
              aria-current={item.active ? "page" : undefined}
            >
              <span className="navigation__glyph" aria-hidden="true">
                {item.glyph}
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar__spacer" />

        <div className="local-card">
          <div className="local-card__heading">
            <StatusDot />
            Local shell
          </div>
          <p>No account required. External access is blocked.</p>
        </div>

        <button className="settings-button" type="button">
          <span aria-hidden="true">⌘</span>
          Settings
          <span className="settings-button__hint">Soon</span>
        </button>
      </aside>

      <main className="main-content">
        <header className="page-header">
          <div>
            <span className="page-header__eyebrow">Independent desktop foundation</span>
            <h1>Work, orchestrated.</h1>
          </div>
          <div className="shell-pill">
            <StatusDot />
            P3 boundary
          </div>
        </header>

        <section className="hero-panel" aria-labelledby="hero-title">
          <div className="hero-panel__glow" aria-hidden="true" />
          <div className="hero-panel__content">
            <span className="section-kicker">A calm place for complex work</span>
            <h2 id="hero-title">One workspace. Specialized workers. Clear control.</h2>
            <p>
              Actestra will coordinate general work, coding, and small agent teams without hiding
              permissions, progress, or evidence.
            </p>
            <div className="hero-panel__actions">
              <button
                className="primary-button"
                type="button"
                onClick={() => setDraftVisible(true)}
              >
                Create a draft task
                <span aria-hidden="true">→</span>
              </button>
              <span className="hero-panel__note">Local UI state only</span>
            </div>
          </div>
          <div className="orchestration-mark" aria-hidden="true">
            <span className="orchestration-mark__core">A</span>
            <span className="orchestration-mark__node orchestration-mark__node--one" />
            <span className="orchestration-mark__node orchestration-mark__node--two" />
            <span className="orchestration-mark__node orchestration-mark__node--three" />
          </div>
        </section>

        {draftVisible ? (
          <section className="draft-banner" aria-live="polite">
            <div>
              <strong>Draft surface ready.</strong>
              <span>Task persistence and workers arrive behind P3 contracts.</span>
            </div>
            <button
              type="button"
              onClick={() => setDraftVisible(false)}
              aria-label="Dismiss draft notice"
            >
              ×
            </button>
          </section>
        ) : null}

        <section className="capability-section" aria-labelledby="foundation-title">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Foundation</span>
              <h2 id="foundation-title">Designed around explicit boundaries</h2>
            </div>
            <span className="section-heading__meta">No upstream runtime loaded</span>
          </div>

          <div className="capability-grid">
            {CAPABILITIES.map((capability, index) => (
              <article className="capability-card" key={capability.title}>
                <span className="capability-card__index">0{index + 1}</span>
                <span className="capability-card__eyebrow">{capability.eyebrow}</span>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="roadmap-section" aria-labelledby="roadmap-title">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Next layers</span>
              <h2 id="roadmap-title">Capability enters in controlled slices</h2>
            </div>
          </div>

          <div className="roadmap-list">
            {ROADMAP.map((item) => (
              <div className="roadmap-item" key={item.phase}>
                <span className="roadmap-item__phase">{item.phase}</span>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </div>
                <span className="roadmap-item__state">Planned</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      <aside className="status-rail" aria-label="Shell status">
        <div className="status-rail__header">
          <span>Runtime status</span>
          <span className="status-rail__badge">Offline</span>
        </div>

        <dl className="status-list">
          <div>
            <dt>Application</dt>
            <dd>{appInfo?.name ?? "Actestra"}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{infoError ? "Unavailable" : (appInfo?.version ?? "Loading")}</dd>
          </div>
          <div>
            <dt>Architecture</dt>
            <dd>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : "Loading"}</dd>
          </div>
          <div>
            <dt>Network policy</dt>
            <dd>{appInfo?.networkPolicy === "offline-shell" ? "External blocked" : "Loading"}</dd>
          </div>
          <div>
            <dt>Platform authority</dt>
            <dd>
              {platformError
                ? "Unavailable"
                : platformSnapshot?.authority === "main-only"
                  ? "Main-only"
                  : "Loading"}
            </dd>
          </div>
        </dl>

        <div className="rail-divider" />

        <div className="worker-state">
          <span className="worker-state__icon" aria-hidden="true">
            ◌
          </span>
          <strong>No workers running</strong>
          <p>
            Workers will appear here only after their lifecycle and permission contracts are active.
          </p>
        </div>

        <div className="rail-divider" />

        <div className="proof-card">
          <span className="proof-card__label">Current proof</span>
          <strong>Main-owned boundary</strong>
          <ul>
            <li>Typed renderer intents</li>
            <li>Metadata-only audit</li>
            <li>
              {platformError
                ? "Evidence unavailable"
                : platformSnapshot === null
                  ? "Evidence loading"
                  : `${String(platformSnapshot.attempts.length)} terminal attempts`}
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
