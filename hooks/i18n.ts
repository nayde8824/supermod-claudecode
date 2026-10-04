import type { Lang } from '../types'

// Every word the mod shows, per language, in plain words for people who don't know git.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const it = {
  // usage bar
  context: 'contesto',
  fiveHours: '5 ore',
  week: 'settimana',
  spend: 'spesa',
  cost: 'costo',
  tokens: 'token',
  barHidden: 'Riga Usage nascosta.',
  barShown: 'Riga Usage visibile.',
  barCmd: 'Mostra/nasconde la riga Usage sopra il prompt',
  paneCmd: 'Apre il pannello Workbranch',
  paneOpened: 'Pannello Workbranch aperto.',

  // pane
  project: 'PROGETTO',
  youAreIn: 'SEI IN',
  reading: 'Leggo il progetto…',
  wait: 'Un attimo…',
  mainName: 'Versione principale',
  listTitle: 'I TUOI WORKBRANCH',
  archivedTitle: 'WORKBRANCH ARCHIVIATI',
  here: '◀ qui',
  newBtn: '+ Nuovo workbranch',
  namePlaceholder: 'es. nuova-grafica',
  nameLabel: 'Nome ',
  create: 'crea',
  createHint: (from: string) => `Invio per creare ed entrare · parte da ${from}`,
  cancel: 'annulla',
  save: 'Salva',
  enter: 'Entra',
  backToMain: 'Torna alla principale',
  merge: 'Porta nella principale',
  discard: 'Butta via',
  reopen: 'Riapri',
  help: '? cosa sono i workbranch',
  helpText: [
    'Un workbranch è una copia di prova del progetto.',
    'Ci lavori senza toccare la versione principale: se la prova va bene la porti nella principale, se va male la butti via.',
    'Salva spesso: ogni salvataggio è un punto a cui puoi tornare.',
  ],
  close: 'chiudi',
  changes: (n: number) => `${plural(n, 'modifica', 'modifiche')} da salvare`,
  ahead: (n: number) => `${plural(n, 'salvataggio', 'salvataggi')} da portare nella principale`,
  merged: '✓ già nella principale',
  clean: '✓ tutto salvato',
  missing: 'cartella mancante',

  // no repository
  unsafeTitle: 'Workbranch disattivati in questo progetto',
  unsafeText:
    'Le impostazioni git di questo progetto fanno eseguire dei programmi a git. Per sicurezza il pannello non lo legge da solo: se ti fidi del progetto, usa git normalmente.',
  noRepoTitle: 'Questo progetto non ha ancora i workbranch',
  noRepoText: 'Per usarli bisogna attivare la cronologia delle versioni (git).',
  insideText: (parent: string) => `Ora le sue versioni finiscono insieme ad altri progetti, nella cartella ${parent}.`,
  emptyTitle: 'Cronologia attivata, manca il primo salvataggio',
  emptyText: 'Fai il primo salvataggio per iniziare.',
  activate: 'Attiva',
  firstSave: 'Primo salvataggio',
  confirmInit: (p: string) => `Attivo la cronologia in ${p} e faccio il primo salvataggio?`,
  yesActivate: 'Sì, attiva',

  // commit
  messageLabel: 'Cosa hai cambiato? ',
  messagePlaceholder: (n: number) => `(vuoto: ${plural(n, 'file', 'file')})`,
  saveAndSwitch: 'salva e spostati',
  saveHint: (then: boolean): string => (then ? 'Invio per salvare, poi ti sposto' : 'Invio per salvare'),
  defaultMessage: (n: number) => `Salvataggio dal pannello (${plural(n, 'file', 'file')})`,

  // leave
  leaveWarn: (name: string, n: number) =>
    `⚠ In ${name} hai ${plural(n, 'modifica non salvata', 'modifiche non salvate')}. Restano lì anche se ti sposti.`,
  saveThenGo: 'Salva e spostati',
  justGo: 'Spostati e basta',

  // discard
  discardWarn: (changes: number, ahead: number) =>
    changes || ahead
      ? `⚠ Perderai ${[changes && plural(changes, 'modifica non salvata', 'modifiche non salvate'), ahead && plural(ahead, 'salvataggio non portato nella principale', 'salvataggi non portati nella principale')].filter(Boolean).join(' e ')}. Sicuro?`
      : 'Butto via questo workbranch? È già tutto nella principale.',
  discardYes: 'Sì, butta via',
  discardHere: 'Sei dentro questo workbranch: torna alla principale per buttarlo via.',

  // merge / conflicts
  mergeSaveFirst: 'Prima salva le modifiche di questo workbranch.',
  mainDirty: 'La versione principale ha modifiche non salvate: salvale prima.',
  conflictTitle: (files: number) => `⚠ ${plural(files, 'file è stato cambiato', 'file sono stati cambiati')} in modo diverso nei due punti.`,
  askClaude: 'Chiedi a Claude di sistemarlo',
  askPrompt: (branch: string, base: string) =>
    `Unisci il branch ${branch} nel branch ${base} di questo progetto, nella cartella della versione principale ` +
    `(trovala con git worktree list). Il merge darà dei conflitti: dopo averlo avviato guardali con git status, risolvili tenendo entrambe ` +
    `le modifiche quando ha senso, spiegami le scelte e fai il commit del merge.`,

  // results
  working: {
    init: 'Attivo la cronologia…',
    save: 'Salvo…',
    create: (n: string) => `Creo ${n}…`,
    move: 'Sposto la sessione…',
    merge: 'Porto nella principale…',
    discard: 'Butto via…',
    reopen: 'Riapro…',
  },
  done: {
    init: (size: string) => `Cronologia attivata, primo salvataggio fatto (${size}).`,
    tooBig: (size: string, biggest: string) =>
      `Il primo salvataggio peserebbe ${size}. I più grandi: ${biggest}. Escludili in .gitignore e premi "Primo salvataggio".`,
    saved: (n: number, where: string) => `Salvate ${plural(n, 'modifica', 'modifiche')} in ${where}.`,
    nothing: 'Niente da salvare.',
    created: (n: string) => `Workbranch ${n} creato.`,
    moved: (where: string) => `Ora lavori in ${where}.`,
    merged: (n: string) => `${n} è nella versione principale ✓`,
    discarded: (n: string) => `${n} buttato via.`,
    reopened: (n: string) => `${n} riaperto.`,
    needName: 'Scrivi un nome, per esempio nuova-grafica.',
    failed: (what: string) => `Non è riuscito: ${what}`,
    notMoved: (why: string) => `Non mi sono spostato: ${why}`,
  },
}

type Words = typeof it

const en: Words = {
  context: 'context',
  fiveHours: '5 hours',
  week: 'week',
  spend: 'spend',
  cost: 'cost',
  tokens: 'tokens',
  barHidden: 'Usage bar hidden.',
  barShown: 'Usage bar shown.',
  barCmd: 'Shows/hides the usage bar above the prompt',
  paneCmd: 'Opens the Workbranch pane',
  paneOpened: 'Workbranch pane opened.',

  project: 'PROJECT',
  youAreIn: 'YOU ARE IN',
  reading: 'Reading the project…',
  wait: 'One moment…',
  mainName: 'Main version',
  listTitle: 'YOUR WORKBRANCHES',
  archivedTitle: 'PUT AWAY',
  here: '◀ here',
  newBtn: '+ New workbranch',
  namePlaceholder: 'e.g. new-design',
  nameLabel: 'Name ',
  create: 'create',
  createHint: (from: string) => `Enter to create and switch · starts from ${from}`,
  cancel: 'cancel',
  save: 'Save',
  enter: 'Enter',
  backToMain: 'Back to main',
  merge: 'Bring into main',
  discard: 'Throw away',
  reopen: 'Reopen',
  help: '? what is a workbranch',
  helpText: [
    'A workbranch is a trial copy of your project.',
    "You work in it without touching the main version: if it goes well you bring it into main, if not you throw it away.",
    'Save often: every save is a point you can go back to.',
  ],
  close: 'close',
  changes: (n: number) => `${plural(n, 'change', 'changes')} to save`,
  ahead: (n: number) => `${plural(n, 'save', 'saves')} to bring into main`,
  merged: '✓ already in main',
  clean: '✓ all saved',
  missing: 'folder missing',

  unsafeTitle: 'Workbranches are off in this project',
  unsafeText:
    "This project's git settings make git run programs. For safety the pane won't read it on its own: if you trust the project, use git as usual.",
  noRepoTitle: "This project doesn't have workbranches yet",
  noRepoText: 'To use them, turn on version history (git).',
  insideText: (parent: string) => `Right now its versions end up with other projects, in the ${parent} folder.`,
  emptyTitle: 'History is on, the first save is missing',
  emptyText: 'Make the first save to start.',
  activate: 'Turn on',
  firstSave: 'First save',
  confirmInit: (p: string) => `Turn on history in ${p} and make the first save?`,
  yesActivate: 'Yes, turn on',

  messageLabel: 'What did you change? ',
  messagePlaceholder: (n: number) => `(empty: ${plural(n, 'file', 'files')})`,
  saveAndSwitch: 'save and switch',
  saveHint: (then: boolean): string => (then ? 'Enter to save, then I switch' : 'Enter to save'),
  defaultMessage: (n: number) => `Saved from the pane (${plural(n, 'file', 'files')})`,

  leaveWarn: (name: string, n: number) =>
    `⚠ ${name} has ${plural(n, 'unsaved change', 'unsaved changes')}. They stay there if you switch.`,
  saveThenGo: 'Save and switch',
  justGo: 'Just switch',

  discardWarn: (changes: number, ahead: number) =>
    changes || ahead
      ? `⚠ You will lose ${[changes && plural(changes, 'unsaved change', 'unsaved changes'), ahead && plural(ahead, 'save not in main', 'saves not in main')].filter(Boolean).join(' and ')}. Sure?`
      : 'Throw this workbranch away? Everything is already in main.',
  discardYes: 'Yes, throw away',
  discardHere: "You're inside this workbranch: go back to main to throw it away.",

  mergeSaveFirst: "Save this workbranch's changes first.",
  mainDirty: 'The main version has unsaved changes: save them first.',
  conflictTitle: (files: number) => `⚠ ${plural(files, 'file was', 'files were')} changed differently in the two places.`,
  askClaude: 'Ask Claude to fix it',
  askPrompt: (branch: string, base: string) =>
    `Merge the branch ${branch} into ${base} in this project, in the main version's folder ` +
    `(find it with git worktree list). The merge will conflict: once started, look at the conflicts with git status, resolve them keeping ` +
    `both changes where it makes sense, explain your choices and commit the merge.`,

  working: {
    init: 'Turning on history…',
    save: 'Saving…',
    create: (n: string) => `Creating ${n}…`,
    move: 'Moving the session…',
    merge: 'Bringing into main…',
    discard: 'Throwing away…',
    reopen: 'Reopening…',
  },
  done: {
    init: (size: string) => `History on, first save done (${size}).`,
    tooBig: (size: string, biggest: string) =>
      `The first save would weigh ${size}. Biggest: ${biggest}. Exclude them in .gitignore and press "First save".`,
    saved: (n: number, where: string) => `Saved ${plural(n, 'change', 'changes')} in ${where}.`,
    nothing: 'Nothing to save.',
    created: (n: string) => `Workbranch ${n} created.`,
    moved: (where: string) => `Now working in ${where}.`,
    merged: (n: string) => `${n} is in the main version ✓`,
    discarded: (n: string) => `${n} thrown away.`,
    reopened: (n: string) => `${n} reopened.`,
    needName: 'Type a name, for example new-design.',
    failed: (what: string) => `It didn't work: ${what}`,
    notMoved: (why: string) => `Didn't switch: ${why}`,
  },
}

export const words = (lang: Lang): Words => (lang === 'en' ? en : it)

export type { Words }
