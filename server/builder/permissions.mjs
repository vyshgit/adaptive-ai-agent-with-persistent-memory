import path from 'node:path'
import { AppError } from '../safety.mjs'
import { relativePath } from './policy.mjs'

export function permissionMode(value = 'strict') {
  if (!['standard', 'strict'].includes(value)) throw new AppError('invalid_request', 'Choose standard risk-based permissions or strict review.')
  return value
}

export function filePermission(change, mode) {
  if (mode === 'strict') return { effect: 'ask', reason: 'Strict review is enabled for every disk change.' }
  if (change.after === null) return { effect: 'ask', reason: 'Deleting a file requires permission.' }
  const name = path.posix.basename(change.path)
  const executionSetup = /^(?:package\.json|(?:package-lock|npm-shrinkwrap)\.json|(?:pnpm-lock|pnpm-workspace)\.yaml|yarn\.lock|bun\.lockb?|(?:Dockerfile|Containerfile)(?:\..*)?|(?:Makefile|Justfile)|(?:docker-)?compose\.ya?ml|(?:vite|webpack|rollup|next|nuxt|svelte|eslint|babel|postcss|tailwind)\.config\..*|(?:pyproject\.toml|setup\.py|requirements.*\.txt|Cargo\.toml|Gemfile))$/i.test(name)
    || /\.(?:sh|bash|zsh|fish|ps1|bat|cmd)$/i.test(name) || /^(?:#!)/.test(change.after)
    || change.path.split('/').some(part => ['scripts', '.github', '.husky', '.vscode'].includes(part))
  return executionSetup ? { effect: 'ask', reason: 'This changes project execution, dependencies or automation configuration.' }
    : { effect: 'allow', reason: 'Routine scoped text-file creation or update.' }
}

const quote = value => `'${value.replaceAll("'", "'\\''")}'`
const gitPrefix = '/usr/bin/git --no-optional-locks --no-pager -c core.fsmonitor=false -c core.hooksPath=/dev/null -c core.untrackedCache=false -c core.pager=cat -c color.ui=false -c diff.external= -c diff.submodule=short -c submodule.recurse=false -c log.showSignature=false'

// Admit a deliberately small grammar, NOT a shell parser or a dangerous-command
// blacklist. Operators, substitutions, expansions, env assignments, arbitrary
// flags, scripts and executables fail closed to an exact human review.
export function commandPermission(command) {
  const ask = reason => ({ effect: 'ask', reason, command, paths: [] })
  if (!/^[A-Za-z0-9._/@+= -]+$/.test(command) || command.length > 4000) return ask('Shell syntax or an unknown command requires permission.')
  const words = command.trim().split(/ +/)
  if (words.length > 40) return ask('This command is outside the small inspection allowlist.')
  if (words[0] === 'pwd' && words.slice(1).every(word => ['-L', '-P'].includes(word))) {
    return { effect: 'allow', reason: 'Inspect the current project directory.', command: `pwd${words.length > 1 ? ` ${words.slice(1).join(' ')}` : ''}`, paths: [] }
  }
  if (words[0] === 'node' && words.length === 2 && ['-v', '--version'].includes(words[1])) {
    return { effect: 'allow', reason: 'Inspect the installed Node runtime version.', command: `${quote(process.execPath)} --version`, paths: [] }
  }
  if (words[0] !== 'git' || !['status', 'diff', 'log'].includes(words[1])) return ask('Installs, project scripts, mutations and unrecognized commands require permission.')
  const operation = words[1], rest = words.slice(2), separator = rest.indexOf('--')
  const flags = separator < 0 ? rest : rest.slice(0, separator), paths = separator < 0 ? [] : rest.slice(separator + 1)
  if (paths.length > 8 || (separator >= 0 && !paths.length)) return ask('Choose a small, explicit set of supported project paths.')
  try { for (const value of paths) relativePath(value, { directory: operation !== 'diff' }) }
  catch { return ask('An unsupported or external path requires permission; use the bounded file tools instead.') }
  if (operation === 'status') {
    const allowed = ['--short', '-s', '--branch', '-b', '--porcelain', '--porcelain=v1', '--porcelain=v2', '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all']
    if (!flags.every(flag => allowed.includes(flag))) return ask('This Git status option is not in the inspection allowlist.')
  } else if (operation === 'diff') {
    const allowed = ['--stat', '--numstat', '--name-only', '--name-status', '--check', '--cached', '--staged', '--no-ext-diff', '--no-textconv', '--color=never']
    if (!flags.every(flag => allowed.includes(flag))) return ask('This Git diff option is not in the inspection allowlist.')
    if (!paths.length && !flags.some(flag => ['--stat', '--numstat', '--name-only', '--name-status'].includes(flag))) {
      return ask('For an automatic full diff, choose supported files with git diff -- <path>. Unscoped diffs need review.')
    }
  } else {
    for (let index = 0; index < flags.length; index++) {
      if (['--oneline', '--no-decorate'].includes(flags[index])) continue
      if (flags[index] === '-n' && /^(?:[1-9]|1\d|20)$/.test(flags[index + 1] || '')) { index++; continue }
      if (/^(?:-n|--max-count=)(?:[1-9]|1\d|20)$/.test(flags[index])) continue
      return ask('Only bounded Git log metadata is automatically admitted; patches, formats and signatures need review.')
    }
  }
  const hardened = operation === 'diff' ? ['--no-ext-diff', '--no-textconv', '--ignore-submodules=all']
    : operation === 'log' ? ['--no-patch', '--no-show-signature', '-n', '10'] : ['--ignore-submodules=all']
  return { effect: 'allow', reason: 'Bounded Git inspection with hooks, external diff/textconv, signatures and pagers disabled.', paths,
    command: `${gitPrefix} ${operation} ${[...hardened, ...flags].join(' ')} -- ${(paths.length ? paths : ['.']).map(quote).join(' ')}` }
}
