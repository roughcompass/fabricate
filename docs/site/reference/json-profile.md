# The JSON Profile

A Repository's current Profile's fact document is readable as JSON at a stable address, with its digest.

## Address

```
GET /repositories/<id>/profile.json
```

`<id>` is the Repository's id, the `src_` id in its page's address. The address always serves the Repository's current Profile, the newest successful survey of the commit its reference names, so it changes when that does.

## Response

The body is the current Profile's fact document as stored: canonical JSON, with keys sorted and no extra whitespace, exactly as the Profile embeds it. [Fact document](fact-document.md) describes its contents, and it names its own commit, Surveyor release, and Reference Catalog entries.

| Header | Holds |
| --- | --- |
| `Content-Type` | `application/json; charset=utf-8` |
| `Digest` | The SHA-256 of the body, as 64 hexadecimal characters: the `fact_document_digest` the Profile records |
| `ETag` | The same digest, quoted |
| `Cache-Control` | `no-cache`: ask again with `If-None-Match` to learn whether it changed |

To check the body, compute its SHA-256 and compare it with `Digest`.

## Errors

| Status | Body `error` | When |
| --- | --- | --- |
| 404 | `not_found` | No registered Repository has this id, or it was deleted |
| 404 | `no_profile` | The Repository has no successful survey yet |

The body of an error is JSON with `error` and a `message` that says what happened.

## Access

The address is read-only and needs no sign-in in this release, like the rest of the Frontend Registry.
