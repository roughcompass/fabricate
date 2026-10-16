# Applications

An Application is a repository registered in one Portal. Add application (`/applications/new`) starts from a **starter**, a Salt Patterns template while the demo is enabled, or a repository URL. Create Application registers the repository, assesses it with the DE Web initiative, and determines whether DE Web will render it as an ES module, with Module Federation, or in an iframe. Fabricate never creates or writes to a repository: a team creates its repository from a starter itself, then enters the repository's URL.

This page covers what an operator configures: the starters file, the repository URLs Create Application accepts, and which hosts are Bitbucket. A Portal's menu, which points at Applications, is in [navigation.md](navigation.md).

## Starters

The starters are content, not code. They live in `config/application-starters.yaml`, so adding or changing one needs no code change. Build your solution on Add application shows the first four, in file order; Browse all lists every starter, then, while the demo is enabled, the Salt Patterns templates.

The file holds one top-level `starters` list. Every field of a starter is required:

| Field | Holds |
| --- | --- |
| `slug` | Lowercase letters, digits, and hyphens, starting with a letter. Addresses name the starter by it, such as `create?starter=salt-starter`, and no two starters share one. |
| `kind` | `web`, `dashboard`, or `agent`. The Kind filter uses it. |
| `title` | 120 characters or fewer. |
| `description` | One sentence, 200 characters or fewer. |
| `preview` | An image under `public/`, from its root, such as `/starters/salt-starter.svg`. |
| `sourceUrl` | The `https` URL of the starter's own repository. |
| `steps` | How to create a repository from the starter, in order, from 1 to 20 steps. Each has `text`, and a `command` when there is one to copy. |

For example:

```yaml
starters:
  - slug: salt-starter
    kind: web
    title: Salt Starter
    description: The smallest Salt application, a single page with the Salt theme and layout.
    preview: /starters/salt-starter.svg
    sourceUrl: https://github.com/acme/salt-starter
    steps:
      - text: Create an empty repository for your application.
      - text: Copy the starter into it.
        command: git clone https://github.com/acme/salt-starter.git my-application
      - text: Enter your new repository's URL in Repository URL.
```

A starter with a missing or invalid field is left out, and the server log names the starter, the field, and the problem; the other starters still show. A file that can't be read or isn't YAML leaves Build your solution saying that starters are unavailable, while the prompt bar and Browse all keep working. In development an edit appears on the next page load; in production, after the next deploy or restart. `FABRICATE_STARTERS_FILE` points the server at another file. `npm test` fails if the committed file doesn't load four starters.

## Repository URLs

Create Application and the prompt bar accept the URL of a GitHub or Bitbucket repository, in any form Git or the provider's pages use:

| Provider | Accepted forms |
| --- | --- |
| GitHub | `https://github.com/acme/payee-hub`, with or without `.git`, and `git@github.com:acme/payee-hub.git` |
| Bitbucket Server or Data Center | The browse address `https://<host>/projects/PAY/repos/payee-hub`, the clone address `https://<host>/scm/pay/payee-hub.git`, and `ssh://git@<host>:7999/pay/payee-hub.git` |
| bitbucket.org | `https://bitbucket.org/acme/payee-hub` and `git@bitbucket.org:acme/payee-hub.git` |

A URL is refused, with the reason at the field, when it:

- includes a user name, password, or token: credentials belong to the host's configuration for DE FabLab, never to a URL, and the error doesn't repeat what was entered
- names another host, such as GitLab
- names a user, project, or page rather than one repository
- uses a transport other than `https` or `ssh`

Fabricate stores the clone URL in a normalized form, so a Bitbucket browse address and the https clone address of the same repository register the same Repository. The create form also accepts a local `file://` repository inside an allowed root (`FABRICATE_ALLOWED_ROOTS`), for development and tests; the prompt bar doesn't.

## Bitbucket hosts

A host is Bitbucket only if it's configured: GitHub is recognized by `github.com`, but a Bitbucket Server can run at any address. The hosts are `applications.bitbucketHosts` in `config/fabricate.json`:

```json
{
  "applications": {
    "bitbucketHosts": ["bitbucket.org", "bitbucket.example.com"]
  }
}
```

`FABRICATE_BITBUCKET_HOSTS` replaces the list with a comma-separated one, such as `FABRICATE_BITBUCKET_HOSTS=bitbucket.org,bitbucket.example.com`. Hosts are matched without regard to case; include the port, as in `bitbucket.example.com:8443`, only when the URLs people paste carry one. A URL on a host that isn't listed is refused as an unsupported host. `npm run config` prints the hosts in effect.
