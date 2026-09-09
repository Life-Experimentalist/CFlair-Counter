# Agent harness files

Three copy-in files that teach a coding agent how to talk to a ViewFlare
instance. They are for **your** project, the one being measured, not for the
ViewFlare repository itself.

All three carry the same body, because the real contract lives on the
deployment: each file's first instruction is to fetch `/llms.txt` and
`/openapi.yaml` from your instance. That means these files do not go stale when
the API grows, and one instance can serve agents that have never seen this
repository.

## Where each file goes

| Harness                              | Destination in your repo               | Source file                |
| ------------------------------------ | -------------------------------------- | -------------------------- |
| Codex, Cursor, Windsurf, Antigravity | `AGENTS.md`                            | `AGENTS.md`                |
| GitHub Copilot                       | `.github/instructions/viewflare.instructions.md` | `copilot.instructions.md`  |
| Amazon Kiro                          | `.kiro/steering/viewflare.md`          | `kiro-viewflare.md`        |
| Claude Code                          | install the plugin instead, see below  |                            |
| Anything else with a fetch tool      | point it at `https://<instance>/llms.txt` |                         |

`AGENTS.md` is read by Codex, Cursor and Windsurf, by Antigravity since v1.20.3,
and by GitHub Copilot's agent mode. If you only install one file, install that
one.

## Installing

`AGENTS.md` usually already exists in a project, so **append** rather than
overwrite:

```bash
curl -sL https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/integrations/agents/AGENTS.md >> AGENTS.md
```

The other two are files of their own, so a plain download is safe:

```bash
mkdir -p .github/instructions && curl -sL https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/integrations/agents/copilot.instructions.md -o .github/instructions/viewflare.instructions.md
```

```bash
mkdir -p .kiro/steering && curl -sL https://raw.githubusercontent.com/Life-Experimentalist/ViewFlare/main/integrations/agents/kiro-viewflare.md -o .kiro/steering/viewflare.md
```

If you would rather keep everything in one Copilot file, append
`copilot.instructions.md` to an existing `.github/copilot-instructions.md` and
delete the `applyTo` frontmatter block from what you pasted; that file is
repository-wide and takes no frontmatter.

## After installing

Replace `<instance>` and `<project>` in the file you copied, or leave them and
tell the agent the values once. The files are written so an agent that reads
them will ask for the host rather than guess one.

## Claude Code

Claude Code gets a skill instead of a rules file, because the skill can run the
deploy for you as well as wire up the calls:

```
/plugin marketplace add Life-Experimentalist/ViewFlare
/plugin install viewflare-integration@viewflare
```

The skill lives at `skills/viewflare-integration/SKILL.md` in this repository.

## Frontmatter notes

`copilot.instructions.md` carries `applyTo: "**"`, which is what
`.github/instructions/*.instructions.md` requires; narrow the glob if you only
want it loaded for certain paths.

`kiro-viewflare.md` carries `inclusion: auto`, so Kiro pulls it in when the
description matches what you are doing rather than prepending it to every
request. Change it to `always` if you want it loaded unconditionally.
