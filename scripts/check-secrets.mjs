#!/usr/bin/env node
/**
 * Fail CI, or a manual release, when a tracked file looks like a credential.
 *
 * The same scan runs before the settings page pushes a repository; this entry
 * point makes it reusable from `npm run check:secrets` and from CI, so a leaked
 * token is caught even when the push came from a terminal.
 *
 * Usage: node scripts/check-secrets.mjs [repositoryPath]
 */
import { resolve } from 'node:path'
import { scanSecrets } from '../src/publish.js'

const cwd = resolve(process.argv[2] || process.cwd())
const report = await scanSecrets(cwd)
if (report.error) {
  console.error(`check-secrets: ${report.error}`)
  process.exit(2)
}
if (report.ok) {
  console.log(`check-secrets: ${report.scanned} tracked text files scanned, no findings`)
  process.exit(0)
}
for (const finding of report.findings) {
  console.error(`${finding.file}${finding.line ? `:${finding.line}` : ''}\t${finding.kind}`)
}
console.error(`check-secrets: ${report.findings.length} finding(s); remove them before publishing`)
process.exit(1)
