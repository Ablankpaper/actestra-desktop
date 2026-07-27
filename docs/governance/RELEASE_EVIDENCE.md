# Release Evidence

Actestra reports delivery states separately. A later green state does not erase
missing evidence from an earlier gate.

## State model

| State | Meaning | Minimum evidence |
| --- | --- | --- |
| Planned | Design or roadmap intent | Documented scope |
| Implemented locally | Source exists in a working tree | Diff and local branch |
| Locally validated | Relevant checks pass locally | Exact commands and results |
| Committed | Change has an immutable local commit | Full commit SHA |
| Pushed | Commit is reachable on GitHub | Remote branch and SHA |
| CI validated | Required remote checks pass for that SHA | Workflow run and job results |
| Candidate built | Installable artifacts map to the SHA | Artifact names, checksums, manifest |
| Candidate verified | Integrity and clean-machine smoke pass | Verification log and environment |
| Released | Candidate is intentionally published | Release record and immutable assets |
| Distributed or deployed | Users or hosts can obtain the release | Channel or deployment evidence |
| Accepted | Representative users complete defined journeys | Acceptance record and issues |

## Candidate evidence

A desktop candidate should include:

- source repository and full commit SHA;
- build environment and tool versions;
- target operating system and architecture;
- artifact names and sizes;
- SHA-256 checksums;
- signature and notarization results where applicable;
- SBOM;
- license and NOTICE bundle;
- update manifest and rollback relationship;
- clean-profile launch result;
- primary journey smoke result;
- known issues.

## Acceptance rules

- CI success does not prove that an installation package launches.
- A package launch does not prove a complete user journey.
- A GitHub release does not prove distribution or deployment.
- Deployment health does not prove desktop-to-service business behavior.
- Old runs do not validate a new commit.
- Evidence must identify the exact platform, artifact, and source revision.

## Reporting template

```text
State:
Source SHA:
Branch or tag:
Platform:
Artifact:
Checks performed:
Result:
Known blockers:
Next gate:
```
