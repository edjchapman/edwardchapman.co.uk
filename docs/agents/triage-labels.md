# Triage labels

The `/triage` skill speaks in terms of canonical triage roles. This file maps
those roles to the label strings used in this repo's GitHub issue tracker. All
seven labels exist in the repo; the mapping is identity.

## State roles

Every triaged issue carries exactly one state label.

| Canonical role    | Label in this repo | Meaning                                  |
| ----------------- | ------------------ | ---------------------------------------- |
| `needs-triage`    | `needs-triage`     | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`       | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`  | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`  | Requires human implementation            |
| `wontfix`         | `wontfix`          | Will not be actioned                     |

## Category roles

Every triaged issue also carries exactly one category label. These are
GitHub's defaults, kept as-is.

| Canonical role | Label in this repo | Meaning                    |
| -------------- | ------------------ | -------------------------- |
| `bug`          | `bug`              | Something is broken        |
| `enhancement`  | `enhancement`      | New feature or improvement |

Other labels (`production`, `documentation`, `dependencies`, ...) are
orthogonal to triage and may sit alongside the two triage labels.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding label string from these tables.
