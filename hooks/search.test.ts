import type { On, ToolCallResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const FIRECRAWL = 'http://127.0.0.1:3002'
const EXA = 'http://127.0.0.1:3303'
const FIRECRAWL_REPLY = JSON.stringify({ success: true, data: { web: [{ title: 'Hail map', url: 'https://a.example', description: 'Hail on the 3rd' }] } })
const EXA_REPLY = JSON.stringify({ results: [{ title: 'Roof guide', url: 'https://b.example', highlights: ['Shingles', 'Decking'] }] })

// A thread opened with a local Firecrawl configured and the local Exa's address set, each answering
// with its reply (undefined: it is down), over tools that answer 'hosted'. Returns the requests the
// engines got and the tools that ran.
async function opened($: Engine, on: On, replies: Record<string, string | undefined>, env: Record<string, string> = { OPTIMIZE_EXA_URL: `${EXA}/` }) {
  const asked: { url: string; body: unknown }[] = []
  const ran: string[] = []
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/home/dev', ...env })
  const config = { mcpServers: { 'firecrawl-local': { command: 'npx', env: { FIRECRAWL_API_URL: FIRECRAWL } } } }
  on('fs.read', (_, e) => ({ value: e.path === '/home/dev/.claude/.config.json' ? JSON.stringify(config) : '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.list', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    asked.push({ url: e.url, body: JSON.parse(String(e.init?.body)) })
    const text = replies[e.url]
    if (text === undefined) throw new Error('connection refused')
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
  on('tool.call', (_, e) => {
    ran.push(e.tool)
    return { result: 'hosted' } as ToolCallResult
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  return { asked, ran }
}

// A call by a name the types do not list, as a connected MCP server's tool is.
type Caller = { tool: { call: (input: object) => Promise<ToolCallResult> } }
const call = ($: Engine, tool: string, args: Record<string, unknown>) => ($ as unknown as Caller).tool.call({ ...args, tool })

test('WebSearch is answered by the local Firecrawl, and the tool itself never runs', async ($, on) => {
  const { asked, ran } = await opened($, on, { [`${FIRECRAWL}/v2/search`]: FIRECRAWL_REPLY })

  const answer = await $.tool.call({ tool: 'WebSearch', query: 'hail in Dallas', allowed_domains: ['noaa.gov'] })

  expect(asked).toEqual([{ url: `${FIRECRAWL}/v2/search`, body: { query: 'hail in Dallas', limit: 8, includeDomains: ['noaa.gov'] } }])
  expect(answer.result).toMatchObject({ query: 'hail in Dallas', results: [{ content: [{ title: 'Hail map', url: 'https://a.example', snippet: 'Hail on the 3rd' }] }] })
  expect(ran).toEqual([])
})

test('with the local Firecrawl down, WebSearch is answered by the local Exa', async ($, on) => {
  const { asked, ran } = await opened($, on, { [`${EXA}/search`]: EXA_REPLY })

  const answer = await $.tool.call({ tool: 'WebSearch', query: 'roof decking' })

  expect(asked.map(request => request.url)).toEqual([`${FIRECRAWL}/v2/search`, `${EXA}/search`])
  expect(asked[1]?.body).toEqual({ query: 'roof decking', numResults: 8, contents: { highlights: true } })
  expect(answer.result).toMatchObject({ results: [{ content: [{ title: 'Roof guide', snippet: 'Shingles … Decking' }] }] })
  expect(ran).toEqual([])
})

test("a hosted Exa's search tool goes to the local Exa with its own arguments", async ($, on) => {
  const { asked, ran } = await opened($, on, { [`${EXA}/search`]: EXA_REPLY })

  const answer = await call($, 'mcp__exa__web_search_exa', { query: 'roofs', numResults: 5 })

  expect(asked).toEqual([{ url: `${EXA}/search`, body: { query: 'roofs', numResults: 5 } }])
  expect(answer.result).toBe(EXA_REPLY)
  expect(ran).toEqual([])
})

test('when no local engine has results the called tool runs, with a note for Claude to say so', async ($, on) => {
  const { ran } = await opened($, on, { [`${EXA}/search`]: JSON.stringify({ results: [] }) })

  const answer = await $.tool.call({ tool: 'WebSearch', query: 'hail' })

  expect(ran).toEqual(['WebSearch'])
  expect(answer.result).toBe('hosted')
  expect(answer.context).toEqual([`The local Firecrawl at ${FIRECRAWL} and Exa at ${EXA} had no answer, so this call ran on WebSearch instead. Tell the user so.`])
})

test('with no local Exa set its search tool is left alone, and so is any other tool', async ($, on) => {
  const { asked, ran } = await opened($, on, {}, {})

  const search = await call($, 'mcp__exa__web_search_exa', { query: 'hail' })
  const other = await call($, 'mcp__exa__crawling_exa', { url: 'https://a.example' })

  expect(asked).toEqual([])
  expect(ran).toEqual(['mcp__exa__web_search_exa', 'mcp__exa__crawling_exa'])
  expect([search.context, other.context]).toEqual([undefined, undefined])
})
