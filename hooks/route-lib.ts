import { ROUTING } from './route-table'

// Jev (TypeSafe) routes a prompt on a press of Optimize (Tyler, 2026-10-31). Jev judges what the prompt is:
// its task type from Tyler's Frontier Model Routing sheet, whether it is a long task, and the skill that
// fits. Code applies the sheet's switch rules to pick the model. Pure helpers; the calls live in register.tsx.

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
  note: string
}
type Answers = Record<string, { choice?: string; noul?: number; confidence?: number; probabilities?: Record<string, number> }>

const cap = (word: string) => word[0]!.toUpperCase() + word.slice(1)
// claude-opus-5-5 -> Opus 5.5, gpt-6.1-sol -> GPT-6.1 Sol
const nameOf = (id: string) =>
  id.replace(/^claude-(\w+)-(\d+)-(\d+)$/, (_, m, a, b) => `${cap(m)} ${a}.${b}`).replace(/^gpt-([\d.]+)-(\w+)$/, (_, v, m) => `GPT-${v} ${cap(m)}`)
// The sheet's effort ("medium (xhigh for hardest)", "none", blank) as a level; R03: Sonnet tops out at xhigh.
function effortOf(text: string, model: string): Effort {
  const effort = EFFORTS.find(level => text.startsWith(level)) ?? (text.startsWith('none') ? 'low' : 'medium')
  return model.includes('sonnet') && effort === 'max' ? 'xhigh' : effort
}

export function decideRoute(answers: Answers, contextTokens: number): Route | null {
  const chosen = ROUTING.find(row => row.id === answers.task?.choice)
  if (!chosen) return null
  const isSure = (answers.task?.confidence ?? 0) >= MIN_TASK_CONFIDENCE && chosen.confidence !== 'Low'
  const row = isSure ? chosen : ROUTING[0]
  const isLong = (answers.long?.noul ?? 0) >= 0.5

  // R01 for the fewest tokens at the same quality: the value pick runs the task.
  let run: string = row.value || row.primary
  let runEffort = effortOf(row.value ? row.valueEffort : row.primaryEffort, run)
  if (run.includes('haiku') && contextTokens >= HAIKU_MAX_TOKENS) run = SONNET
  const named = answers.skill?.choice
  const skill = named && named !== 'none' && (answers.skill?.probabilities?.[named] ?? 0) >= SKILL_MIN_PROBABILITY ? named : null
  const head = `Jev: ${chosen.id} (${Math.round(100 * (answers.task?.confidence ?? 0))}%)${isSure ? '' : ' → general'}`
  const tail = skill ? ` · skill: ${skill}.` : '.'

  // An OpenAI pick goes to Codex on that model; Sonnet hands it off and brings the results back.
  if (run.startsWith('gpt-')) {
    return { model: SONNET, effort: 'medium', execModel: null, execEffort: 'medium', codexModel: run, skill, note: `${head} · hand-off to Codex on ${nameOf(run)}${tail}` }
  }
  // A long task plans on the best-quality model, then the value pick runs the steps.
  const plan = isLong && row.primary !== run && row.primary.startsWith('claude-') ? row.primary : null
  if (plan) {
    const planEffort = effortOf(row.primaryEffort, plan)
    return {
      model: plan, effort: planEffort, execModel: run, execEffort: runEffort, codexModel: null, skill,
      note: `${head} · long task: plans on ${nameOf(plan)} (${planEffort}), then ${nameOf(run)} (${runEffort}) runs the steps${tail}`,
    }
  }
  return { model: run, effort: runEffort, execModel: null, execEffort: runEffort, codexModel: null, skill, note: `${head} · ${nameOf(run)} · ${runEffort} effort${isLong ? ' · long task' : ''}${tail}` }
}

// The optimized prompt with the hand-offs Jev's route calls for.
export function withRoute(text: string, route: Route | null): string {
  if (route === null) return text
  const skill = route.skill && !text.includes(route.skill) ? `\n\nUse the ${route.skill} skill.` : ''
  return text + skill + (route.codexModel ? codexLine(route.codexModel) : '')
}
