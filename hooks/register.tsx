import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Archived, Lang, Tokens, Worktree, WorktreeView, WtUi } from '../types'
import { words } from './i18n'

const ZERO: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const IDLE: WtUi = { mode: 'list', target: null, then: null, busy: false, message: null, isError: false, conflicts: [] }

const tokens = atom({ plugin: 'supermod-claudecode', key: 'tokens' } as const, ZERO)
// Redraws the bar every second, so context/cost/limits stay fresh.
const tick = atom({ plugin: 'supermod-claudecode', key: 'tick' } as const, 0)
const bandHidden = atom({ plugin: 'supermod-claudecode', key: 'bandHidden' } as const, false)
const worktrees = atom({ plugin: 'supermod-claudecode', key: 'worktrees' } as const, null)
const wtUi = atom({ plugin: 'supermod-claudecode', key: 'wtUi' } as const, IDLE)
const prefs = atom({ plugin: 'supermod-claudecode', key: 'prefs' } as const, { lang: 'en' })

const WT_PANE = 'worktrees'
const WT_TITLE = 'Workbranch'
const WT_COLUMNS = 50
const WT_REFRESH_MS = 8000

/* ---------- formatting ---------- */

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

const bar = (percent: number, width: number) => {
  const full = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '▰'.repeat(full) + '▱'.repeat(width - full)
}

const tone = (percent: number) => (percent >= 85 ? 'red' : percent >= 60 ? 'yellow' : 'green')

const ORDER: Record<string, number> = { five_hour: 0, seven_day: 1 }

/* ---------- SVG icons (desktop): colors readable on light and dark themes ---------- */

const ICON = 16
const HEX = { green: '#3fb950', yellow: '#e3b341', red: '#f85149' }
const GREY = '#8c8c8c'
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 16 16">${body}</svg>`

const ring = (pct: number) => {
  const r = 6
  const len = 2 * Math.PI * r
  const done = (Math.min(100, Math.max(0, pct)) / 100) * len
  return svg(
    `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${GREY}" stroke-opacity=".3" stroke-width="2.4"/>` +
      `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${HEX[tone(pct)]}" stroke-width="2.4" stroke-linecap="round" ` +
      `stroke-dasharray="${done.toFixed(2)} ${len.toFixed(2)}" transform="rotate(-90 8 8)"/>`,
  )
}
const TOKEN_ICON = svg(
  `<path d="M3 5.5h10M3 8h7M3 10.5h8.5" fill="none" stroke="${GREY}" stroke-width="1.5" stroke-linecap="round"/>`,
)
const COST_ICON = svg(
  `<circle cx="8" cy="8" r="6.2" fill="none" stroke="#39c5cf" stroke-width="1.5"/>` +
    `<path d="M9.9 5.9c-.4-.6-1.1-.9-1.9-.9-1.1 0-1.9.6-1.9 1.4 0 1.9 3.9 1 3.9 3 0 .8-.8 1.5-2 1.5-.9 0-1.6-.4-2-1M8 4v8" fill="none" stroke="#39c5cf" stroke-width="1.3" stroke-linecap="round"/>`,
)

/* ---------- workbranches: reading git ---------- */

type Run = (argv: readonly string[], cwd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>

// Above this size the first commit stops: better to exclude videos, builds, models first.
const FIRST_COMMIT_LIMIT = 200 * 1024 * 1024

const GITIGNORE = `# Dependencies and builds
node_modules/
.next/
dist/
build/
out/
.dart_tool/
Pods/

# Secrets
.env
.env.*
!.env.example

# System
.DS_Store
*.log
`

// Branch names come from the repository and end up as git arguments: only plain names pass
// (letters, digits, . _ / -, never a leading - or ..), so none can be read as an option.
const safeRef = (name: string | null | undefined) =>
  name && /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,199}$/.test(name) && !name.includes('..') ? name : null

const parsePorcelain = (out: string) =>
  out
    .split('\n\n')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const wt = { path: '', head: '', branch: null as string | null, isLocked: false, isPrunable: false }
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) wt.path = line.slice(9)
        else if (line.startsWith('HEAD ')) wt.head = line.slice(5, 12)
        else if (line.startsWith('branch ')) wt.branch = safeRef(line.slice(7).replace(/^refs\/heads\//, ''))
        else if (line.startsWith('locked')) wt.isLocked = true
        else if (line.startsWith('prunable')) wt.isPrunable = true
      }
      return wt
    })

const countAhead = async (run: Run, repo: string, base: string | null, branch: string | null) => {
  if (!base || !branch || base === branch) return 0
  const r = await run(['git', '-C', repo, 'rev-list', '--count', `${base}..${branch}`])
  return r.exitCode === 0 ? Number(r.stdout.trim()) || 0 : 0
}

// How much the first commit would weigh, in total and per top-level folder. No shell: git lists the
// files, `stat` sizes them in chunks, each name passed as its own argument.
const measureNew = async (run: Run, project: string) => {
  const listed = await run(['git', '-C', project, 'ls-files', '-o', '--exclude-standard', '-z'])
  const files = listed.stdout.split('\0').filter(Boolean)
  const byFolder = new Map<string, number>()
  let total = 0
  for (let i = 0; i < files.length; i += 400) {
    const chunk = files.slice(i, i + 400)
    // BSD stat (macOS) first, GNU stat (Linux) otherwise; `--` so no name is read as an option.
    let r = await run(['stat', '-f', '%z', '--', ...chunk], project)
    if (r.exitCode !== 0) r = await run(['stat', '-c', '%s', '--', ...chunk], project)
    r.stdout
      .split('\n')
      .filter(Boolean)
      .forEach((size, j) => {
        const name = chunk[j] ?? ''
        const slash = name.indexOf('/')
        const folder = slash >= 0 ? name.slice(0, slash + 1) : name
        byFolder.set(folder, (byFolder.get(folder) ?? 0) + Number(size))
        total += Number(size)
      })
  }
  return { total, byFolder }
}

// Settings a repository can carry that make git run a program. The person's own global settings are
// theirs and trusted; the repository's are not: with any of these, the pane leaves the repository alone.
const RUNS_PROGRAMS = new RegExp(
  '^(' +
    [
      'core\\.(fsmonitor|hookspath|sshcommand|gitproxy|pager|editor|askpass|alternaterefscommand)',
      'filter\\..*',
      'diff\\.external',
      'diff\\..*\\.(textconv|command)',
      'merge\\..*\\.driver',
      'credential\\..*',
      'gpg\\.(.*\\.)?program',
      'sequence\\.editor',
      'uploadpack\\.packobjectshook',
      'protocol\\.ext\\.allow',
      'include\\.path',
      'includeif\\..*',
    ].join('|') +
    ')$',
  'i',
)

// Whether a repository's own config would make the pane's automatic git calls run its programs.
// Listing config never runs anything.
const runsPrograms = async (run: Run, path: string) => {
  const r = await run(['git', '-C', path, 'config', '--list', '--name-only', '--show-scope'])
  return r.stdout
    .split('\n')
    .map(line => line.split('\t'))
    .some(([scope, key]) => (scope === 'local' || scope === 'worktree') && RUNS_PROGRAMS.test(key ?? ''))
}

const loadWorktrees = async (run: Run, project: string): Promise<WorktreeView> => {
  const empty = { project, parentRepo: null, base: null, list: [], archived: [], error: null }
  const top = await run(['git', '-C', project, 'rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return { ...empty, repo: 'none' }
  if (await runsPrograms(run, project)) return { ...empty, repo: 'unsafe' }

  const root = top.stdout.trim()
  if (root !== project) {
    // A parent folder has a repository: the project is "its own" only if that repository tracks its files.
    const tracked = await run(['git', '-C', project, 'ls-files', '--', '.'])
    if (!tracked.stdout.trim()) return { ...empty, repo: 'inside', parentRepo: root }
  }

  const hasHead = (await run(['git', '-C', project, 'rev-parse', '--verify', '-q', 'HEAD'])).exitCode === 0
  if (!hasHead) return { ...empty, repo: 'empty' }

  const listed = await run(['git', '-C', project, 'worktree', 'list', '--porcelain'])
  const raw = parsePorcelain(listed.stdout)
  const main = raw[0]
  const base = main?.branch ?? null
  const current = raw
    .filter(w => project === w.path || project.startsWith(w.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path

  // Each worktree can carry settings of its own (config.worktree): check them before reading any.
  const live = raw.filter(w => !w.isPrunable)
  if ((await Promise.all(live.map(w => runsPrograms(run, w.path)))).some(Boolean)) return { ...empty, repo: 'unsafe' }

  const list = await Promise.all(
    raw.map(async (w, i): Promise<Worktree> => {
      const status = w.isPrunable ? null : await run(['git', '-C', w.path, 'status', '--porcelain=v1'])
      return {
        ...w,
        isMain: i === 0,
        isCurrent: w.path === current,
        changes: status?.exitCode === 0 ? status.stdout.split('\n').filter(Boolean).length : 0,
        ahead: i === 0 ? 0 : await countAhead(run, project, base, w.branch),
      }
    }),
  )

  // Branches with no folder: workbranches put away.
  const inUse = new Set(list.map(w => w.branch).filter(Boolean))
  const heads = await run(['git', '-C', project, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'])
  const archived = await Promise.all(
    heads.stdout
      .split('\n')
      .filter(b => safeRef(b) && !inUse.has(b))
      .map(async (branch): Promise<Archived> => ({ branch, ahead: await countAhead(run, project, base, branch) })),
  )

  return { ...empty, repo: 'own', base, list, archived }
}

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

const slug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`)

// Where a workbranch's folder lives, next to the others of the same project.
const folderFor = (home: string, mainPath: string, branch: string) =>
  `${home}/.worktrees/${slug(baseName(mainPath))}/${branch.replace(/\//g, '-')}`

/* ---------- language ---------- */

// The interface language follows Claude Code's own language setting; with none set, the system's.
async function resolveLang($: EngineInterface): Promise<Lang> {
  const setting = (await $.settings.read())['language']
  if (typeof setting === 'string' && setting.trim()) return /^(it|ital)/i.test(setting.trim()) ? 'it' : 'en'
  const env = (await $.env.get('LANG')) ?? ''
  if (env) return env.toLowerCase().startsWith('it') ? 'it' : 'en'
  const mac = await $.process.run(['defaults', 'read', '-g', 'AppleLocale']).catch(() => null)
  return mac?.stdout.trim().toLowerCase().startsWith('it') ? 'it' : 'en'
}

async function currentWords($: EngineInterface) {
  const p = await read($, prefs)
  return words(p.lang)
}

/* ---------- workbranches: actions ---------- */

// The pane runs git on its own (every few seconds) in whatever folder the session is in. A repository's
// config can name a program for git to run (core.fsmonitor): turn that off, so opening a downloaded
// project never runs its code behind the person's back.
function runner($: EngineInterface): Run {
  return (argv, cwd) => {
    const safe = argv[0] === 'git' ? ['git', '-c', 'core.fsmonitor=false', ...argv.slice(1)] : argv
    return $.process.run(safe, { timeoutMs: 120_000, ...(cwd ? { cwd } : {}) })
  }
}


async function refreshWorktrees($: EngineInterface) {
  const project = await $.session.root()
  const view = await loadWorktrees(runner($), project)
  await update($, worktrees, () => view)
}

async function busy($: EngineInterface, message: string) {
  await update($, wtUi, ui => ({ ...(ui ?? IDLE), busy: true, message, isError: false }))
}

async function finish($: EngineInterface, message: string, isError = false) {
  await update($, wtUi, () => ({ ...IDLE, message, isError }))
  await refreshWorktrees($)
}

async function initRepo($: EngineInterface) {
  const t = await currentWords($)
  const run = runner($)
  const project = await $.session.root()
  await busy($, t.working.init)

  if (!(await $.fs.exists(`${project}/.git`))) {
    const init = await run(['git', 'init', '-b', 'main'], project)
    if (init.exitCode !== 0) return finish($, t.done.failed(init.stderr.trim()), true)
  }
  if (!(await $.fs.exists(`${project}/.gitignore`))) await $.fs.write(`${project}/.gitignore`, GITIGNORE)

  const { total, byFolder } = await measureNew(run, project)
  if (total > FIRST_COMMIT_LIMIT) {
    const biggest = [...byFolder]
      .map(([name, size]) => ({ size, name }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
      .map(r => `${r.name} (${mb(r.size)})`)
      .join(', ')
    return finish($, t.done.tooBig(mb(total), biggest), true)
  }

  const add = await run(['git', 'add', '-A'], project)
  if (add.exitCode !== 0) return finish($, t.done.failed(add.stderr.trim()), true)
  const commit = await run(['git', 'commit', '-q', '-m', 'First commit'], project)
  if (commit.exitCode !== 0) return finish($, t.done.failed((commit.stderr || commit.stdout).trim()), true)

  return finish($, t.done.init(mb(total)))
}

// Moves this Claude Code session. EnterWorktree only takes secondary worktrees, and only from the
// starting folder; ExitWorktree brings the session back to where it started.
async function moveTo($: EngineInterface, path: string, toMain: boolean) {
  const t = await currentWords($)
  await busy($, t.working.move)
  const consent = `The user pressed "${t.enter}" on ${path} in the Workbranch pane`
  const view = await read($, worktrees)
  const inSide = view?.list.some(w => w.isCurrent && !w.isMain) ?? false

  if (toMain || inSide) {
    const out = await $.tool.call({ tool: 'ExitWorktree', action: 'keep', consent })
    if (out.deny !== undefined) return finish($, t.done.notMoved(out.deny), true)
    if (out.isError) return finish($, t.done.notMoved(out.text ?? ""), true)
    if (toMain) return finish($, t.done.moved(t.mainName))
  }
  const r = await $.tool.call({ tool: 'EnterWorktree', path, consent })
  if (r.deny !== undefined) return finish($, t.done.notMoved(r.deny), true)
  if (r.isError) return finish($, t.done.notMoved(r.text ?? ""), true)

  return finish($, t.done.moved(baseName(path)))
}

async function goTo($: EngineInterface, path: string, toMain: boolean) {
  const view = await read($, worktrees)
  const here = view?.list.find(w => w.isCurrent)
  // Leaving a workbranch with unsaved changes asks first.
  if (here && here.changes > 0) {
    return update($, wtUi, (ui): WtUi => ({ ...(ui ?? IDLE), mode: 'confirm-leave', target: path, message: null, isError: false }))
  }
  return moveTo($, path, toMain)
}

// Commits everything in the workbranch. Returns true when it went through.
async function commitChanges($: EngineInterface, path: string, typed: string): Promise<boolean> {
  const t = await currentWords($)
  const run = runner($)
  await busy($, t.working.save)
  const add = await run(['git', '-C', path, 'add', '-A'])
  const count = (await run(['git', '-C', path, 'diff', '--cached', '--name-only'])).stdout.split('\n').filter(Boolean).length
  if (add.exitCode !== 0 || count === 0) {
    await finish($, add.exitCode !== 0 ? t.done.failed(add.stderr.trim()) : t.done.nothing, add.exitCode !== 0)
    return false
  }
  const commit = await run(['git', '-C', path, 'commit', '-q', '-m', typed.trim() || t.defaultMessage(count)])
  if (commit.exitCode !== 0) {
    await finish($, t.done.failed((commit.stderr || commit.stdout).trim()), true)
    return false
  }
  await finish($, t.done.saved(count, baseName(path)))
  return true
}

// Saves with the typed message; with `then` ("save and switch") moves the session afterwards.
async function saveChanges($: EngineInterface, path: string, typed: string, then: string | null) {
  const saved = await commitChanges($, path, typed)
  if (!saved || !then) return
  const view = await read($, worktrees)
  const dest = view?.list.find(w => w.path === then)
  if (dest) await moveTo($, dest.path, dest.isMain)
}

async function addWorktree($: EngineInterface, rawName: string) {
  const t = await currentWords($)
  const name = slug(rawName)
  if (!name) return update($, wtUi, ui => ({ ...(ui ?? IDLE), message: t.done.needName, isError: true }))

  const run = runner($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  if (!main) return finish($, t.noRepoTitle, true)

  await busy($, t.working.create(name))
  const path = folderFor((await $.env.get('HOME')) ?? '', main.path, name)
  const exists = (await run(['git', '-C', main.path, 'show-ref', '--verify', '-q', `refs/heads/${name}`])).exitCode === 0
  const r = await run(
    exists
      ? ['git', '-C', main.path, 'worktree', 'add', path, name]
      : ['git', '-C', main.path, 'worktree', 'add', '-b', name, path],
  )
  if (r.exitCode !== 0) return finish($, t.done.failed(r.stderr.trim()), true)

  await refreshWorktrees($)
  // A new workbranch is where you want to be: go straight in.
  return moveTo($, path, false)
}

// Brings a workbranch into the main branch. On a conflict it backs out and offers to ask Claude.
async function mergeIntoMain($: EngineInterface, path: string) {
  const t = await currentWords($)
  const run = runner($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  const wb = view?.list.find(w => w.path === path)
  if (!main || !wb?.branch) return finish($, t.done.failed('?'), true)
  if (wb.changes > 0) return finish($, t.mergeSaveFirst, true)
  if (main.changes > 0) return finish($, t.mainDirty, true)

  await busy($, t.working.merge)
  const r = await run(['git', '-C', main.path, 'merge', '--no-edit', wb.branch])
  if (r.exitCode === 0) return finish($, t.done.merged(wb.branch))

  const conflicted = await run(['git', '-C', main.path, 'diff', '--name-only', '--diff-filter=U'])
  const files = conflicted.stdout.split('\n').filter(Boolean)
  await run(['git', '-C', main.path, 'merge', '--abort'])
  if (!files.length) return finish($, t.done.failed((r.stderr || r.stdout).trim()), true)

  await update($, wtUi, (): WtUi => ({ ...IDLE, mode: 'conflict', target: path, conflicts: files }))
  return refreshWorktrees($)
}

async function askClaudeToMerge($: EngineInterface, path: string) {
  const t = await currentWords($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  const wb = view?.list.find(w => w.path === path)
  if (!main || !wb?.branch) return
  await update($, wtUi, () => IDLE)
  // Framed as this plugin's message, not as the person's words. Only the two branch names go in, and
  // safeRef has already reduced them to plain names; file names and paths stay out: Claude reads them from git.
  await $.prompt.submit({ text: t.askPrompt(wb.branch, main.branch ?? 'main') })
}

// Throws a workbranch away: its folder and its branch together.
async function discardWorktree($: EngineInterface, path: string) {
  const t = await currentWords($)
  const run = runner($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  const wb = view?.list.find(w => w.path === path)
  if (!main || !wb) return finish($, t.done.failed('?'), true)
  if (wb.isCurrent) return finish($, t.discardHere, true)

  await busy($, t.working.discard)
  const rm = await run(['git', '-C', main.path, 'worktree', 'remove', '--force', path])
  if (rm.exitCode !== 0) return finish($, t.done.failed(rm.stderr.trim()), true)
  if (wb.branch) await run(['git', '-C', main.path, 'branch', '-D', wb.branch])

  return finish($, t.done.discarded(wb.branch ?? baseName(path)))
}

async function discardArchived($: EngineInterface, branch: string) {
  const t = await currentWords($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  if (!main) return
  await busy($, t.working.discard)
  const r = await runner($)(['git', '-C', main.path, 'branch', '-D', branch])
  return finish($, r.exitCode === 0 ? t.done.discarded(branch) : t.done.failed(r.stderr.trim()), r.exitCode !== 0)
}

async function reopenArchived($: EngineInterface, branch: string) {
  const t = await currentWords($)
  const view = await read($, worktrees)
  const main = view?.list.find(w => w.isMain)
  if (!main) return
  await busy($, t.working.reopen)
  const path = folderFor((await $.env.get('HOME')) ?? '', main.path, branch)
  const r = await runner($)(['git', '-C', main.path, 'worktree', 'add', path, branch])
  return finish($, r.exitCode === 0 ? t.done.reopened(branch) : t.done.failed(r.stderr.trim()), r.exitCode !== 0)
}

/* ---------- hooks ---------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const lang = await resolveLang($)
    await update($, prefs, () => ({ lang }))
    const t = words(lang)

    await $.command.register({ name: 'usage-bar', description: t.barCmd })
    await $.command.register({ name: 'workbranch', description: t.paneCmd })

    $.clock.every(1000, () => {
      void update($, tick, n => (n ?? 0) + 1)
    })
    $.clock.every(WT_REFRESH_MS, () => {
      void (async () => {
        const panes = await $.ui.panes()
        const ui = await read($, wtUi)
        if (!ui.busy && panes.some(p => p.id === WT_PANE && p.isShown)) await refreshWorktrees($)
      })()
    })

    await update($, wtUi, () => IDLE)
    void refreshWorktrees($)
    void $.ui.open({ id: WT_PANE, title: WT_TITLE, columns: WT_COLUMNS })

    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const t = await currentWords($)
    const hidden = await update($, bandHidden, v => !v)

    return { text: hidden ? t.barHidden : t.barShown }
  })

  on('command.run', { command: 'workbranch' }, async $ => {
    const t = await currentWords($)
    void refreshWorktrees($)
    await $.ui.open({ id: WT_PANE, title: WT_TITLE, columns: WT_COLUMNS })

    return { text: t.paneOpened }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const u = result.usage ?? e.usage
    if (u) {
      await update($, tokens, t => ({
        input: (t ?? ZERO).input + u.input_tokens,
        output: (t ?? ZERO).output + u.output_tokens,
        cacheRead: (t ?? ZERO).cacheRead + u.cache_read_input_tokens,
        cacheWrite: (t ?? ZERO).cacheWrite + u.cache_creation_input_tokens,
      }))
    }
    // After each turn Claude may have changed files or worktrees.
    if (!e.agentId) void refreshWorktrees($)

    return result
  })

  /* ----- bar above the prompt: context, 5 hours, week, cost, tokens ----- */

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, bandHidden))) return next(e)

    await read($, tick)
    const t = words((await read($, prefs)).lang)
    const tk = await read($, tokens)
    const usage = await $.session.usage()
    const ctx = usage.context
    const ctxPct = ctx.percent ?? (ctx.tokens && ctx.window ? Math.round((ctx.tokens / ctx.window) * 100) : 0)
    const total = tk.input + tk.output + tk.cacheRead + tk.cacheWrite
    const names: Record<string, string> = { five_hour: t.fiveHours, seven_day: t.week, spend_limit: t.spend }
    const limits = [...usage.rateLimits]
      .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))
      .map(l => ({ name: names[l.kind] ?? l.kind, pct: l.percentUsed }))
    const hide = () => update($, bandHidden, () => true)

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const dot = <Text dimColor>  │  </Text>

      return (
        <Box flexDirection="row" flexWrap="wrap" paddingX={1}>
          <Text dimColor>{t.context} </Text>
          <Text color={tone(ctxPct)}>{bar(ctxPct, 8)} {ctxPct}%</Text>
          {limits.map(l => (
            <Text>
              <Text dimColor>  │  {l.name} </Text>
              <Text color={tone(l.pct)}>{bar(l.pct, 5)} {l.pct}%</Text>
            </Text>
          ))}
          {usage.cost && dot}
          {usage.cost && <Text color="cyan">${usage.cost.usd.toFixed(2)}</Text>}
          {dot}
          <Text>{fmt(total)}</Text>
          <Text dimColor> {t.tokens}</Text>
          <Text>   </Text>
          <Button key="hide" plain dimColor label="✕" onPress={hide} />
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const chip = (key: string, icon: string, iconAlt: string, value: string, label: string, color?: string) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={1} paddingX={1} borderStyle="round" borderDimColor>
        <Svg source={icon} alt={iconAlt} width={ICON} height={ICON} />
        <Text bold color={color}>{value}</Text>
        <Text dimColor>{label}</Text>
      </Box>
    )

    return (
      <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1}>
        {chip('ctx', ring(ctxPct), `${ctxPct}%`, `${ctxPct}%`, t.context)}
        {limits.map(l => chip(`lim-${l.name}`, ring(l.pct), `${l.pct}%`, `${l.pct}%`, l.name))}
        {usage.cost && chip('cost', COST_ICON, t.cost, `$${usage.cost.usd.toFixed(2)}`, t.cost, 'cyan')}
        {chip('tok', TOKEN_ICON, t.tokens, fmt(total), t.tokens)}
        <Button key="hide" role="dismiss" plain label="✕" onPress={hide} />
      </Box>
    )
  })

  /* ----- side pane: the project's workbranches ----- */

  on('ui.render', { component: 'Pane', requestId: WT_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // The text field exists everywhere but on mobile.
    const Input = 'Input' in els ? els.Input : undefined
    const view = await read($, worktrees)
    const ui = await read($, wtUi)
    const p = await read($, prefs)
    const t = words(p.lang)
    const setUi = (patch: Partial<WtUi>) =>
      update($, wtUi, cur => ({ ...(cur ?? IDLE), message: null, isError: false, ...patch }))

    if (!view) return <Text dimColor>{t.reading}</Text>

    const message = ui.message && <Text color={ui.isError ? 'red' : 'green'}>{ui.message}</Text>
    const footer = (
      <Box flexDirection="column">
        <Text> </Text>
        {ui.mode === 'help' ? (
          <Box flexDirection="column">
            {t.helpText.map(line => (
              <Text dimColor>{line}</Text>
            ))}
            <Button key="help-close" plain dimColor label={t.close} onPress={() => setUi({ mode: 'list' })} />
          </Box>
        ) : (
          <Button key="help" plain dimColor label={t.help} onPress={() => setUi({ mode: 'help' })} />
        )}
      </Box>
    )
    const header = (
      <Box flexDirection="column">
        <Text dimColor>{t.project}</Text>
        <Text bold>{baseName(view.project)}</Text>
        <Text> </Text>
      </Box>
    )

    if (ui.busy) {
      return (
        <Box flexDirection="column">
          {header}
          <Text color="yellow">{ui.message ?? t.wait}</Text>
        </Box>
      )
    }

    // A repository whose settings run programs: the pane won't run git there on its own.
    if (view.repo === 'unsafe') {
      return (
        <Box flexDirection="column">
          {header}
          <Text color="yellow">⚠ {t.unsafeTitle}</Text>
          <Text dimColor>{t.unsafeText}</Text>
        </Box>
      )
    }

    // No repository of its own: one button to turn history on.
    if (view.repo !== 'own') {
      const isEmpty = view.repo === 'empty'
      return (
        <Box flexDirection="column">
          {header}
          <Text color="yellow">● {isEmpty ? t.emptyTitle : t.noRepoTitle}</Text>
          <Text dimColor>
            {isEmpty ? t.emptyText : view.repo === 'inside' ? t.insideText(baseName(view.parentRepo ?? '')) : t.noRepoText}
          </Text>
          <Text> </Text>
          {ui.mode === 'confirm-init' ? (
            <Box flexDirection="column">
              <Text>{t.confirmInit(baseName(view.project))}</Text>
              <Box flexDirection="row" gap={2}>
                <Button key="init-yes" variant="primary" label={t.yesActivate} onPress={() => initRepo($)} />
                <Button key="init-no" label={t.cancel} onPress={() => setUi({ mode: 'list' })} />
              </Box>
            </Box>
          ) : (
            <Button
              key="init"
              variant="primary"
              label={isEmpty ? t.firstSave : t.activate}
              onPress={() => (isEmpty ? initRepo($) : setUi({ mode: 'confirm-init' }))}
            />
          )}
          <Text> </Text>
          {message}
          {footer}
        </Box>
      )
    }

    const name = (w: Worktree) => (w.isMain ? t.mainName : (w.branch ?? w.head))
    const icon = (w: Worktree) => (w.isMain ? '🏠' : '🧪')
    const status = (w: Worktree) =>
      w.isPrunable
        ? { color: 'red', text: t.missing }
        : w.changes > 0
          ? { color: 'yellow', text: t.changes(w.changes) }
          : w.ahead > 0
            ? { color: 'cyan', text: t.ahead(w.ahead) }
            : { color: 'green', text: w.isMain ? t.clean : t.merged }
    const here = view.list.find(w => w.isCurrent)
    const main = view.list.find(w => w.isMain)

    const commitForm = (w: Worktree) => (
      <Box flexDirection="column" paddingLeft={3}>
        {Input ? (
          <Input
            key={`commit-msg-${w.path}`}
            label={t.messageLabel}
            placeholder={t.messagePlaceholder(w.changes)}
            submitLabel={ui.then ? t.saveAndSwitch : t.save.toLowerCase()}
            autoFocus
            onSubmit={(value: string) => saveChanges($, w.path, value, ui.then)}
          />
        ) : (
          <Button key={`commit-plain-${w.path}`} variant="primary" label={t.save} onPress={() => saveChanges($, w.path, '', ui.then)} />
        )}
        <Text dimColor>{t.saveHint(Boolean(ui.then))}</Text>
        <Button key={`commit-no-${w.path}`} plain dimColor label={t.cancel} onPress={() => setUi({ mode: 'list', target: null, then: null })} />
      </Box>
    )

    const actions = (w: Worktree) => {
      if (ui.mode === 'commit' && ui.target === w.path) return commitForm(w)

      if (ui.mode === 'confirm-leave' && ui.target === w.path && here) {
        return (
          <Box flexDirection="column" paddingLeft={3}>
            <Text color="yellow">{t.leaveWarn(name(here), here.changes)}</Text>
            <Box flexDirection="row" gap={2}>
              <Button
                key={`leave-save-${w.path}`}
                variant="primary"
                label={t.saveThenGo}
                onPress={() => setUi({ mode: 'commit', target: here.path, then: w.path })}
              />
              <Button key={`leave-go-${w.path}`} label={t.justGo} onPress={() => moveTo($, w.path, w.isMain)} />
              <Button key={`leave-no-${w.path}`} plain dimColor label={t.cancel} onPress={() => setUi({ mode: 'list', target: null })} />
            </Box>
          </Box>
        )
      }

      if (ui.mode === 'confirm-discard' && ui.target === w.path) {
        return (
          <Box flexDirection="column" paddingLeft={3}>
            <Text color="yellow">{t.discardWarn(w.changes, w.ahead)}</Text>
            <Box flexDirection="row" gap={2}>
              <Button key={`discard-yes-${w.path}`} variant="primary" label={t.discardYes} onPress={() => discardWorktree($, w.path)} />
              <Button key={`discard-no-${w.path}`} label={t.cancel} onPress={() => setUi({ mode: 'list', target: null })} />
            </Box>
          </Box>
        )
      }

      if (ui.mode === 'conflict' && ui.target === w.path) {
        return (
          <Box flexDirection="column" paddingLeft={3}>
            <Text color="yellow">{t.conflictTitle(ui.conflicts.length)}</Text>
            {ui.conflicts.slice(0, 5).map(f => (
              <Text dimColor wrap="truncate-middle">  {f}</Text>
            ))}
            <Box flexDirection="row" gap={2}>
              <Button key={`ask-${w.path}`} variant="primary" label={t.askClaude} onPress={() => askClaudeToMerge($, w.path)} />
              <Button key={`ask-no-${w.path}`} label={t.cancel} onPress={() => setUi({ mode: 'list', target: null, conflicts: [] })} />
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingLeft={3}>
          {!w.isCurrent && !w.isPrunable && (
            <Button
              key={`enter-${w.path}`}
              plain
              label={w.isMain ? t.backToMain : t.enter}
              onPress={() => goTo($, w.path, w.isMain)}
            />
          )}
          {w.changes > 0 && !w.isPrunable && (
            <Button key={`save-${w.path}`} plain label={t.save} onPress={() => setUi({ mode: 'commit', target: w.path, then: null })} />
          )}
          {!w.isMain && w.ahead > 0 && (
            <Button key={`merge-${w.path}`} plain label={t.merge} onPress={() => mergeIntoMain($, w.path)} />
          )}
          {!w.isMain && !w.isCurrent && (
            <Button key={`discard-${w.path}`} plain dimColor label={t.discard} onPress={() => setUi({ mode: 'confirm-discard', target: w.path })} />
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}

        <Text dimColor>{t.youAreIn}</Text>
        {here ? (
          <Box flexDirection="column">
            <Text bold color="green">
              {icon(here)} {name(here)}
            </Text>
            <Text color={status(here).color}>{status(here).text}</Text>
          </Box>
        ) : (
          <Text dimColor>—</Text>
        )}

        <Text> </Text>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>{t.listTitle}</Text>
          <Button key="refresh" plain dimColor label="↻" onPress={() => refreshWorktrees($)} />
        </Box>

        {view.list.map(w => (
          <Box key={w.path} flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                {icon(w)} <Text bold={w.isCurrent} color={w.isCurrent ? 'green' : undefined}>{name(w)}</Text>
                {w.isCurrent && <Text color="green"> {t.here}</Text>}
              </Text>
            </Box>
            <Text color={status(w).color}>   {status(w).text}</Text>
            {actions(w)}
          </Box>
        ))}

        <Text> </Text>
        {ui.mode === 'new' ? (
          <Box flexDirection="column">
            {Input ? (
              <Input
                key="new-name"
                label={t.nameLabel}
                placeholder={t.namePlaceholder}
                submitLabel={t.create}
                autoFocus
                onSubmit={(value: string) => addWorktree($, value)}
              />
            ) : null}
            <Text dimColor>{t.createHint(main ? name(main) : 'main')}</Text>
            <Button key="new-no" plain dimColor label={t.cancel} onPress={() => setUi({ mode: 'list' })} />
          </Box>
        ) : (
          Input && <Button key="new" variant="primary" label={t.newBtn} onPress={() => setUi({ mode: 'new' })} />
        )}

        {view.archived.length > 0 && (
          <Box flexDirection="column">
            <Text> </Text>
            <Text dimColor>{t.archivedTitle}</Text>
            {view.archived.map(a => (
              <Box key={`arch-${a.branch}`} flexDirection="column">
                <Text dimColor>
                  📦 {a.branch} <Text color={a.ahead > 0 ? 'cyan' : 'green'}>· {a.ahead > 0 ? t.ahead(a.ahead) : t.merged}</Text>
                </Text>
                {ui.mode === 'confirm-discard' && ui.target === `arch:${a.branch}` ? (
                  <Box flexDirection="column" paddingLeft={3}>
                    <Text color="yellow">{t.discardWarn(0, a.ahead)}</Text>
                    <Box flexDirection="row" gap={2}>
                      <Button key={`drop-yes-${a.branch}`} variant="primary" label={t.discardYes} onPress={() => discardArchived($, a.branch)} />
                      <Button key={`drop-no-${a.branch}`} label={t.cancel} onPress={() => setUi({ mode: 'list', target: null })} />
                    </Box>
                  </Box>
                ) : (
                  <Box flexDirection="row" columnGap={2} paddingLeft={3}>
                    <Button key={`reopen-${a.branch}`} plain label={t.reopen} onPress={() => reopenArchived($, a.branch)} />
                    <Button
                      key={`drop-${a.branch}`}
                      plain
                      dimColor
                      label={t.discard}
                      onPress={() => setUi({ mode: 'confirm-discard', target: `arch:${a.branch}` })}
                    />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}

        <Text> </Text>
        {message}
        {footer}
      </Box>
    )
  })
}
