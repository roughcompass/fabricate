# Catalog builds

The worker builds Reference Catalog entries for every version in use, from the registry you configure.

## What's built

The things described are listed in `config/catalog.yaml`, Salt to start. For each, once a day, when the worker starts, and after each profiling check, the Catalog check queues a build of:

- each version a registered repository's current Profile resolves in a lockfile, or declares exactly, that has no entry;
- for a declared range with no lockfile, the highest published version the range allows;
- the thing's newest published version;
- each version whose entries were all built before the team's rules changed.

Versions in use are queued before the registry is read, so they're built even when it can't list versions.

## A build

A build downloads the thing's packages at that version from `catalog.registry`, checks each against the integrity the registry records, and reads them as data, never installing or running them. It reads the thing's own published data and the team's rules in `config/catalog-rules/<id>.yaml`, validates the entry, and stores it under its digest.

| Outcome | What happens |
| --- | --- |
| A new entry | It's stored, and repositories whose current survey would now get it are surveyed again |
| The same entry as before | Nothing is stored; inputs that didn't change give the same digest |
| Failed | Nothing is stored, and the entries in use stay; the reason shows on the System page, under Admin |

A build that can't reach the registry is retried twice, seconds apart. Any failed build is tried again the next day. Every build is kept, so the System page can show their history.

## The registry

Builds read the public npm registry unless `catalog.registry`, or `FRONTEND_REGISTRY_CATALOG_REGISTRY`, names another, such as CIB's internal mirror. The registry must serve the design system's packages and its published data, such as `@salt-ds/mcp`. Registries that need a sign-in aren't supported yet.

## Changing the rules

The team's rules are reviewed like code. A change that alters what they say rebuilds every version of that thing, which surveys again every repository that used it. A change to comments alone changes nothing.
