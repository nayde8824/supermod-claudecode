export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Lang = 'it' | 'en'

/** A workbranch: a worktree and its branch, born and removed together. */
export type Worktree = {
  path: string
  branch: string | null
  head: string
  isMain: boolean
  isCurrent: boolean
  isLocked: boolean
  isPrunable: boolean
  /** Files changed and not yet committed. */
  changes: number
  /** Commits on this branch that the main branch does not have yet. */
  ahead: number
}

/** A branch with no folder: a workbranch put away. */
export type Archived = { branch: string; ahead: number }

/** The session's project and its workbranches. */
export type WorktreeView = {
  project: string
  /**
   * `own`: its own repository; `inside`: falls into a parent folder's; `none`: no git; `empty`: no commit yet;
   * `unsafe`: the repository's own settings make git run programs, so the pane leaves it alone.
   */
  repo: 'own' | 'inside' | 'none' | 'empty' | 'unsafe'
  parentRepo: string | null
  base: string | null
  list: Worktree[]
  archived: Archived[]
  error: string | null
}

/** What the pane shows: the list, a confirmation, a text field, the help. */
export type WtUi = {
  mode:
    | 'list'
    | 'help'
    | 'confirm-init'
    | 'new'
    | 'commit'
    | 'confirm-leave'
    | 'confirm-discard'
    | 'conflict'
  target: string | null
  /** After the commit, move the session into this worktree ("save and switch"). */
  then: string | null
  busy: boolean
  message: string | null
  isError: boolean
  /** Files in conflict after a failed merge, for "ask Claude". */
  conflicts: string[]
}

export type Prefs = { lang: Lang }

declare module 'claude-code' {
  interface PluginState {
    'supermod-claudecode': {
      tokens: Tokens
      tick: number
      bandHidden: boolean
      worktrees: WorktreeView | null
      wtUi: WtUi
      prefs: Prefs
    }
  }
}
