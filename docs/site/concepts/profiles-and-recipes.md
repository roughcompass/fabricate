# Profiles and recipes

A Profile is the immutable record of one commit's facts, and its recipe says exactly what produced it.

## A Profile

A Profile wraps the fact document Surveyor wrote for one commit. It names the Repository and the commit, records the Surveyor release and configuration digest, and embeds the fact document unchanged, with its digest. Once stored, it never changes. A Profile carries no survey times or names, so the same commit surveyed with the same recipe gives the same Profile, byte for byte.

## A survey

A **survey** is one Surveyor run of one Repository's commit under one recipe. At most one survey exists for each Repository, commit, and recipe, and a successful one holds exactly one Profile. Runs, background surveying, and previews share surveys, so a commit is surveyed once however many of them need it. A failed survey is retried under the same key when it's requested again.

## A recipe

A survey's **recipe** is everything besides the commit that decides its facts:

| Part | What it is |
| --- | --- |
| Surveyor release | The version of Surveyor's detectors, such as 0.7.0 |
| Configuration digest | The digest of the detectors, parsers, and analysis limits it ran with |
| Profile version | The version of the Profile format, such as 3 |
| Reference Catalog entries | The entries its facts were compared against, each with the version the repository wanted |

Surveyor picks the entries as it reads the repository, so a survey records them when it succeeds. A successful survey still matches its commit while its entries are the ones Surveyor would pick now. When the recipe changes, because of a new Surveyor release or a rebuilt entry the survey used, the commit is surveyed again, and the earlier survey and its Profile stay. See [Re-surveys](../operate/re-surveys.md).

## Reproducible

Given the same commit and the same recipe, Surveyor writes the same fact document. So a Profile can always be checked by surveying its commit again with its recipe.

## Versions of the format

A Profile keeps the format version it was written with. Version 3 is current; versions 1 and 2 stay readable. See [Profile versions](../reference/profile-versions.md).
