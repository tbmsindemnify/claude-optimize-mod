import type { EngineInterface, Hook, ToolCallResult } from 'claude-code'

import { foundNothing, hostedInstead } from './search-lib'
import { isLocalFirecrawl, localTwin } from './skills-lib'
import type { Json } from './skills-lib'

// The Firecrawl MCP server running on this machine and its address, found when the thread opens.
let local: string | undefined
let url: string | undefined
export const localFirecrawl = () => local
export const localFirecrawlUrl = () => url

async function json($: EngineInterface, path: string): Promise<Json | undefined> {
  return JSON.parse(String(await $.fs.read(path).catch(() => '')) || 'null') ?? undefined
}

export async function findLocalFirecrawl($: EngineInterface) {
  const home = ((await $.env.get('HOME').catch(() => undefined)) ?? '').replace(/\/$/, '')
  const dir = (await $.session.cwd().catch(() => '')).replace(/\/$/, '')
  // Claude Code keeps its config in ~/.claude.json, or in .config.json inside its config folder where that exists.
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)) ?? `${home}/.claude`
  const configs: Json = {}
  for (const path of [`${home}/.claude.json`, `${configDir}/.config.json`]) {
    const user = await json($, path).catch(() => undefined)
    Object.assign(configs, user?.mcpServers, user?.projects?.[dir]?.mcpServers)
  }
  if (dir) Object.assign(configs, (await json($, `${dir}/.mcp.json`).catch(() => undefined))?.mcpServers)
  local = Object.keys(configs).find(name => isLocalFirecrawl(configs[name]))
  url = local && configs[local].env.FIRECRAWL_API_URL
}

// A Firecrawl call goes to the copy on this machine, which costs no credits; where that fails, or a search
// there finds nothing (it lacks the hosted service's own indexes), to the one called.
type Args = Parameters<Hook<'tool.call'>>
export async function firecrawlCall($: EngineInterface, e: Args[1], next: Args[2]): Promise<ToolCallResult> {
  const twin = localTwin(e.tool, local)
  if (!twin || !(await $.tool.list().catch(() => [])).some(tool => tool.name === twin)) return next(e)
  const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...args } = e as Json
  const result = await callTool($ as never, { ...args, tool: twin }).catch(() => undefined)
  const hasAnswer = result && !result.deny && !result.isError && !(/_search$/.test(e.tool) && foundNothing(result.text))
  return hasAnswer ? result : hostedInstead(await next(e), 'Firecrawl', e.tool)
}

// `$.tool.call` by a name the types may not list, typed loosely: checking it against every connected tool is too deep.
async function callTool($: { tool: { call: (input: Json) => Promise<ToolCallResult> } }, input: Json): Promise<ToolCallResult> {
  return $.tool.call(input)
}
