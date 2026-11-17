import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const HOME = '/Users/dev'
const CLAUDE = '/Applications/Claude Code/claude'
const PLUGINS = `${HOME}/.claude/plugins`
const SKILLS = `${HOME}/.claude/skills`
const MARKET = `${PLUGINS}/marketplaces/claude-plugins-official`
const REPO_SKILLS_URL = 'https://api.github.com/repos/anthropics/skills/contents/skills'
const skillMdUrl = (name: string) => `https://raw.githubusercontent.com/anthropics/skills/main/skills/${name}/SKILL.md`

const RUN = {
  command: 'optimize',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
}

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

const PANE = {
  plugin: 'prompt-transform',
  component: 'Pane' as const,
  requestId: 'new-skills',
  props: {
    title: 'New Claude skills',
    isFocused: false,
    bodyColumns: 100,
    placement: 'inline' as const,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
}

const BAND = {
  plugin: 'prompt-transform',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
}

// Anthropic's marketplace as its local copy has it: one plugin of each kind the sync tells apart.
const MARKETPLACE_JSON = JSON.stringify({
  plugins: [
    { name: 'frontend-design', source: './plugins/frontend-design', author: { name: 'Anthropic' } },
    { name: 'code-review', source: './plugins/code-review', author: { name: 'Anthropic' } },
    { name: 'hookify', source: './plugins/hookify', author: { name: 'Anthropic' } },
    { name: 'typescript-lsp', source: './plugins/typescript-lsp', author: { name: 'Anthropic' }, lspServers: {} },
    { name: 'airtable', source: './external_plugins/airtable', author: { name: 'Airtable' } },
  ],
})

type Entry = { name: string; kind: 'file' | 'dir'; mtimeMs?: number }

// The machine beneath the mod: files, the commands it runs, the web, the store and the screen.
function machine(
  on: On,
  options: {
    now?: number
    web?: Record<string, string>
    store?: Record<string, unknown>
    hooksMtime?: () => number
    failAdd?: boolean
    // What the search of every chat's transcript for plugin uses prints.
    scan?: string
  } = {},
) {
  const files: Record<string, string> = {
    [`${MARKET}/.claude-plugin/marketplace.json`]: MARKETPLACE_JSON,
    [`${PLUGINS}/installed_plugins.json`]: JSON.stringify({ plugins: { 'code-review@claude-plugins-official': [] } }),
  }
  const dirs: Record<string, Entry[]> = {
    [`${MARKET}/plugins/frontend-design`]: [{ name: '.claude-plugin', kind: 'dir' }, { name: 'skills', kind: 'dir' }],
    [`${MARKET}/plugins/code-review`]: [{ name: 'commands', kind: 'dir' }],
    [`${MARKET}/plugins/hookify`]: [{ name: 'skills', kind: 'dir' }, { name: 'hooks', kind: 'dir' }],
    [`${MARKET}/plugins/typescript-lsp`]: [{ name: '.lsp.json', kind: 'file' }],
    [`${MARKET}/external_plugins/airtable`]: [{ name: 'skills', kind: 'dir' }],
    [SKILLS]: [{ name: 'synced', kind: 'dir' }],
    [`${SKILLS}/synced`]: [{ name: 'account', kind: 'dir' }],
    [`${SKILLS}/synced/account`]: [{ name: 'pdf', kind: 'dir' }],
  }
  const web = options.web ?? {}
  const ran: string[][] = []
  const opened: string[] = []
  const closed: string[] = []
  const toasts: string[] = []

  const store: Record<string, unknown> = { ...options.store }

  const clock = mock.clock(on, { now: options.now ?? 10 * DAY })
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]
    return { value: undefined }
  })
  mock.env(on, { HOME, TMPDIR: '/tmp/', CLAUDE_CODE_EXECPATH: CLAUDE })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.list', (_, e) => {
    // The mod's own hooks folder, whose newest change the stale check compares.
    if (options.hooksMtime && e.path.endsWith('/hooks')) {
      return { value: [{ name: 'register.tsx', kind: 'file' as const, size: 0, mtimeMs: options.hooksMtime(), isLink: false }] }
    }
    const entries = dirs[e.path]
    if (entries === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: entries.map(entry => ({ size: 0, mtimeMs: 0, isLink: false, ...entry })) }
  })
  on('fs.stat', () => {
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const command = e.argv.join(' ')
    if (command === `${CLAUDE} plugin marketplace add anthropics/claude-plugins-official`) {
      if (options.failAdd) {
        const stderr = 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
        return { value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } }
      }
      files[`${PLUGINS}/known_marketplaces.json`] = JSON.stringify({ 'claude-plugins-official': { installLocation: MARKET } })
    }
    const scan = command.includes('.claude*/projects') ? (options.scan ?? '') : ''
    const stdout = command.startsWith('tar -tzf') ? 'skills-main/\nskills-main/skills/\n' : scan
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', (_, e) => {
    const text = web[e.url]
    return { value: { status: text === undefined ? 404 : 200, ok: text !== undefined, headers: {}, text: text ?? '' } }
  })
  on('command.list', () => ({ value: [] }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  return { clock, store, files, dirs, ran, opened, closed, toasts }
}

const commandsRun = (ran: string[][], prefix: string) => ran.map(argv => argv.join(' ')).filter(line => line.startsWith(prefix))

// Starts a session and lets the skills check it starts in the background finish.
async function startSession($: Engine, world: { clock: { advance: (ms: number) => Promise<void> } }) {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  await world.clock.advance(0)
}

test('the optimizer reads the conversation and the skills the session can use', async ($, on) => {
  const asked: string[] = []
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'pull the Q3 totals by carrier into a csv', toolUses: [] },
      { role: 'assistant' as const, text: 'Done: exports/q3.csv has 14 carriers.', toolUses: [] },
    ],
  }))
  on('command.list', () => ({
    value: [
      { name: 'pptx', description: 'Create and edit PowerPoint decks', source: 'plugin' as const, plugin: 'anthropic-skills' },
      { name: 'compact', description: 'Summarize the conversation', source: 'builtin' as const },
      { name: 'linear:search', description: 'An MCP prompt', source: 'mcp' as const },
      { name: 'optimize', description: 'Optimize a rough prompt', source: 'plugin' as const },
    ],
  }))
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true as const, text: '<optimized_prompt>Make slides.</optimized_prompt>', usage: USAGE } }
  })
  on('prompt.fill', () => ({ isFilled: true }))

  await $.command.run({ ...RUN, args: 'make that into slides' })

  expect(asked).toEqual([
    '<conversation>\nuser: pull the Q3 totals by carrier into a csv\n\nassistant: Done: exports/q3.csv has 14 carriers.\n</conversation>\n\n' +
      '<skills>\n- pptx: Create and edit PowerPoint decks\n</skills>\n\n' +
      '<draft>\nmake that into slides\n</draft>',
  ])
})

test("the first sync adds Anthropic's marketplace and installs only its skill plugins", async ($, on) => {
  const world = machine(on)

  await startSession($, world)

  expect(commandsRun(world.ran, CLAUDE)).toEqual([
    `${CLAUDE} plugin marketplace add anthropics/claude-plugins-official`,
    `${CLAUDE} plugin install frontend-design@claude-plugins-official --scope user`,
    // Installed switched off: a press of Optimize turns it on when a prompt needs it.
    `${CLAUDE} plugin disable frontend-design@claude-plugins-official --scope user`,
    `${CLAUDE} plugin update code-review@claude-plugins-official`,
  ])
  expect(world.toasts[0]).toContain('frontend-design')
})

test('pressing Optimize checks for new skills, at most once an hour', async ($, on) => {
  const world = machine(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'Clear prompt.', usage: USAGE } }))
  on('prompt.fill', () => ({ isFilled: true }))
  await startSession($, world)
  const afterStart = world.ran.length

  await world.clock.advance(10 * MINUTE)
  await $.command.run({ ...RUN, args: 'rough' })
  await world.clock.advance(5_000)
  expect(world.ran.length).toBe(afterStart)

  await world.clock.advance(HOUR)
  await $.command.run({ ...RUN, args: 'rough' })
  await world.clock.advance(5_000)
  expect(commandsRun(world.ran.slice(afterStart), CLAUDE)[0]).toBe(`${CLAUDE} plugin marketplace update claude-plugins-official`)
})

test("once a day the repo's new skills are listed to download or leave out", async ($, on) => {
  const world = machine(on, {
    web: {
      [REPO_SKILLS_URL]: JSON.stringify([
        { name: 'webapp-testing', type: 'dir' },
        { name: 'doc-coauthoring', type: 'dir' },
        { name: 'pdf', type: 'dir' },
        { name: 'README.md', type: 'file' },
      ]),
      [skillMdUrl('webapp-testing')]: '---\nname: webapp-testing\ndescription: Test local web apps with Playwright\n---\n',
      [skillMdUrl('doc-coauthoring')]:
        '---\nname: doc-coauthoring\ndescription: >\n  Write documents together,\n  section by section\nlicense: MIT\n---\n',
    },
  })

  await startSession($, world)
  expect(world.opened).toEqual(['new-skills'])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('webapp-testing')
  expect(drawn).toContain('Test local web apps with Playwright')
  expect(drawn).toContain('doc-coauthoring')
  expect(drawn).toContain('Write documents together, section by section')
  expect(drawn).not.toContain('"pdf"')

  await ui.press({ key: 'download:webapp-testing' })
  expect(commandsRun(world.ran, 'tar -xzf')).toEqual([
    `tar -xzf /tmp/prompt-transform-skills.tar.gz -C ${SKILLS} --strip-components=2 skills-main/skills/webapp-testing`,
  ])
  expect(world.store['repo.chosen']).toEqual(['webapp-testing'])

  const result = await $.command.run({ ...RUN, command: 'new-skills', args: 'leave doc-coauthoring' })
  expect(result.text).toContain('Left out: doc-coauthoring')
  expect(world.store['repo.leftOut']).toEqual(['doc-coauthoring'])
  expect(world.closed).toEqual(['new-skills'])
  await ui.unmount()
})

test('a day later the skills you picked and the installed plugins update, and nothing is asked again', async ($, on) => {
  const world = machine(on, {
    web: { [REPO_SKILLS_URL]: JSON.stringify([{ name: 'webapp-testing', type: 'dir' }]) },
    store: { 'repo.chosen': ['webapp-testing'] },
  })
  await startSession($, world)
  const afterStart = world.ran.length

  // An hour at a time, as the session's five-second timers would see the day go by.
  for (let hour = 0; hour < 25; hour += 1) await world.clock.advance(HOUR)

  const later = world.ran.slice(afterStart).map(argv => argv.join(' '))
  expect(later).toContain(`${CLAUDE} plugin update code-review@claude-plugins-official`)
  expect(later).toContain(`tar -xzf /tmp/prompt-transform-skills.tar.gz -C ${SKILLS} --strip-components=2 skills-main/skills/webapp-testing`)
  expect(world.opened).toEqual([])
})

test('a session running an older copy of the mod says so beside the button', async ($, on) => {
  let mtime = 1_000
  const world = machine(on, { hooksMtime: () => mtime })
  await startSession($, world)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Optimize was updated')

  mtime = 2_000
  await world.clock.advance(MINUTE)

  expect(JSON.stringify(await ui.drawn())).toContain('Optimize was updated. Start a new session to use the new version.')
  await ui.unmount()
})

test('a sync that fails is not marked done, says why when you press Optimize, and is retried within the hour', async ($, on) => {
  const world = machine(on, { failAdd: true })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'Clear prompt.', usage: USAGE } }))
  on('prompt.fill', () => ({ isFilled: true }))
  await startSession($, world)

  expect(world.store['skills.dailyAt']).toBeUndefined()
  expect(world.store['skills.syncedAt']).toBeUndefined()
  expect(String(world.store['skills.lastError'])).toContain('Permission denied (publickey)')

  await world.clock.advance(20 * MINUTE)
  await $.command.run({ ...RUN, args: 'rough' })
  await world.clock.advance(5_000)
  expect(world.toasts.at(-1)).toContain("Couldn't update Claude's skills: adding the marketplace failed")

  await world.clock.advance(HOUR)
  const adds = commandsRun(world.ran, `${CLAUDE} plugin marketplace add`)
  expect(adds.length).toBe(3)
})

// --- Plugins: off when no chat uses them, on when a prompt needs one ---

const SYNCED = { 'skills.syncedAt': 40 * DAY, 'skills.dailyAt': 40 * DAY }
const installedAt = (day: number) => new Date(day * DAY).toISOString()

test('a skills-only plugin no chat used in 14 days is switched off where it is installed; the rest stay on', async ($, on) => {
  const world = machine(on, { now: 40 * DAY, store: SYNCED, scan: '"skill":"busy:run"\nscanned\n' })
  world.files[`${PLUGINS}/installed_plugins.json`] = JSON.stringify({
    plugins: {
      'idle@m': [{ scope: 'user', installPath: '/p/idle', installedAt: installedAt(1) }],
      'busy@m': [{ scope: 'user', installPath: '/p/busy', installedAt: installedAt(1) }],
      'fresh@m': [{ scope: 'user', installPath: '/p/fresh', installedAt: installedAt(39) }],
      'hooked@m': [{ scope: 'project', installPath: '/p/hooked', installedAt: installedAt(1) }],
    },
  })
  world.dirs['/p/idle'] = [{ name: 'skills', kind: 'dir' }]
  world.dirs['/p/hooked'] = [{ name: 'skills', kind: 'dir' }, { name: 'hooks', kind: 'dir' }]
  on('session.cwd', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { enabledPlugins: { 'idle@m': true, 'busy@m': true, 'fresh@m': true, 'hooked@m': true } } }))

  await startSession($, world)

  expect(commandsRun(world.ran, CLAUDE)).toEqual([`${CLAUDE} plugin disable idle@m --scope user`])
  expect(world.toasts.join(' ')).toContain('Turned off 1 plugin no chat used in 14 days: idle.')
  expect(world.store['plugins.since']).toEqual({ 'busy@m': DAY, 'fresh@m': 39 * DAY, 'hooked@m': DAY })
  expect(world.opened).toContain('save-credits')
})

test('a search of the chats that was cut short switches nothing off', async ($, on) => {
  const world = machine(on, { now: 40 * DAY, store: SYNCED, scan: '' })
  world.files[`${PLUGINS}/installed_plugins.json`] = JSON.stringify({
    plugins: { 'idle@m': [{ scope: 'user', installPath: '/p/idle', installedAt: installedAt(1) }] },
  })
  world.dirs['/p/idle'] = [{ name: 'skills', kind: 'dir' }]
  on('session.cwd', () => ({ value: '/work' }))
  on('settings.read', () => ({ value: { enabledPlugins: { 'idle@m': true } } }))

  await startSession($, world)

  expect(commandsRun(world.ran, CLAUDE)).toEqual([])
})

test('a prompt that needs a switched-off plugin gets it switched on', async ($, on) => {
  const world = machine(on)
  world.files[`${PLUGINS}/installed_plugins.json`] = JSON.stringify({
    plugins: {
      'commit-commands@m': [{ scope: 'user', installPath: '/p/cc' }],
      'math@m': [{ scope: 'user', installPath: '/p/math' }],
      'on@m': [{ scope: 'user', installPath: '/p/on' }],
    },
  })
  world.files['/p/cc/.claude-plugin/plugin.json'] = JSON.stringify({ description: 'Commit, push and open pull requests' })
  world.files['/p/math/.claude-plugin/plugin.json'] = JSON.stringify({ description: 'Solve competition math' })
  world.files['/p/on/.claude-plugin/plugin.json'] = JSON.stringify({ description: 'Already on' })
  on('settings.read', () => ({ value: { enabledPlugins: { 'commit-commands@m': false, 'on@m': true } } }))
  const asked: string[] = []
  const filled: string[] = []
  on('model.complete', (_, e) => {
    asked.push(e.prompt)
    const text = '<optimized_prompt>Commit and open a PR.</optimized_prompt>\n<enable_plugins>commit-commands, made-up</enable_plugins>'
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  await $.command.run({ ...RUN, args: 'commit this and open a pr' })

  expect(asked[0]).toContain('<plugins_off>\n- commit-commands: Commit, push and open pull requests\n- math: Solve competition math\n</plugins_off>')
  expect(commandsRun(world.ran, CLAUDE)).toEqual([`${CLAUDE} plugin enable commit-commands@m --scope user`])
  expect(filled).toEqual(['Commit and open a PR.'])
  expect(world.toasts.join(' ')).toContain('Turned on commit-commands for this task')
})
