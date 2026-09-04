# Case Scope

## meta
- case_id: dashline-code-audit
- created: 2026-09-04T11:19:20.5547627+08:00
- operator: local
- project_root: D:\WZS\Project\webGame
- primary_skill: code-audit/SKILL.md
- primary_id: R26
- lead_role: lead
- specialist_roles: [cae, doc]
- hint: Audit local Dashline TypeScript static web game repository for architecture, determinism, client security, storage, dependencies, tests and build quality

## auth
- status: granted
- basis: own_system
- evidence_of_auth: cli-flag AuthGranted or AuthStatus=granted
- MUST NOT proceed if status != granted

## in_scope
- assets:
  - D:\WZS\Project\webGame
- surfaces: [typescript_source, static_web_client, deterministic_core, local_storage, build_tooling, dependencies, tests, documentation]
- activities: [threat_model, static_review, dependency_audit, test, typecheck, build, report]

## out_of_scope
- assets: [uncommitted_docs_and_fish_design_work_unrelated_to_Dashline]
- activities: [source_modification, remediation_implementation, dos, phishing_real_users, unrestricted_exfil, external_network_scanning]

## network_profile
- mode: offline
- notes: |
    offline | lab_only | authorized_target_only | unrestricted_lab
    Change mode only after auth.status = granted.

## deliverables
- report: true
- field_journal: true
- diagrams: true
- timeline: true

## constraints
- timebox: {}
- stealth: low
- data_handling: anonymize

## signoff
- ready_for_act: true
- checklist:
  - [x] auth.status = granted
  - [x] in_scope.assets non-empty OR offline sample path set
  - [x] network_profile.mode chosen
  - [x] out_of_scope reviewed
  - [x] roles assigned (see skills/ops/role-map.md)

## ops_refs
- skills/ops/scope-contract.md
- skills/ops/evidence-finding-path.md
- skills/ops/role-map.md
- skills/ops/timeline-workitem.md
- skills/ops/IDENTITY.md