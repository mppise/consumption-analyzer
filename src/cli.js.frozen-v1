#!/usr/bin/env node
// @story STORY-001 STORY-002 STORY-003 STORY-004 STORY-005 | cli-scaffold pdf2csv analyze transform dashboard
// @intent root CLI entry point — loads env, registers all five feature flags via commander, accepts positional <file> for full pipeline, dispatches to tool modules, and owns all process.exit() calls

import 'dotenv/config'

import { program } from 'commander'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Read version from package.json without require()
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

// @entry consumption-analyzer --help | commander built-in help; exit 0
// @entry consumption-analyzer [no flags, no positional] | writes error-envelope to stderr; exit 1
// @entry consumption-analyzer <file> | full pipeline — PDF or CSV → transform → analyze? → dashboard

program
  .name('consumption-analyzer')
  .description('CLI tools for analyzing SAP cACV data — PDF-to-CSV, AI analysis, JSON transformation, and HTML dashboard generation')
  .version(pkg.version, '-V, --version', 'output the current version')
  .argument('[file]', 'Input .pdf or .csv file — runs the full pipeline automatically')
  .option('--pdf2csv <file>', 'Extract tables from a PDF file and write CSV to <file>.csv in the data directory')
  .option('--analyze <file>', 'Send a CSV file to the AI model and print a cACV-domain narrative to stdout')
  .option('--transform <file>', 'Parse a cACV CSV and write a structured portfolio JSON to the data directory')
  .option('--dashboard <file>', 'Generate a self-contained HTML dashboard from a portfolio JSON file')
  .option('--serve <file>', 'Generate dashboard and serve it over HTTP (avoids file:// restrictions)')
  .option('--output <file>', 'Optional output path (used with --transform and --dashboard)')
  .option('--build-product-catalog', 'Scrape SAP product A-Z index and build src/ai/sap-product-catalog.json')

// @contract input: process.argv → output: dispatches to tool module or exits | errors: exit 1 on no-flag invocation, exit 1 on user error, exit 2 on processing failure

async function main() {
  program.parse(process.argv)

  const opts = program.opts()
  const positionalFile = program.args[0]

  // --pdf2csv <file>
  // @entry consumption-analyzer --pdf2csv <file> | dispatches to src/tools/pdf2csv.js
  if (opts.pdf2csv !== undefined) {
    const { run, UserError, ProcessingError } = await import('./tools/pdf2csv.js')
    try {
      await run([opts.pdf2csv], opts)
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      if (err instanceof UserError) {
        process.exit(1)
      } else if (err instanceof ProcessingError) {
        process.exit(2)
      } else {
        process.exit(2)
      }
    }
    return
  }

  // --analyze <file>
  // @entry consumption-analyzer --analyze <file> | dispatches to src/tools/analyze.js
  if (opts.analyze !== undefined) {
    const { run, UserError, ProcessingError } = await import('./tools/analyze.js')
    try {
      await run([opts.analyze], opts)
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      if (err instanceof UserError) {
        process.exit(1)
      } else if (err instanceof ProcessingError) {
        process.exit(2)
      } else {
        process.exit(2)
      }
    }
    return
  }

  // --transform <file>
  // @entry consumption-analyzer --transform <file> | dispatches to src/tools/transform.js
  if (opts.transform !== undefined) {
    const { run, UserError, ProcessingError } = await import('./tools/transform.js')
    try {
      await run([opts.transform], opts)
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      if (err instanceof UserError) {
        process.exit(1)
      } else if (err instanceof ProcessingError) {
        process.exit(2)
      } else {
        process.exit(2)
      }
    }
    return
  }

  // --serve <file>
  // @entry consumption-analyzer --serve <file> | generates dashboard then serves over HTTP to avoid file:// restrictions
  if (opts.serve !== undefined) {
    const { run, UserError, ProcessingError } = await import('./tools/dashboard.js')
    let htmlPath
    try {
      // Capture the output path from stdout
      const origWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = (chunk, ...args) => { htmlPath = String(chunk).trim(); return origWrite(chunk, ...args) }
      await run([opts.serve], opts)
      process.stdout.write = origWrite
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      process.exit(err.exitCode ?? 2)
    }
    if (!htmlPath) { process.stderr.write('error: could not determine dashboard output path\n'); process.exit(1) }
    const { createServer } = await import('http')
    const { readFileSync: readSync } = await import('fs')
    const path2 = await import('path')
    const port = 8765
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(readSync(htmlPath))
    })
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}/`
      process.stderr.write(`warn: dashboard served at ${url}\n`)
      // Open in browser
      import('child_process').then(({ exec }) => exec(`open "${url}"`))
    })
    // Keep alive until Ctrl+C
    process.on('SIGINT', () => { server.close(); process.exit(0) })
    await new Promise(() => {})
    return
  }

  // --dashboard <file>
  // @entry consumption-analyzer --dashboard <file> | dispatches to src/tools/dashboard.js
  if (opts.dashboard !== undefined) {
    const { run, UserError, ProcessingError } = await import('./tools/dashboard.js')
    try {
      await run([opts.dashboard], opts)
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      if (err instanceof UserError) {
        process.exit(1)
      } else if (err instanceof ProcessingError) {
        process.exit(2)
      } else {
        process.exit(2)
      }
    }
    return
  }

  // --build-product-catalog
  // @entry consumption-analyzer --build-product-catalog | scrapes SAP A-Z product index
  if (opts.buildProductCatalog) {
    // Always spawn as a child process — the script uses its own async top-level and must run standalone
    const { spawn } = await import('child_process')
    const scriptPath = path.join(__dirname, 'scripts', 'scrape-sap-products.js')
    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    })
    try {
      await new Promise((res, rej) => {
        child.on('exit', c => c === 0 ? res() : rej(new Error(`scrape-sap-products.js exited with code ${c}`)))
        child.on('error', rej)
      })
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      process.exit(2)
    }
    return
  }

  // Positional <file> argument — full pipeline
  // @entry consumption-analyzer <file> | full pipeline: PDF/CSV → transform → analyze (if AI_API_KEY) → dashboard
  if (positionalFile) {
    await runPipeline(positionalFile)
    return
  }

  // No feature flag supplied — user error
  process.stderr.write('error: no command specified — run consumption-analyzer --help for usage\n')
  process.exit(1)
}

/**
 * Full pipeline: given a .pdf or .csv input file, run all applicable stages in order.
 * All intermediate files are written to a subfolder named after the input file (without extension),
 * located in the same directory as the input file.
 *
 * Pipeline:
 *   .pdf → pdf2csv → .csv → transform → portfolio.json → [analyze] → dashboard → dashboard.html
 *   .csv →                    transform → portfolio.json → [analyze] → dashboard → dashboard.html
 *
 * @param {string} inputFile - path to the .pdf or .csv input file
 */
// @entry runPipeline(inputFile) | full pipeline from positional arg
async function runPipeline(inputFile) {
  const resolvedInput = path.isAbsolute(inputFile)
    ? inputFile
    : path.resolve(process.cwd(), inputFile)

  const ext = path.extname(resolvedInput).toLowerCase()

  if (ext !== '.pdf' && ext !== '.csv') {
    process.stderr.write(`error: unsupported file type "${ext}" — expected .pdf or .csv\n`)
    process.exit(1)
  }

  const inputDir = path.dirname(resolvedInput)
  const baseName = path.basename(resolvedInput, ext)

  // All interim files go into a subfolder named after the input file (without extension)
  const { mkdirSync } = await import('fs')
  const outputDir = path.join(inputDir, baseName)
  mkdirSync(outputDir, { recursive: true })

  let csvPath = resolvedInput

  // ---- Step 1: PDF → CSV (only if input is a PDF) ----
  if (ext === '.pdf') {
    process.stderr.write(`info: converting PDF...\n`)
    const { run: runPdf2csv, UserError: UE, ProcessingError: PE } = await import('./tools/pdf2csv.js')
    const csvOutputPath = path.join(outputDir, baseName + '.csv')
    try {
      await runPdf2csv([resolvedInput], { output: csvOutputPath })
    } catch (err) {
      process.stderr.write(`error: ${err.message ?? String(err)}\n`)
      process.exit(err.exitCode ?? (err.name === 'UserError' ? 1 : 2))
    }
    csvPath = csvOutputPath
  }

  // ---- Step 2: CSV → portfolio.json ----
  // transform.js emits "info: computing metrics..." itself
  const portfolioPath = path.join(outputDir, 'portfolio.json')
  const { run: runTransform } = await import('./tools/transform.js')
  try {
    await runTransform([csvPath], { output: portfolioPath })
  } catch (err) {
    process.stderr.write(`error: ${err.message ?? String(err)}\n`)
    process.exit(err.exitCode ?? (err.name === 'UserError' ? 1 : 2))
  }

  // ---- Step 3: AI narrative (only if AI_API_KEY is set) ----
  const { config } = await import('./config/index.js')
  if (config.aiApiKey) {
    process.stderr.write(`info: generating AI narrative...\n`)
    const { run: runAnalyze } = await import('./tools/analyze.js')
    // Pass an output path so narrative doesn't flood stdout — it also gets written to portfolio.json
    const narrativePath = path.join(outputDir, 'narrative.txt')
    try {
      await runAnalyze([portfolioPath], { output: narrativePath })
    } catch (err) {
      // Non-fatal in pipeline context: warn but continue to dashboard
      process.stderr.write(`warn: AI narrative failed — ${err.message ?? String(err)}\n`)
    }
  } else {
    process.stderr.write(`warn: AI_API_KEY not set — skipping narrative\n`)
  }

  // ---- Step 4: portfolio.json → dashboard.html ----
  process.stderr.write(`info: building dashboard...\n`)
  const dashboardPath = path.join(outputDir, 'dashboard.html')
  const { run: runDashboard, UserError: UED, ProcessingError: PED } = await import('./tools/dashboard.js')
  try {
    await runDashboard([portfolioPath], { output: dashboardPath })
  } catch (err) {
    process.stderr.write(`error: ${err.message ?? String(err)}\n`)
    process.exit(err.exitCode ?? (err.name === 'UserError' ? 1 : 2))
  }

  process.stderr.write(`info: dashboard ready → ${dashboardPath}\n`)
}

/**
 * Returns true if any registered tool flag (non-version, non-help, non-output) is present.
 * Version and help are handled by commander before this runs.
 * --output is a modifier flag, not a standalone tool flag.
 */
function hasToolFlag(opts) {
  return (
    opts.pdf2csv !== undefined ||
    opts.analyze !== undefined ||
    opts.transform !== undefined ||
    opts.dashboard !== undefined
  )
}

main().catch(err => {
  process.stderr.write(`error: ${err.message ?? String(err)}\n`)
  process.exit(2)
})
