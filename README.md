# Optimize — a Claude Code mod

One button above Claude Code's prompt box that makes every prompt cheaper and better.

Press **Optimize** (or type `/optimize your rough prompt`) and it:

1. **Rewrites your prompt** the way Anthropic's own docs recommend: clear outcome, a way to check the work, the right amount of planning, nothing invented. The rewrite lands back in your prompt box for you to read and send.
2. **Picks the Claude model and effort for the task.** The same rewrite call says what kind of task the prompt is (25 task types from a benchmark-backed routing table: scoped bug fix, large codebase change, knowledge work, hard math…) and whether it's a long task. Code then applies the table's rules: the best-value Claude model runs the task (Haiku 5.5, Sonnet 5.5, Opus 5.5 or Fable 5.2), and a long task **plans on the stronger model and switches to the value model mid-task** for the remaining steps (one switch, so the cache is re-read once). The pick shows with the rewrite, e.g. `Claude: large_codebase_changes · long task: plans on Opus 5.5 (medium), then Sonnet 5.5 (xhigh) runs the steps.` It needs no key and no extra model call.
3. **Names the right tools and skills.** The rewrite reads your installed skills and the MCP servers connected to the session (web search, databases, email, browsers…) and names the one the work needs, e.g. `Use execute_sql to count them, changing nothing`, so Claude Code calls it instead of working without it. The skill that fits is added as `Use the pptx skill.`, the picks show beside the model (`… · Sonnet 5.5 · medium effort · skill: pptx` or `· tools: firecrawl_search`), and a switched-off plugin the prompt needs is switched on.
4. **Keeps its prompting rules current, daily.** Once a day the mod reads Anthropic's prompting pages ([Claude Code best practices](https://code.claude.com/docs/en/best-practices) and [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)) and, when they have changed, has Claude bring the rewrite's rules up to date with them. `/optimize-rules` shows the rules in use and their date; `/optimize-rules update` checks now. It runs on your own computer on your Claude plan: no key, no server.
5. **Runs web searches on your own Firecrawl, free.** When a [self-hosted Firecrawl](https://docs.firecrawl.dev/contributing/self-host) is connected beside the hosted one, every Firecrawl call (search, scrape, map, crawl…) goes to the copy on your machine, optimized prompt or not, and the rewrite names its tools. Only when the local call fails (a site that blocks it, a tool it lacks) or a local search finds nothing (the hosted service's own indexes) does the call go on to the hosted Firecrawl. Claude Code's built-in WebSearch goes to your Firecrawl too, and to a local stand-in for Exa if you run the one in this repo. See [Free web search on your own machine](#free-web-search-on-your-own-machine).
6. **Saves credits on your whole setup**, automatically when a thread opens and again on every press:
   - adds deny rules so Claude never reads `node_modules`, build output, lockfiles, `.env` files and the like (undo in the Save credits pane);
   - compacts the thread once it passes half the context window or 150K tokens, keeping decisions, open tasks, paths, commands and errors;
   - once a day, switches off plugins that no chat has used in 14 days (those that only add skills, commands or agents; one press in the Save credits pane turns one back on), and switches one back on by itself when a prompt you optimize needs it;
   - once a day, flags MCP servers you haven't used, idle plugins that run hooks or servers, missing context-mode and RTK, and CLAUDE.md files over 200 lines (and offers to move sections out).
7. Keeps your **skills up to date** from Anthropic's official marketplace and offers new ones from Anthropic's skills repo. New skill plugins install switched off, so they cost nothing until a prompt needs one.

Beside the button, a one-bar **cache meter** shows how warm the prompt cache is and how long it has left.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-transform --marketplace tbmsindemnify/claude-optimize-mod
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install prompt-transform --marketplace tbmsindemnify/claude-optimize-mod`. In the desktop app: click **+** next to the prompt box → **Plugins** → **Add marketplace** `tbmsindemnify/claude-optimize-mod` → **Add plugin**.

Or from a folder you keep, to change the code yourself:

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

### Free web search on your own machine (optional)

Run Firecrawl yourself ([self-hosting guide](https://docs.firecrawl.dev/contributing/self-host); Docker), then connect its MCP server pointed at it:

```bash
claude mcp add firecrawl-local -s user -e FIRECRAWL_API_URL=http://127.0.0.1:3002 -- npx -y firecrawl-mcp
```

Use the port your Firecrawl listens on. Any MCP server whose `FIRECRAWL_API_URL` is on `localhost` or `127.0.0.1` counts as local; the mod finds it when a thread opens. Keep the hosted Firecrawl connected too, if you have it: it is the fallback for sites that block the local one.

Claude Code's built-in `WebSearch` goes to that Firecrawl too, so a plain "search the web" prompt stays on your machine.

**A local Exa.** Exa itself is hosted only, so `local-exa/` in this repo is a small stand-in that answers Exa's `POST /search`: it finds pages through your own [SearXNG](https://docs.searxng.org) (with the `json` format switched on) and re-orders them by meaning with a small embedding model on the CPU. Start it with `cd local-exa && docker compose up -d` (Linux; elsewhere run `server.py` with `fastembed` installed). It listens on `127.0.0.1:3303`, `SEARXNG_URL` says where SearXNG is (default `http://127.0.0.1:8888`), and `docker compose logs` shows a line for each search. Its pages are SearXNG's, not Exa's index, and it reads `query`, `numResults`, `includeDomains`, `excludeDomains` and `contents.text`. Tell the mod where it is with `"OPTIMIZE_EXA_URL": "http://127.0.0.1:3303"` in the `env` of `~/.claude/settings.json`; any server that answers Exa's `POST /search` works there.

| The call | Goes to |
|---|---|
| a hosted Firecrawl tool (search, scrape, map, crawl…) | the same tool on the local Firecrawl |
| Claude Code's built-in `WebSearch` | the local Firecrawl, then the local Exa |
| a hosted Exa's `web_search_exa` | the local Exa |

When nothing local has an answer (it is down, or finds nothing), the tool that was called runs as usual and Claude says so in its reply.

### Let Jev judge the task (optional)

Without a key the rewrite itself names the task type and the skill. With a [TypeSafe](https://docs.typesafe.ai) key, Jev (TypeSafe's typed-judgment model) makes that judgment instead, in one small request beside the rewrite, and the pick reads `Jev: bug_fix_scoped (83%) · …`:

1. Get a key at [console.typesafe.ai](https://console.typesafe.ai/keys).
2. Save it where only you can read it:

   ```bash
   mkdir -p ~/.config/typesafe && read -rsp 'TypeSafe key: ' k && (umask 077; printf %s "$k" > ~/.config/typesafe/key) && echo saved
   ```

### Hand OpenAI's wins to Codex (optional)

The routing table compares Anthropic's and OpenAI's models. By default every task runs on a Claude model. To hand the task types the table gives to OpenAI (e.g. security research, hard math) to **OpenAI Codex**, with the results reported back into the same thread, set `"OPTIMIZE_CODEX": "1"` in the `env` of `~/.claude/settings.json`; it needs the Codex CLI and a `codex-build` skill in your session.

### Use your own routing table

`hooks/route-table.ts` is generated from a Google Sheet with a **Routing** tab (`task_id, task, route_here_when, primary_api_id, primary_effort, value_api_id, value_effort, confidence`). The default is the author's *Frontier Model Routing — Anthropic vs OpenAI (Oct 2026)* sheet. To use your own, change `SHEET` in `scripts/sync-routing.py` and run:

```bash
python3 ~/.claude/mods/optimize/scripts/sync-routing.py
```

Rules the code applies on top of the table: the value pick runs the task; a long task plans on the primary model first; a task type the table gives to an OpenAI model runs on the row's Claude side, or on Fable 5.2 at high effort where both of its picks are OpenAI's (Anthropic's [Choosing the right model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model): the most capable model for demanding reasoning); Sonnet's effort tops out at `xhigh`; Haiku is skipped once a thread passes 100K tokens; a low-confidence row (or a task type Jev is under 40% sure of) falls back to the general row; past 150K tokens of context the session keeps its current model, since a fresh model would re-read everything uncached.

## Files

| Path | What it is |
|---|---|
| `hooks/register.tsx` | The mod: button, `/optimize`, rewrite, routing hooks, credit savers |
| `hooks/route-lib.ts` | The routing rules, and the questions put to Jev (pure) |
| `hooks/guidance-lib.ts` | The daily update of the prompting rules (pure) |
| `hooks/route-table.ts` | Generated routing table |
| `hooks/firecrawl.ts` | Sends Firecrawl calls to the local copy, with the hosted one as fallback |
| `hooks/credits-lib.ts`, `hooks/skills-lib.ts` | Pure helpers for the credit savers and skills |
| `hooks/search-lib.ts` | Which local search engine answers a web search, and in what shape (pure) |
| `local-exa/` | The local stand-in for Exa's search API: `server.py`, its Dockerfile and compose file |
| `hooks/*.tsx` | The button, cache meter and usage row |
| `scripts/sync-routing.py` | Refreshes the routing table from the sheet |

## License

MIT
