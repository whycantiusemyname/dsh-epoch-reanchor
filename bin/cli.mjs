#!/usr/bin/env node

import { cp, lstat, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRESET_IDS = [
  'epoch-reanchor-no-reasoning',
  'epoch-reanchor-with-reasoning',
]
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift() ?? 'status'
  let dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  while (args.length > 0) {
    const flag = args.shift()
    if (flag === '--dsh-home') {
      const value = args.shift()
      if (!value) throw new Error('--dsh-home requires a path')
      dshHome = resolve(value)
      continue
    }
    throw new Error(`unknown argument: ${flag}`)
  }
  return { command, dshHome: resolve(dshHome) }
}

function targetFor(dshHome, presetId) {
  return join(dshHome, '.agent-presets', presetId)
}

async function installPresets(dshHome) {
  const targets = PRESET_IDS.map(presetId => targetFor(dshHome, presetId))
  const existing = targets.filter(existsSync)
  if (existing.length > 0) {
    throw new Error(`preset already exists: ${existing.join(', ')}\nRemove both presets explicitly before reinstalling.`)
  }
  await mkdir(dirname(targets[0]), { recursive: true })
  for (const [index, presetId] of PRESET_IDS.entries()) {
    const target = targets[index]
    await cp(join(packageRoot, 'preset', presetId), target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
    process.stdout.write(`installed ${presetId} preset at ${target}\n`)
  }
}

async function removePresets(dshHome) {
  for (const presetId of PRESET_IDS) {
    const target = targetFor(dshHome, presetId)
    if (!existsSync(target)) {
      process.stdout.write(`preset is not installed: ${target}\n`)
      continue
    }
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`refusing to remove non-directory preset target: ${target}`)
    }
    await rm(target, { recursive: true, force: false })
    process.stdout.write(`removed ${presetId} preset from ${target}\n`)
  }
}

function printHelp() {
  process.stdout.write([
    'Usage: dsh-epoch-reanchor <command> [--dsh-home PATH]',
    '',
    'Commands:',
    '  install-presets Copy both packaged A/B presets into DSH_HOME.',
    '  remove-presets  Remove both exact preset directories.',
    '  status          Print whether each preset is installed.',
    '  paths           Print both target preset paths.',
    '',
  ].join('\n'))
}

try {
  const { command, dshHome } = parseArgs(process.argv.slice(2))
  switch (command) {
    case 'install-preset':
    case 'install-presets':
      await installPresets(dshHome)
      break
    case 'remove-preset':
    case 'remove-presets':
      await removePresets(dshHome)
      break
    case 'status':
      for (const presetId of PRESET_IDS) {
        const target = targetFor(dshHome, presetId)
        process.stdout.write(`${existsSync(target) ? 'installed' : 'not installed'}: ${target}\n`)
      }
      break
    case 'path':
    case 'paths':
      for (const presetId of PRESET_IDS) {
        process.stdout.write(`${targetFor(dshHome, presetId)}\n`)
      }
      break
    case '--help':
    case '-h':
    case 'help':
      printHelp()
      break
    default:
      throw new Error(`unknown command: ${command}`)
  }
} catch (error) {
  process.stderr.write(`dsh-epoch-reanchor: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
