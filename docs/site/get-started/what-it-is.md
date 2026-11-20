# What the Frontend Registry is

The Frontend Registry is CIB's registry of frontend applications, and this page says what it gives you and where to start.

The Digital Enablement team runs it, and every CIB team registers its frontend repositories in it. Frontend means any user-facing client: browser applications, micro-frontends, and hybrid mobile applications. Registering is required. In return, each repository gets a Profile: an evidence-backed record of what it's built on, kept current without anyone filling in a form.

## What you get

- **A Profile of every repository.** Frameworks, dependencies and the versions resolved, how it fits into the web runtime, which design system it uses and how, the services it calls, and how it's built and tested. Each fact names the file and line it came from.
- **Facts you can rely on.** Surveyor reads each repository without running any of its code, and the same commit, Surveyor release, and inputs always give the same facts. See [Facts and their states](../concepts/facts-and-states.md).
- **The whole fleet in one place.** Product managers see every repository, design-system teams see adoption across all of them, and platform teams compare repositories against Standards.
- **Applications you can open.** Where the Digital Enablement team turns previews on, an application is built from a branch of a repository and rebuilt as the branch moves. Open it running from [Applications](/applications), then comment on what you see or share a link to it.

## Start here

Pick the path for what you do:

| You are | Start with | Then |
| --- | --- | --- |
| An app owner | [Add your repository](add-your-repository.md) | [Read its Profile](find-and-read-a-profile.md) |
| A product manager | [Find a repository and read its Profile](find-and-read-a-profile.md) | [Standards and Assessments](../concepts/standards-and-assessments.md) |
| On a design-system team | [See adoption across the fleet](see-adoption.md) | [Read Adoption Analytics](../guides/adoption.md) |
| On a platform team | [Standards and Assessments](../concepts/standards-and-assessments.md) | [Write a Standard](../guides/write-a-standard.md) |

## How it fits with your agent

Your AI agent and code-intelligence tools read one repository, in one session. The Frontend Registry covers every registered repository, keeps each Profile with its evidence, and records how it was produced, so the same question gets the same answer next month. Use your agent for your own code, and the Frontend Registry for the fleet. Your agent can read both: see [Use the Frontend Registry with your agent](../guides/use-with-your-agent.md).

## The parts

The Frontend Registry works with three other parts: Surveyor, which reads a repository; the Reference Catalog, which describes what repositories build on; and the Catalog Builder, which writes that catalog. [The four parts](../concepts/four-parts.md) explains each one's job.
