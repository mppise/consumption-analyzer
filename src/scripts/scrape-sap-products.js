#!/usr/bin/env node
/**
 * SAP Product Catalog Scraper
 *
 * Crawls https://www.sap.com/products/a-z.html, visits each product page,
 * and extracts high-level capabilities for use as EA context in analyze.md.
 *
 * Output: src/ai/sap-product-catalog.json
 *
 * Usage:
 *   node src/scripts/scrape-sap-products.js [--limit N] [--resume] [--dry-run]
 *
 * Options:
 *   --limit N     Only process the first N products (default: all)
 *   --resume      Skip products already in the output file
 *   --dry-run     Print discovered product URLs without visiting them
 *   --concurrency N  Parallel page fetches (default: 3)
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, '..', 'ai', 'sap-product-catalog.json')
const INDEX_URL   = 'https://www.sap.com/products/a-z.html'
const BASE_URL    = 'https://www.sap.com'

// System Chrome paths (tries each in order)
const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

// Parse CLI args
const args = process.argv.slice(2)
const limit       = parseInt(args[args.indexOf('--limit') + 1] || '0') || 0
const resume      = args.includes('--resume')
const dryRun      = args.includes('--dry-run')
const concurrency = parseInt(args[args.indexOf('--concurrency') + 1] || '3') || 3

// ── Helpers ───────────────────────────────────────────────────────────────────

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p
  }
  throw new Error('No Chrome/Chromium found. Install Google Chrome or set CHROME_PATH env var.')
}

function loadExisting() {
  if (fs.existsSync(OUTPUT_PATH)) {
    try { return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')) }
    catch { return {} }
  }
  return {}
}

function save(catalog) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2), 'utf8')
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Run N async tasks with a concurrency cap
async function withConcurrency(items, limit, fn) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// ── Index page: extract all product links ─────────────────────────────────────

async function scrapeIndex(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })

  process.stderr.write(`Fetching index: ${INDEX_URL}\n`)
  await page.goto(INDEX_URL, { waitUntil: 'networkidle2', timeout: 30000 })

  // Wait for product links to render (JS-heavy page)
  await page.waitForFunction(
    () => document.querySelectorAll('a[href*="/products/"]').length > 10,
    { timeout: 15000 }
  ).catch(() => {})
  await sleep(1000) // extra settle time

  const products = await page.evaluate((base) => {
    const links = Array.from(document.querySelectorAll('a[href]'))
    const seen = new Set()
    const results = []

    for (const a of links) {
      let href = a.getAttribute('href')
      if (!href) continue

      // Normalise to full URL
      try {
        const u = new URL(href, base)
        // Must be sap.com, path starts with /products/, at least 2 segments, ends in .html
        const parts = u.pathname.split('/').filter(Boolean)
        if (!u.hostname.includes('sap.com')) continue
        if (parts[0] !== 'products') continue
        if (parts.length < 2) continue
        if (!u.pathname.endsWith('.html')) continue
        if (u.search || u.hash) continue
        // Exclude index, try/trial, support, pricing, overview pages
        if (/a-z|try-sap|support|pricing|overview|register|contact|request/.test(u.pathname)) continue

        const fullUrl = u.href
        if (seen.has(fullUrl)) continue
        seen.add(fullUrl)

        // Product name: link text, cleaned
        const text = a.textContent?.trim().replace(/\s+/g, ' ') || ''
        const name = text.length > 1 && text.length < 120 ? text : parts[parts.length - 1].replace(/-/g, ' ').replace('.html', '')

        // Category: second path segment (e.g. "technology-platform", "financial-management")
        const category = parts[1]?.replace(/-/g, ' ') || ''

        results.push({ name, url: fullUrl, category })
      } catch {}
    }
    return results
  }, BASE_URL)

  await page.close()
  process.stderr.write(`Found ${products.length} product links on index page.\n`)
  return products
}

// ── Product page: extract capabilities ───────────────────────────────────────

async function scrapePage(browser, product) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: 1280, height: 900 })
    await page.goto(product.url, { waitUntil: 'networkidle2', timeout: 30000 })

    const data = await page.evaluate(() => {
      const txt = (...sels) => {
        for (const s of sels) {
          const el = document.querySelector(s)
          if (el?.textContent?.trim()) return el.textContent.trim().replace(/\s+/g, ' ')
        }
        return ''
      }

      // Product name
      const name = txt('h1', '[class*="product-title"]', '[class*="hero-title"]', 'title')
        .replace(/ \| SAP$/, '').replace(/ - SAP$/, '').trim()

      // Meta description — most reliable summary
      const meta = document.querySelector('meta[name="description"]')?.content?.trim() || ''

      // Category from breadcrumb
      const breadcrumbs = Array.from(document.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="bread"] a'))
        .map(a => a.textContent.trim()).filter(t => t && t !== 'Home' && t !== 'Products')
      const category = breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 1] : ''

      // Tagline: first meaningful p near h1, or meta
      const heroP = Array.from(document.querySelectorAll(
        '[class*="hero"] p, [class*="intro"] p, [class*="headline"] + p, h1 ~ p, [class*="subtitle"]'
      )).find(el => {
        const t = el.textContent.trim()
        return t.length > 20 && t.length < 400 && !t.includes('Be the first') && !t.includes('cookie')
      })
      const tagline = (heroP?.textContent.trim() || meta).slice(0, 300)

      // Capabilities: h3s that appear under "Key features" or "Key benefits" h2
      const h2s = Array.from(document.querySelectorAll('h2'))
      const capabilityH2s = h2s.filter(h => /key (features?|benefits?|capabilities?)/i.test(h.textContent))
      const capabilities = []
      for (const h2 of capabilityH2s) {
        let el = h2.nextElementSibling
        while (el && el.tagName !== 'H2') {
          if (el.tagName === 'H3') {
            const t = el.textContent.trim().replace(/\s+/g, ' ')
            if (t.length > 3 && t.length < 80) capabilities.push(t)
          }
          // Also look for h3s inside divs/sections following this h2
          const h3s = el.querySelectorAll?.('h3') ?? []
          for (const h3 of h3s) {
            const t = h3.textContent.trim().replace(/\s+/g, ' ')
            if (t.length > 3 && t.length < 80 && !capabilities.includes(t)) capabilities.push(t)
          }
          el = el.nextElementSibling
        }
      }

      // Fallback: if no Key Features section, grab all h3s (limited to 6)
      const finalCaps = capabilities.length
        ? capabilities.slice(0, 8)
        : Array.from(document.querySelectorAll('h3'))
            .map(h => h.textContent.trim().replace(/\s+/g, ' '))
            .filter(t => t.length > 5 && t.length < 70 && !/cookie|privacy|legal|nav|menu/i.test(t))
            .slice(0, 6)

      return { name, tagline, category, capabilities: finalCaps, meta }
    })

    // Build clean capabilities list
    const capabilities = [...new Set((data.capabilities ?? []).filter(Boolean))]

    // Description: tagline first, then meta
    const description = (data.tagline || data.meta).slice(0, 500)

    return {
      name: data.name || product.name,
      url: product.url,
      category: data.category || product.category || '',
      tagline: (data.tagline || data.meta).slice(0, 250),
      capabilities,
      description,
      scraped_at: new Date().toISOString().slice(0, 10),
    }
  } catch (err) {
    process.stderr.write(`  ✗ ${product.url}: ${err.message}\n`)
    return { name: product.name, url: product.url, error: err.message, scraped_at: new Date().toISOString().slice(0, 10) }
  } finally {
    await page.close()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const chromePath = process.env.CHROME_PATH || findChrome()
  process.stderr.write(`Using Chrome: ${chromePath}\n`)

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  })

  try {
    // Step 1: Get product list from index
    let products = await scrapeIndex(browser)

    if (limit > 0) {
      products = products.slice(0, limit)
      process.stderr.write(`Limited to ${products.length} products.\n`)
    }

    if (dryRun) {
      process.stdout.write(JSON.stringify(products, null, 2) + '\n')
      return
    }

    // Step 2: Load existing catalog (for resume)
    const catalog = loadExisting()
    if (resume) {
      const before = products.length
      products = products.filter(p => !catalog[p.name] || catalog[p.name].error)
      process.stderr.write(`Resume: ${before - products.length} already scraped, ${products.length} remaining.\n`)
    }

    if (!products.length) {
      process.stderr.write('All products already scraped. Use --limit or remove output file to re-scrape.\n')
      return
    }

    // Step 3: Scrape product pages with concurrency limit
    let done = 0
    await withConcurrency(products, concurrency, async (product) => {
      // Jitter to avoid hammering the server
      await sleep(500 + Math.random() * 1000)
      process.stderr.write(`[${++done}/${products.length}] ${product.name.slice(0, 60)}\n`)
      const result = await scrapePage(browser, product)
      catalog[result.name] = result
      // Save after every product (allows resume on crash)
      save(catalog)
    })

    const total  = Object.keys(catalog).length
    const errors = Object.values(catalog).filter(v => v.error).length
    process.stderr.write(`\nDone. ${total} products in catalog, ${errors} errors.\n`)
    process.stderr.write(`Output: ${OUTPUT_PATH}\n`)
    process.stdout.write(OUTPUT_PATH + '\n')

  } finally {
    await browser.close()
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`)
  process.exit(1)
})
