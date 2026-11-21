import type { ToolCallResult } from 'claude-code'

// Web searches that are no Firecrawl call, answered on your own computer: by the local Firecrawl
// (firecrawl.ts finds it), and by a local server that speaks Exa's API (local-exa/ in this repo), whose
// address is OPTIMIZE_EXA_URL in the session's environment.
// Pure helpers; the hook that reaches `$` is in register.tsx.

type Args = Record<string, any>
type Engine = {
  name: 'Firecrawl' | 'Exa'
  path: string
  // The hosted service's own search tool, on whatever MCP server: its calls already carry this engine's request.
  // Firecrawl has none here: firecrawl.ts sends a hosted Firecrawl's calls to the local one.
  tool?: string
  // The request for a plain search: the query, and the sites to keep to or leave out.
  plain: (query: string, includeDomains?: string[], excludeDomains?: string[]) => Args
  hits: (reply: Args) => { title: string; url: string; snippet?: string }[]
}

const ENGINES: Engine[] = [
  {
    name: 'Firecrawl',
    path: '/v2/search',
    plain: (query, includeDomains, excludeDomains) => ({ query, limit: 8, includeDomains, excludeDomains }),
    hits: reply => (reply.data?.web ?? []).map((hit: Args) => ({ title: hit.title, url: hit.url, snippet: hit.description })),
  },
  {
    name: 'Exa',
    path: '/search',
    tool: 'web_search_exa',
    plain: (query, includeDomains, excludeDomains) => ({ query, numResults: 8, includeDomains, excludeDomains, contents: { highlights: true } }),
    hits: reply => (reply.results ?? []).map((hit: Args) => ({ title: hit.title, url: hit.url, snippet: hit.highlights?.join(' … ') })),
  },
]

// The tools whose calls are web searches: Claude Code's own, and each hosted service's on any MCP server.
export const SEARCH_TOOLS = /^(WebSearch|mcp__.+__web_search_exa)$/

// The local engines a tool call's search goes to, in order: Claude Code's own WebSearch tries each,
// a hosted service's search tool goes to its local twin alone, and any other tool to none.
export function enginesFor(tool: string): Engine[] {
  return ENGINES.filter(engine => tool === 'WebSearch' || (engine.tool && tool.endsWith(`__${engine.tool}`)))
}

// What `engine` is asked for the call: WebSearch's query and site lists in the engine's own words, or
// the hosted tool's arguments as they came.
export const searchBody = (engine: Engine, tool: string, args: Args): Args =>
  tool === 'WebSearch' ? engine.plain(args.query, args.allowed_domains, args.blocked_domains) : args

// The engine's reply as the called tool answers: WebSearch's own record, or the reply itself for a
// hosted service's tool. Undefined when the reply holds no results, so the search goes on elsewhere.
export function searchResult(engine: Engine, tool: string, query: string, toolUseId: string, text: string, seconds: number): unknown {
  let hits: ReturnType<Engine['hits']> = []
  try {
    hits = engine.hits(JSON.parse(text))
  } catch {}
  if (hits.length === 0) return undefined
  return tool === 'WebSearch' ? { query, results: [{ tool_use_id: toolUseId, content: hits }], durationSeconds: seconds } : text
}

// The called tool's own answer where nothing local had one, with a note for Claude to say so.
export const hostedInstead = (ran: ToolCallResult, local: string, tool: string): ToolCallResult =>
  ran.deny !== undefined ? ran : { ...ran, context: [...(ran.context ?? []), `The local ${local} had no answer, so this call ran on ${tool} instead. Tell the user so.`] }
