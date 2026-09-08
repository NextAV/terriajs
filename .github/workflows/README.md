# Workflows on this fork

This is a **pinned vendor branch**, not a living fork. Measured 2026-09-08:
`wmts-time-bridge-8.12.2` is **35 commits ahead of and 3,346 behind**
`TerriaJS/terriajs@main`. We do not merge upstream; the viewer consumes this
branch by an exact lock SHA.

So upstream's automation is code we **vendor, not code we run**. Three of its
workflows were removed on this branch, deliberately and in code:

| removed           | why                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`          | Structurally un-greenable here. It dies at `prettier --check .` on 7 files this fork modified, and would then fail 10 Cesium 3D-interaction specs that need real hardware WebGL — measured identically on a GitHub runner (1651 specs, 10 failures) and locally. A permanently red gate is worse than none: it teaches everyone to skim past the row. `fork-gate.yml` covers the same ground in a way that can actually pass. |
| `deploy.yml`      | `on: push`, unconditional, deploys upstream's TerriaMap. Nothing here deploys.                                                                                                                                                                                                                                                                                                                                                |
| `npm-publish.yml` | Publishes the `terriajs` npm package on any push to the default branch. Inert today only by accident — `package.json` is 8.12.2, which npm already has, so its own `should_publish` gate returns false. A version bump would make it live, and relying on a coincidence is not a control.                                                                                                                                     |

`find-region-mapping-alias-duplicates.yml` is **kept**: it is paths-filtered to
`wwwroot/data/regionMapping.json`, so it costs nothing until that file changes,
and it is a real check that can pass. Removing working things for symmetry is
not the point.

## Why in code rather than the "disable workflow" button

Those three were also disabled through the API, which writes `disabled_manually`
into GitHub's database. That state is invisible to anyone reading the repo, and
it is keyed by workflow **ID** — rename or move a file and it registers fresh
and ACTIVE. Same class as a console-created cloud resource: drift that does not
declare itself. Deleting the files is the version a reviewer can see, `git blame`
can explain, and a re-fork inherits.

Both controls are left in place; they fail independently.

## The gate that remains

`fork-gate.yml` — blocking on TypeScript (`lib/` and `test/` only, since the
repo's tsconfig drags a pre-existing error out of `node_modules/webpack`) and on
prettier **for the files a PR touches**. The full spec suite runs alongside as
information, against a recorded 1651-spec / 10-failure baseline, so a NEW
failure is visible without the gate being red on the old ones.

## The real fix, which this is not

Owning the workflow surface makes the symptom go away. The disease is the
divergence itself: 35 commits across 49 files, most of them **generic** TerriaJS
improvements (bar-chart series type, bounded chart zoom, nearest-first vector
pick ordering, `hideOutsideDiscreteTimes`, period-containment bar snapping).
Every one upstreamed is one we stop maintaining, and anything genuinely
NextAV-specific belongs in the consuming viewer where an extension point allows.
Being 3,346 behind is the compounding cost of not having done that.
