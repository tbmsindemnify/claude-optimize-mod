# Optimize — a Claude Code mod

One button above Claude Code's prompt box that makes every prompt cheaper and better.

Press **Optimize** (or type `/optimize your rough prompt`) and it:

1. **Rewrites your prompt** the way Claude Code's own docs recommend: clear outcome, a way to check the work, the right amount of planning, nothing invented. The rewrite lands back in your prompt box for you to read and send.
2. **Picks the model, effort and skill with Jev.** [Jev](https://docs.typesafe.ai) (TypeSafe's typed-judgment model) reads the prompt and the recent conversation and decides:
   - the **task type**, from a benchmark-backed routing table (25 task types: agentic coding, scoped bug fix, large codebase change, knowledge work, security research, hard math…);
   - whether it's a **long task**;
   - which of your installed **skills** fits, if any.

   Code then applies the table's rules: the best-value model runs the task; a long task **plans on the best-quality model and switches to the value model mid-task** for the remaining steps (one switch, so the cache is re-read once); OpenAI-only wins (e.g. security research, hard math) are handed to **OpenAI Codex** with results reported back into the same thread. The hand-off needs the Codex CLI and a `codex-build` skill in your session; without them those tasks stay on Claude. The pick shows in a toast, e.g. `Jev: large_codebase_changes (99%) · long task: plans on Opus 5.5 (medium), then Sonnet 5.5 (xhigh) runs the steps.`
3. **Saves credits on your whole setup**, automatically when a thread opens and again on every press:
   - adds deny rules so Claude never reads `node_modules`, build output, lockfiles, `.env` files and the like (undo in the Save credits pane);
   - compacts the thread once it passes half the context window or 150K tokens, keeping decisions, open tasks, paths, commands and errors;
   - once a day, switches off plugins that no chat has used in 14 days (those that only add skills, commands or agents; one press in the Save credits pane turns one back on), and switches one back on by itself when a prompt you optimize needs it;
   - once a day, flags MCP servers you haven't used, idle plugins that run hooks or servers, missing context-mode and RTK, and CLAUDE.md files over 200 lines (and offers to move sections out).
4. Keeps your **skills up to date** from Anthropic's official marketplace and offers new ones from Anthropic's skills repo. New skill plugins install switched off, so they cost nothing until a prompt needs one.

Beside the button, a one-bar **cache meter** shows how warm the prompt cache is and how long it has left.

## Install

```bash
git clone https://github.com/tbmsindemnify/claude-optimize-mod ~/.claude/mods/optimize
```

Then add the mod to `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/home/YOU/.claude/mods/optimize",
    "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"
  }
}
```

Start a new Claude Code session (terminal or desktop app). The Optimize button appears above the prompt box.

### Turn on Jev routing (optional)

Without a key everything else works and routing is skipped. With one:

1. Get a key at [console.typesafe.ai](https://console.typesafe.ai/keys).
2. Save it where only you can read it:

   ```bash
   mkdir -p ~/.config/typesafe && read -rsp 'TypeSafe key: ' k && (umask 077; printf %s "$k" > ~/.config/typesafe/key) && echo saved
   ```

Each routing call is one small Jev request (task type, long-task check and skill pick together).

### Use your own routing table

`hooks/route-table.ts` is generated from a Google Sheet with a **Routing** tab (`task_id, task, route_here_when, primary_api_id, primary_effort, value_api_id, value_effort, confidence`). The default is the author's *Frontier Model Routing — Anthropic vs OpenAI (Oct 2026)* sheet. To use your own, change `SHEET` in `scripts/sync-routing.py` and run:

```bash
python3 ~/.claude/mods/optimize/scripts/sync-routing.py
```

Rules the code applies on top of the table: the value pick runs the task; a long task plans on the primary model first; Sonnet's effort tops out at `xhigh`; Haiku is skipped once a thread passes 100K tokens; a low-confidence row (or a task type Jev is under 40% sure of) falls back to the general row; past 150K tokens of context the session keeps its current model, since a fresh model would re-read everything uncached.

## Files

| Path | What it is |
|---|---|
| `hooks/register.tsx` | The mod: button, `/optimize`, rewrite, routing hooks, credit savers |
| `hooks/route-lib.ts` | Jev questions and the routing rules (pure) |
| `hooks/route-table.ts` | Generated routing table |
| `hooks/credits-lib.ts`, `hooks/skills-lib.ts` | Pure helpers for the credit savers and skills |
| `hooks/*.tsx` | The button, cache meter and usage row |
| `scripts/sync-routing.py` | Refreshes the routing table from the sheet |

## License

MIT
