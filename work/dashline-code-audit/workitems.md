# Work Items

| ID | title | role | targets | surface | status | evidence | notes |
|----|-------|------|---------|---------|--------|----------|-------|
| WI-001 | Establish scope, threat model and inventory | lead | repository | process/architecture | done | E-001 | offline-first, preserved unrelated untracked files |
| WI-002 | Audit deterministic core and tests | cae | packages/core, packages/shared | simulation | done | E-002, E-007, E-008 | 60Hz, PRNG, track state, versioning reviewed |
| WI-003 | Audit client security and persistence | cae | apps/client | browser/localStorage/DOM | done | E-003, E-004, E-005, E-008 | storage corruption and client state findings validated |
| WI-004 | Audit dependencies and build pipeline | cae | manifests, lockfile, scripts | supply-chain/build | done | E-006, E-008, E-009 | completed with dependency advisory endpoint unavailable |
| WI-005 | Run test, typecheck, build and browser validation | cae | workspace | quality | done | E-002, E-003 | exact command results captured in report |
| WI-006 | Validate findings and write report | lead/doc | case | reporting | done | E-001..E-009 | Evidence → Finding → Path included in report |
| WI-007 | Remediate validated findings and verify fixes | lead | repository | source/tests/CI/release | done | E-010, E-011, E-012 | F-001 through F-011 fixed; dependency advisory query remains unavailable |

## Coverage
- [x] Recon/analysis complete for in_scope assets
- [x] Critical/High candidates triaged (none validated)
- [x] Validated findings have Evidence (E-*)
- [x] Path documented (callflow)
- [x] Timeline continuous across major phases
- [x] Report via docs-generator
- [ ] field-journal anonymized (skill unavailable in current session; no external journal written)

## Refs
- skills/ops/timeline-workitem.md
- skills/ops/evidence-finding-path.md
