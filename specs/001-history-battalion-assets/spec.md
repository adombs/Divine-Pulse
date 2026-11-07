# Feature Specification: History ledgers, Battalion detail and required assets

**Feature Branch**: `fix/required-assets-and-fallback-audit` and independent UI branches linked to #72
**Created**: 2026-11-06
**Status**: Implementation
**Input**: Refine History Character Stats/Battle Stats popups and Battalion detail, rename Awards tab to Records, relocate and ignore the local dump, update outdated tests, inventory fallbacks, and require real game assets.

## User Scenarios & Testing

### User Story 1 - Compare a run's history (Priority: P1)
The player opens Character Stats or Battle Stats from History and can read the run scope, compare useful measures, search records and switch topics without losing context.
**Independent Test**: Open both dialogs with populated, empty, loading and failed history; use search, keyboard and topic controls.
**Acceptance Scenarios**:
1. Given recorded battles, opening either popup presents a coherent hierarchy consistent with the surrounding application.
2. Given a filter, rows reflect the filter while whole-run totals remain accurately labelled; unknown observations never become fabricated zeroes.
3. Given Character Stats, the former Awards tab is named Records and retains its existing award counts.

### User Story 2 - Understand a Battalion (Priority: P1)
The player reads a Battalion's identity, endurance, modifiers and gambit in a deliberately composed detail view.
**Independent Test**: Inspect general and recorded-unit panels at desktop 16:9 and 16:10 and enlarged text.
**Acceptance Scenarios**:
1. Modifier labels and values align without expansive bars or an arbitrary gulf between gambit numbers and its area.
2. The native gambit preview keeps its verified affected cells, badge colour/direction and proportions.
3. Spent/rattled/unrecorded states preserve their meaning and remain accessible.

### User Story 3 - Know when assets are missing (Priority: P1)
The player sees the actual imported game asset or an explicit actionable missing-asset sentinel/error.
**Independent Test**: Remove one required image, use a malformed asset path and simulate a failed image request.
**Acceptance Scenarios**:
1. Missing portraits, icons, map pieces and gambit art never silently become initials, generic icons, another portrait, or drawn game art.
2. Missing/failed/loading states are distinct; a successful reimport permits recovery.
3. Optional assets that are inapplicable to the selected game/DLC are distinguished from required assets that are missing.

### User Story 4 - Keep local game files private (Priority: P1)
**Independent Test**: Compare source/destination dump inventories and run Git ignore/tracked-file checks.
**Acceptance Scenarios**:
1. The entire desktop dump moves to repository-local `game-dump/` with its contents preserved.
2. The root ignore rule covers the whole folder including metadata, and no game content enters Git or release artifacts.

### Edge Cases
No battles; active battle; incomplete older recording; unknown totals; many records; translated/long names; desktop 16:9 and 16:10; enlarged text; missing import; stale import; missing individual sprite; failed request; valid DLC absence; assets replaced during load.

## Requirements
### Functional Requirements
- FR-001: Refine only the requested surfaces and necessary shared asset handling, preserving the application identity.
- FR-002: Keep History aggregation and recording semantics correct and expose unknown values explicitly.
- FR-003: Rename the user-facing Awards tab to Records.
- FR-004: Require the original imported game asset for each requested image; remove substitute game art.
- FR-005: Report missing asset identity/path and a useful recovery action through an error or sentinel.
- FR-006: Ignore the relocated dump before moving it and verify inventory and Git exclusion afterward.
- FR-007: Inventory all fallback mechanisms by category, location, purpose and recommendation; do not conflate loading or unknown-data sentinels with substitutes.
- FR-008: Review the complete test suite, repair obsolete expectations and add behavior-level regressions for the changed contracts.
- FR-009: Preserve keyboard access, focus, scroll containment and legibility in light/dark themes, desktop 16:9 and 16:10 and enlarged text. Do not work on phone views unless explicitly requested.
- FR-010: Deliver reviewed commits and PRs into release/1.3.0; do not merge or publish without authorization.
- FR-011: Omit comparison subtitles, repeated counts, sorting hints and footer legends in History statistics.
  Keep unknown values accessible without explanatory footer clutter.
- FR-012: Put native character sprites beside names, center numeric columns, and reuse History's battle-type colours.
- FR-013: Label the reference Battalion's 1–5 selector Level and persist maintainer UI preferences in root AGENTS.md.

### Key Entities
Recorded battle; run totals; character aggregate; award/record count; Battalion assignment/reference; imported image; missing-asset sentinel; local dump.

## Success Criteria
- SC-001: Both History popups and Battalion detail show clear hierarchy and deliberate alignment on representative populated and empty/error states.
- SC-002: All supported asset render paths use original files or explicit missing/loading/error states; no visual substitutes survive the asset audit.
- SC-003: All required frontend/backend/lint/architecture checks pass, or exact blockers are recorded; dump-backed checks use the relocated dump.
- SC-004: Every identified fallback mechanism has a disposition and source reference.
- SC-005: The dump's before/after path-and-size inventories agree and Git tracks zero files under game-dump/.

## Assumptions
This is refinement of the existing visual identity. The fallback request authorizes removing visual asset substitutes; other compatibility and recovery mechanisms are inventoried and retained unless evidence supports safe removal. Full-page visual testing depends on browser availability and must be disclosed honestly.
