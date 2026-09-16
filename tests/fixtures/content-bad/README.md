# Known-bad guides

Eight documents the content check must reject (§5.1, §5.8 AC1). Each folder is
an overlay: `tests/unit/content/check.test.ts` and
`tests/integration/content/schema.test.ts` copy the real `content/`,
`messages/` and `components/illustrations/` into a temporary directory, copy
one of these folders over it, run `runContentCheck` and expect a
`file:line: message` naming the fixture.

| Folder                 | Mode       | Broken rule                                             |
| ---------------------- | ---------- | ------------------------------------------------------- |
| `bad-partId`           | default    | `partIds` names a part that does not exist              |
| `bad-illustration`     | default    | a step's `illustration` is not in the registry          |
| `bad-tool`             | default    | a `toolId` is not in the tool catalogue                 |
| `step-mismatch`        | default    | `<Step id>` order differs from `steps[].id`             |
| `ko-without-guide`     | default    | a `replace` consequence has no `guideSlug`              |
| `ko-kind-mismatch`     | default    | a `replace` consequence points at a `clean` guide       |
| `missing-safety-ebike` | `--strict` | a guide touching the battery has no battery safety note |
| `short-check-step`     | `--strict` | a checked step's body is shorter than 40 words          |

These files are never read by the real content check (it only looks at
`content/guides/`).
