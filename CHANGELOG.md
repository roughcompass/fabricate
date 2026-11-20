# Changelog

## Unreleased

The Frontend Registry release that ships the product site: `/about` and the docs at `/docs` (OpenSpec change `establish-frontend-registry`).

- **Product names.** Fabricate is now the Frontend Registry; repo-facts is Surveyor; the Reference Catalog and the Catalog Builder are new parts. Old settings, cookies, and the old config path are still read for one release, with a warning.
- **Reference Catalog.** Surveyor 0.7.0 reads versioned Reference Catalog entries that the Frontend Registry builds and stores, and repositories are surveyed again when an entry they used changes.
- **Adoption Analytics and system status.** New Insights › Adoption pages and Admin › System.
- **Page templates.** Every page uses one of ten page templates, with its title in its page header.
- **Product site.** `/about`, `/docs`, Markdown for agents (`/docs/<path>.md`, `/llms.txt`), and `/repositories/<id>/profile.json`.

Upgrading: back up `storage/fabricate.sqlite3`, then run `npm run db:migrate`, `npm run projection:rebuild`, and `npm run db:vacuum` (see the README).

### Approval

The marketing copy in `src/content/about.ts`, including its hero headline ("Every CIB frontend repository and what it's built on, in one place"), and the docs under `docs/site/` were approved for release by Martin on 2026-11-19 (task 10.11).
