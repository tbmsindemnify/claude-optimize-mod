import type { On, ToolCallResult } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { isLocalFirecrawl, localTwin, toolCatalogue } from './skills-lib'

const LOCAL = { command: 'npx', args: ['-y', 'firecrawl-mcp'], env: { FIRECRAWL_API_URL: 'http://127.0.0.1:3302' } }
const TOOLS = [
  { name: 'mcp__firecrawl__firecrawl_search', description: 'Search the web', mcp: true },
  { name: 'mcp__firecrawl-local__firecrawl_search', description: 'Search the web', mcp: true },
  { name: 'mcp__firecrawl__firecrawl_extract', description: 'Extract', mcp: true },
]

test('only a Firecrawl pointed at this machine counts as local', () => {
  expect(isLocalFirecrawl(LOCAL)).toBe(true)
  expect(isLocalFirecrawl({ env: { FIRECRAWL_API_URL: 'http://localhost/' } })).toBe(true)
  expect(isLocalFirecrawl({ env: { FIRECRAWL_API_KEY: 'fc-x' } })).toBe(false)
  expect(isLocalFirecrawl({ env: { FIRECRAWL_API_URL: 'https://api.firecrawl.dev' } })).toBe(false)
  expect(isLocalFirecrawl({ env: { FIRECRAWL_API_URL: 'http://localhost.evil.com' } })).toBe(false)
})

test('a cloud Firecrawl call has a local twin; other tools and the local server do not', () => {
  expect(localTwin('mcp__firecrawl__firecrawl_search', 'firecrawl-local')).toBe('mcp__firecrawl-local__firecrawl_search')
  expect(localTwin('mcp__firecrawl-local__firecrawl_search', 'firecrawl-local')).toBeUndefined()
  expect(localTwin('mcp__supabase__execute_sql', 'firecrawl-local')).toBeUndefined()
  expect(localTwin('mcp__firecrawl__firecrawl_search', undefined)).toBeUndefined()
})

test('the rewrite is offered the local Firecrawl, and the cloud only for what local lacks', () => {
  expect(toolCatalogue(TOOLS, 'firecrawl-local')).toEqual([
    { name: 'firecrawl-local', description: 'firecrawl_search' },
    { name: 'firecrawl', description: 'firecrawl_extract' },
  ])
})

// A thread opened with a local Firecrawl configured, whose own tool answers `local`.
async function opened($: Engine, on: On, local: ToolCallResult) {
  const calls: string[] = []
  mock.clock(on)
  mock.env(on, { HOME: '/home/dev' })
  on('fs.read', (_, e) => ({ value: e.path === '/home/dev/.claude/.config.json' ? JSON.stringify({ mcpServers: { 'firecrawl-local': LOCAL } }) : '' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.list', () => ({ value: TOOLS }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    calls.push(e.tool)
    return e.tool.includes('local') ? local : ({ result: 'cloud' } as ToolCallResult)
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  return calls
}

// A call by a name the types do not list, as a connected MCP server's tool is.
type Caller = { tool: { call: (input: object) => Promise<ToolCallResult> } }
const call = ($: Engine, tool: string, args: Record<string, unknown>) => ($ as unknown as Caller).tool.call({ ...args, tool })

test('a cloud Firecrawl search runs on the local one', async ($, on) => {
  const calls = await opened($, on, { result: 'local' } as ToolCallResult)
  const reply = await call($, 'mcp__firecrawl__firecrawl_search', { query: 'hail austin' })
  expect(reply.result).toBe('local')
  expect(calls).toEqual(['mcp__firecrawl-local__firecrawl_search'])
})

test('where the local one fails, the call goes on to the cloud', async ($, on) => {
  const calls = await opened($, on, { result: 'blocked', isError: true } as ToolCallResult)
  const reply = await call($, 'mcp__firecrawl__firecrawl_search', { query: 'hail austin' })
  expect(reply.result).toBe('cloud')
  expect(calls).toEqual(['mcp__firecrawl-local__firecrawl_search', 'mcp__firecrawl__firecrawl_search'])
})

test('a tool the local one lacks goes straight to the cloud', async ($, on) => {
  const calls = await opened($, on, { result: 'local' } as ToolCallResult)
  await call($, 'mcp__firecrawl__firecrawl_extract', { prompt: 'x' })
  expect(calls).toEqual(['mcp__firecrawl__firecrawl_extract'])
})
