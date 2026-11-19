# Use the Frontend Registry with your agent

Your agent can read these docs as Markdown, find every page through llms.txt, and read any repository's Profile as JSON.

Your agent knows your repository; the Frontend Registry knows the fleet. Point your agent at the Frontend Registry when it needs to know how other repositories do something, which version of a design system is in use, or what a repository's Profile says.

## What your agent can read

| Address | What it is |
| --- | --- |
| `/llms.txt` | An index of every docs page, by section, with each page's address and one-sentence summary, in the llms.txt format |
| `/llms-full.txt` | Every docs page's Markdown, in reading order |
| `/docs/<page>.md` | One docs page's Markdown, such as `/docs/get-started/add-your-repository.md`. Its links to other pages open their Markdown |
| `/docs/<page>` with `Accept: text/markdown` | The same Markdown, at the page's own address |
| `/repositories/<id>/profile.json` | A repository's current Profile's facts as JSON, with their digest; see [The JSON Profile](../reference/json-profile.md) |

Addresses are on your Frontend Registry's address. A repository's id is the `src_` id in its page's address.

## Add it to your AGENTS.md

Agents use an index they always have in context more reliably than docs they must look for. Copy this snippet into your repository's `AGENTS.md`, and replace `https://frontend-registry.example.com` with your Frontend Registry's address:

```markdown
## Frontend Registry

The Frontend Registry is CIB's registry of frontend applications. It holds an
evidence-backed Profile of every registered frontend repository, Reference
Catalog entries for the design systems they use, and adoption across the fleet.

- Docs index for agents: https://frontend-registry.example.com/llms.txt
- Get started: https://frontend-registry.example.com/docs/get-started/what-it-is.md
- Concepts: https://frontend-registry.example.com/docs/concepts/four-parts.md
- Guides: https://frontend-registry.example.com/docs/guides/write-a-standard.md
- Reference: https://frontend-registry.example.com/docs/reference/fact-document.md
- Operate: https://frontend-registry.example.com/docs/operate/deploy-and-configure.md
- A repository's Profile as JSON: https://frontend-registry.example.com/repositories/<src_ id>/profile.json

Prefer these over guessing: fetch the page you need as Markdown.
```

## What it doesn't do

The Frontend Registry offers no MCP server, and it has no write access for agents: registering a repository, starting a Run, and publishing a Standard happen in the app. Every address above is read-only.
