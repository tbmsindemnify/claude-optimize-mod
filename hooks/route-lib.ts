import { ROUTING } from './route-table'

// A press of Optimize routes the prompt to a Claude model. The rewrite itself judges what the prompt is: its
// task type from Tyler's Frontier Model Routing sheet and whether it is a long task; with a TypeSafe key, Jev
// judges instead, and the skill that fits (Tyler, 2026-10-31). Code applies the sheet's switch rules to pick
// the model. Pure helpers; the calls live in register.tsx.

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const KEY_PATH = '.config/typesafe/key'
// A route waits this long for its prompt to be sent; a later prompt runs on the session's model.
export const ROUTE_TTL_MS = 15 * 60_000
// A skill is named in the prompt only when Jev puts at least this much probability on it.
const SKILL_MIN_PROBABILITY = 0.5
// Below this Jev isn't sure of the task type, and the sheet's general row decides (as R16 does for weak rows).
const MIN_TASK_CONFIDENCE = 0.4
// R04/R05: Haiku 5.5 bills the whole request at 5x past 100K tokens, so a longer thread stays on Sonnet.
const HAIKU_MAX_TOKENS = 100_000
const SONNET = 'claude-sonnet-5-5'
const FABLE = 'claude-fable-5-2'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

const codexLine = (model: string) =>
  `\n\nHand this to OpenAI Codex with the codex-build skill on ${model} (default service tier, never fast); ` +
  'wait for it to finish, inspect what it changed, and bring the results back into this thread.'

export const JEV_QUESTIONS = {
  task: {
    type: 'choice',
    instructions: 'Which kind of task is `prompt`, read with `conversation`?',
    criteria: Object.fromEntries(ROUTING.map(row => [row.id, row.when])),
  },
  long: {
    type: 'noul',
    instructions: 'Will carrying out `prompt` take many steps: roughly ten or more tool calls such as reading many files, editing several, or running tests repeatedly?',
  },
} as const

export function skillQuestion(skills: readonly { name: string; description: string }[]) {
  return {
    type: 'choice',
    instructions: 'Which skill should Claude load to carry out `prompt`? A skill holds the instructions for one kind of task; choose one only when its description clearly matches the work, otherwise none.',
    criteria: { none: 'No listed skill clearly fits; ordinary work', ...Object.fromEntries(skills.slice(0, 254).map(s => [s.name, s.description])) },
  }
}

export type Route = {
  model: string
  effort: Effort
  execModel: string | null
  execEffort: Effort
  codexModel: string | null
  skill: string | null
  // The MCP tools the work needs, comma-separated; empty for none.
  tools: string
  note: string
}
export type Answers = Record<string, { choice?: string; noul?: number; confidence?: number; probabilities?: Record<string, number> }>

const cap = (word: string) => word[0]!.toUpperCase() + word.slice(1)
// claude-opus-5-5 -> Opus 5.5, gpt-6.1-sol -> GPT-6.1 Sol
const nameOf = (id: string) =>
  id.replace(/^claude-(\w+)-(\d+)-(\d+)$/, (_, m, a, b) => `${cap(m)} ${a}.${b}`).replace(/^gpt-([\d.]+)-(\w+)$/, (_, v, m) => `GPT-${v} ${cap(m)}`)
// The sheet's effort ("medium (xhigh for hardest)", "none", blank) as a level; R03: Sonnet tops out at xhigh.
function effortOf(text: string, model: string): Effort {
  const effort = EFFORTS.find(level => text.startsWith(level)) ?? (text.startsWith('none') ? 'low' : 'medium')
  return model.includes('sonnet') && effort === 'max' ? 'xhigh' : effort
}

// The task types the rewrite chooses from when it judges the draft itself: the ones Jev is asked.
export const TASK_LIST = ROUTING.map(row => `- ${row.id}: ${row.when}`).join('\n')

// The rewrite's own judgment, from the <task>, <long>, <skill> and <use_tools> tags after its prompt, in the
// shape of Jev's answers; a skill or tool counts only when it is one of the session's own (`skills`, `tools`).
export function ownAnswers(reply: string, skills: readonly string[] = [], tools: readonly string[] = []): Answers {
  const tag = (name: string) => reply.match(new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`))?.[1] ?? ''
  const skill = skills.find(name => name === tag('skill'))
  return {
    task: { choice: tag('task'), confidence: 1 },
    long: { noul: tag('long').toLowerCase() === 'yes' ? 1 : 0 },
    skill: { choice: skill, probabilities: skill ? { [skill]: 1 } : {} },
    tools: { choice: tag('use_tools').split(/[\s,]+/).filter(name => tools.includes(name)).slice(0, 3).join(', ') },
  }
}

type Row = { id: string; primary: string; primaryEffort: string; value: string; valueEffort: string; confidence: string }
const isClaude = (id: string) => id.startsWith('claude-')
// The row as Claude alone runs it: its own Claude side or, where the sheet's picks are both OpenAI's, Claude's
// most capable model at its default effort (Anthropic's "Choosing the right model": demanding reasoning).
function claudeOnly(row: Row): Row {
  if (isClaude(row.value || row.primary)) return row
  return isClaude(row.primary) ? { ...row, value: '' } : { ...row, primary: FABLE, primaryEffort: 'high', value: '' }
}

// `hasCodex`: the session has the codex-build skill; without it every pick is a Claude model. `by`: who judged.
export function decideRoute(answers: Answers, contextTokens: number, hasCodex: boolean, by: 'Jev' | 'Claude' = 'Jev'): Route | null {
  const chosen: Row | undefined = ROUTING.find(row => row.id === answers.task?.choice)
  if (!chosen) return null
  const isSure = (answers.task?.confidence ?? 0) >= MIN_TASK_CONFIDENCE && chosen.confidence !== 'Low'
  const row: Row = !isSure ? ROUTING[0] : hasCodex ? chosen : claudeOnly(chosen)
  const isLong = (answers.long?.noul ?? 0) >= 0.5

  // R01 for the fewest tokens at the same quality: the value pick runs the task.
  let run: string = row.value || row.primary
  let runEffort = effortOf(row.value ? row.valueEffort : row.primaryEffort, run)
  if (run.includes('haiku') && contextTokens >= HAIKU_MAX_TOKENS) run = SONNET
  const named = answers.skill?.choice
  const skill = named && named !== 'none' && (answers.skill?.probabilities?.[named] ?? 0) >= SKILL_MIN_PROBABILITY ? named : null
  const sureness = by === 'Jev' ? ` (${Math.round(100 * (answers.task?.confidence ?? 0))}%)` : ''
  const head = `${by}: ${chosen.id}${sureness}${isSure || chosen === ROUTING[0] ? '' : ' → general'}`
  const tools = answers.tools?.choice ?? ''
  const tail = `${skill ? ` · skill: ${skill}` : ''}${tools ? ` · tools: ${tools}` : ''}.`

  // An OpenAI pick goes to Codex on that model; Sonnet hands it off and brings the results back.
  if (run.startsWith('gpt-')) {
    return { model: SONNET, effort: 'medium', execModel: null, execEffort: 'medium', codexModel: run, skill, tools, note: `${head} · hand-off to Codex on ${nameOf(run)}${tail}` }
  }
  // A long task plans on the best-quality model, then the value pick runs the steps.
  const plan = isLong && row.primary !== run && row.primary.startsWith('claude-') ? row.primary : null
  if (plan) {
    const planEffort = effortOf(row.primaryEffort, plan)
    return {
      model: plan, effort: planEffort, execModel: run, execEffort: runEffort, codexModel: null, skill, tools,
      note: `${head} · long task: plans on ${nameOf(plan)} (${planEffort}), then ${nameOf(run)} (${runEffort}) runs the steps${tail}`,
    }
  }
  return { model: run, effort: runEffort, execModel: null, execEffort: runEffort, codexModel: null, skill, tools, note: `${head} · ${nameOf(run)} · ${runEffort} effort${isLong ? ' · long task' : ''}${tail}` }
}

// The optimized prompt with the hand-offs Jev's route calls for.
export function withRoute(text: string, route: Route | null): string {
  if (route === null) return text
  const skill = route.skill && !text.includes(route.skill) ? `\n\nUse the ${route.skill} skill.` : ''
  const unnamed = route.tools.split(', ').filter(name => name !== '' && !text.includes(name))
  const tools = unnamed.length > 0 ? `\n\nTools to use: ${unnamed.join(', ')}.` : ''
  return text + skill + tools + (route.codexModel ? codexLine(route.codexModel) : '')
}
