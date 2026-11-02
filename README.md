# Dating Compatibility

A mobile-friendly compatibility calculator built with React, TypeScript, and Vite.

## Features

- Weighted 0–5 ratings; Unknown excluded and zero assessed.
- Compatibility scores, coverage, notes, and shared-interest checklists.
- Multiple profiles with automatic IndexedDB local saving.
- Custom groups, criteria, descriptions, weights, and checklist interests.
- Immutable scoring-system versions: existing profiles keep their original system.
- Six-sheet Excel backup/restore, merge/replace previews, and local recovery.
- Copyable scorecards and collapsible backup/customization sections.

## Run locally

Install Node.js and npm, then run these commands in the project folder:

```powershell
npm.cmd ci
npm.cmd run dev
```

Open the Local address printed by Vite. Keep the terminal running during development.

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd run preview
```

## Scoring and customization

Weights total 100 points. Assessed ratings earn `rating / 5 × weight`.
An assessed checklist earns `checked count / total items × checklist weight`.
Unknown is excluded; zero counts as assessed.

Compatibility is earned points divided by assessed weight, expressed as a
percentage. Coverage is assessed weight divided by total possible weight.
With nothing assessed, compatibility is shown as a dash.

New profiles start with zero ratings, Unknown unchecked, and the checklist
assessed. Expand Customize scoring, edit a copy, and save a new version.
New profiles use the saved default; existing profiles retain their original system.

## Local data and backups

Profiles and scoring systems stay on this device, in this browser, at the exact
site address (including port). They are not synced to GitHub or a server.
Use the same browser/address and one app tab at a time. Clearing browser site
data removes local profiles and scoring systems.

Export Excel backups to preserve data or move it between devices. Backups contain
profiles, notes, answers, saved scoring versions, and the default system.
Keep personal backups outside this repository.

The six worksheets are Profile Comparison, Profiles, Ratings, Criteria,
Shared Interests, and Settings. Calculated fields are export-time snapshots;
use the app to edit and recalculate. Older backup formats remain supported.

## Project layout

- `src/model.ts`: types and scoring.
- `src/storage.ts` and `src/useProfiles.ts`: IndexedDB and profile management.
- `src/CustomizationEditor.tsx`: editor for new scoring versions.
- `src/backup.ts`, `src/legacyBackup.ts`, `src/xlsx.ts`: Excel backups.
- `src/App.tsx`: calculator interface.

Offline installation is a future feature. The app currently needs a running
development server or a host serving its production build.

## Third-party software

JSZip is bundled with its MIT/GPLv3 dual-license and notices in
`src/vendor/LICENSE.markdown` and the library header. Its wrapper was adapted
for browser module imports.
