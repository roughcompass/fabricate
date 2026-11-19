# Read evidence

Every fact and Finding links to the committed files and lines it came from, so you can check it yourself.

## From a Profile

In any Profile view, a fact's evidence count opens its evidence: each record's file, its lines or the position in structured data such as `/dependencies/react` in `package.json`, and the detector and rule that produced it. An excerpt shows the committed content, read again from the pinned commit and checked against the digest Surveyor recorded, so you see exactly what was read.

An inferred fact also explains its reasoning: which signals it combined, and the rule that connects them.

## From a Finding

A Finding shows how each part of its Control was read against the Profile or Relationship Map, with the values it saw, and lists every committed location those values came from. Its link to the Profile opens the category its fields read.

## When a fact is wrong

Check the evidence first: it shows what the file said at that commit. If the file says something else now, a newer commit's Profile will show it once surveyed; choose **Re-profile** on the repository's page to survey the current commit now. If the evidence is right but the conclusion isn't, the fault is in a detector or a rule. Tell the Digital Enablement team, with the repository, the version, and the fact, so Surveyor can be fixed in a later release.
