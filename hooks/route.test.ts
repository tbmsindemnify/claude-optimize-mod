import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { decideRoute, ownAnswers } from './route-lib'
import { toolCatalogue } from './skills-lib'

const RUN = { command: 'optimize', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 100 } }
const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// The pick for a task type as the rewrite's own tags name it, with no Codex hand-off.
const pick = (task: string, isLong = false, hasCodex = false) =>
  decideRoute(ownAnswers(`<optimized_prompt>x</optimized_prompt><task>${task}</task><long>${isLong ? 'yes' : 'no'}</long>`), 0, hasCodex, 'Claude')

test('each kind of task runs on the Claude model and effort the routing table gives it', () => {
  expect(pick('bug_fix_scoped')).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', execModel: null })
  expect(pick('high_volume_simple')).toMatchObject({ model: 'claude-haiku-5-5' })
  expect(pick('knowledge_work_docs')?.note).toBe('Claude: knowledge_work_docs · Sonnet 5.5 · medium effort.')
  expect(pick('made_up_task')).toBeNull()
})

test('a long task plans on the stronger model, then the value model runs the steps', () => {
  expect(pick('large_codebase_changes', true)).toMatchObject({
    model: 'claude-opus-5-5',
    effort: 'medium',
    execModel: 'claude-sonnet-5-5',
    execEffort: 'xhigh',
  })
})

test("a task the table gives to OpenAI runs on Claude: the row's Claude side, else Claude's most capable model", () => {
  expect(pick('hard_math')).toMatchObject({ model: 'claude-fable-5-2', effort: 'high', codexModel: null })
  expect(pick('security_research')).toMatchObject({ model: 'claude-fable-5-2', codexModel: null })
  expect(pick('business_automation')).toMatchObject({ model: 'claude-opus-5-5', codexModel: null })
  // A row the table is unsure of falls back to the general row, as before.
  expect(pick('web_research_browsing')?.note).toBe('Claude: web_research_browsing → general · Sonnet 5.5 · medium effort.')
  // The hand-off to Codex happens only when it is switched on.
  expect(pick('hard_math', false, true)).toMatchObject({ model: 'claude-sonnet-5-5', codexModel: 'gpt-6-astra' })
})

test('the MCP tools are listed by server, without Claude Code\'s own tools', () => {
  const tools = [
    { name: 'Read', description: 'Reads a file', mcp: false },
    { name: 'mcp__firecrawl__firecrawl_search', description: 'Search the web', mcp: true },
    { name: 'mcp__firecrawl__firecrawl_scrape', description: 'Scrape a page', mcp: true },
    { name: 'mcp__plugin_shop_store__get-order', description: 'An order', mcp: true },
  ]
  expect(toolCatalogue(tools)).toEqual([
    { name: 'firecrawl', description: 'firecrawl_search, firecrawl_scrape' },
    { name: 'plugin_shop_store', description: 'get-order' },
  ])
})

// A session with no TypeSafe key, whose rewrite answers with `reply`.
function session(on: On, reply: string, env: Record<string, string> = {}) {
  const asked: { system: string; prompt: string }[] = []
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/dev', ...env })
  on('command.list', () => ({ value: [{ name: 'codex-build', description: 'Hand work to Codex', source: 'user' as const }] }))
  on('tool.list', () => ({ value: [{ name: 'mcp__supabase__execute_sql', description: 'Run SQL', mcp: true }] }))
  on('model.complete', (_, e) => {
    asked.push({ system: String(e.system), prompt: String(e.prompt) })
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  on('prompt.fill', () => ({ isFilled: true }))

  return asked
}

// Sends the next prompt: its turn starts and makes its first model request.
async function send($: Engine) {
  await $.turn.start({ turnId: 't1', text: 'the optimized prompt' })
  const step = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 })
  for await (const _ of step) {
  }
  await step.result
}

test('with no key the rewrite names the task, and the next prompt runs on the model picked for it', async ($, on) => {
  const asked = session(on, '<optimized_prompt>Rename the field in every file.</optimized_prompt>\n<task>high_volume_simple</task>\n<long>no</long>')
  const sent: { model: string; effort?: unknown }[] = []
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: 'Done.', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: e.model } }
  })

  const result = await $.command.run({ ...RUN, args: 'rename the field everywhere' })

  expect(asked[0]?.system).toContain('<routing>')
  expect(asked[0]?.system).toContain('- high_volume_simple: ')
  expect(asked[0]?.prompt).toContain('<tools>\n- supabase: execute_sql\n</tools>')
  expect(result.text).toContain('Claude: high_volume_simple · Haiku 5.5 · low effort.')
  await send($)
  expect(sent).toEqual([{ model: 'claude-haiku-5-5', effort: 'low' }])
})

test('a task the table gives to OpenAI stays on Claude unless the Codex hand-off is switched on', async ($, on) => {
  const reply = '<optimized_prompt>Prove the bound.</optimized_prompt><task>hard_math</task><long>no</long>'
  session(on, reply)
  expect((await $.command.run({ ...RUN, args: 'prove it' })).text).toContain('Claude: hard_math · Fable 5.2 · high effort.')
})

test('with the Codex hand-off switched on, the same task is handed to Codex', async ($, on) => {
  session(on, '<optimized_prompt>Prove the bound.</optimized_prompt><task>hard_math</task><long>no</long>', { OPTIMIZE_CODEX: '1' })
  expect((await $.command.run({ ...RUN, args: 'prove it' })).text).toContain('hand-off to Codex on GPT-6 Astra')
})

test('the skill the rewrite names is loaded when the session has it, and ignored when it does not', async ($, on) => {
  const reply = (skill: string) => `<optimized_prompt>Build the deck.</optimized_prompt><task>knowledge_work_docs</task><long>no</long><skill>${skill}</skill>`
  const answers = { value: reply('codex-build') }
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/dev' })
  on('command.list', () => ({ value: [{ name: 'codex-build', description: 'Hand work to Codex', source: 'user' as const }] }))
  on('tool.list', () => ({ value: [{ name: 'mcp__supabase__execute_sql', description: 'Run SQL', mcp: true }] }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: answers.value, usage: USAGE } }))
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  expect((await $.command.run({ ...RUN, args: 'deck' })).text).toContain('Sonnet 5.5 · medium effort · skill: codex-build.')
  expect(filled[0]).toBe('Build the deck.\n\nUse the codex-build skill.')

  // The tools it names are added the same way: those the session has, and only where the prompt lacks them.
  answers.value = `${reply('none')}<use_tools>execute_sql, drop_database</use_tools>`
  expect((await $.command.run({ ...RUN, args: 'deck' })).text).toContain('Sonnet 5.5 · medium effort · tools: execute_sql.')
  expect(filled[1]).toBe('Build the deck.\n\nTools to use: execute_sql.')

  answers.value = reply('made-up-skill')
  expect((await $.command.run({ ...RUN, args: 'deck' })).text).toContain('Sonnet 5.5 · medium effort.')
  expect(filled[2]).toBe('Build the deck.')
})

test('a reply without the task tags still fills the prompt, and the session keeps its model', async ($, on) => {
  session(on, 'Clear prompt.<task>bug_fix_scoped')
  const result = await $.command.run({ ...RUN, args: 'rough' })
  expect(result.text).toBe('Optimized your prompt. It is in the prompt box: edit it, or press Return to send.')
})
