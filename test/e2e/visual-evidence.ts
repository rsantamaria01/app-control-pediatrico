import { expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

export async function inspectCanvas(page: Page, scope: string) {
  const canvas = page.locator(`${scope} canvas`).first()
  await expect.poll(async () => canvas.evaluate(node => ({ width: (node as HTMLCanvasElement).width, height: (node as HTMLCanvasElement).height }))).toMatchObject({ width: expect.any(Number), height: expect.any(Number) })
  const dimensions = await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement
    const pixels = element.getContext('2d')?.getImageData(0, 0, element.width, element.height).data
    let painted = 0
    if (pixels) for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) painted++
    return { width: element.width, height: element.height, clientWidth: element.clientWidth, clientHeight: element.clientHeight, painted }
  })
  expect(dimensions.width, JSON.stringify(dimensions)).toBeGreaterThan(100)
  expect(dimensions.height, JSON.stringify(dimensions)).toBeGreaterThan(100)
  expect(dimensions.clientHeight).toBeGreaterThan(100)
  expect(dimensions.painted).toBeGreaterThan(100)
  return dimensions
}

export async function inspectZoom(page: Page, scope: string) {
  const region = page.locator(scope)
  const canvas = region.locator('canvas').first()
  await canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement
    ;(window as Window & { task8Original?: Uint8ClampedArray }).task8Original = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
  })
  const difference = () => canvas.evaluate((node) => {
    const element = node as HTMLCanvasElement
    const before = (window as Window & { task8Original?: Uint8ClampedArray }).task8Original!
    const after = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
    let changed = 0
    for (let index = 0; index < after.length; index += 128) if (Math.abs(after[index]! - before[index]!) > 5) changed++
    return changed
  })
  await region.getByRole('button', { name: 'Acercar gráfico' }).first().focus()
  await page.keyboard.press('Enter')
  await expect.poll(difference).toBeGreaterThan(50)
  await region.getByRole('button', { name: 'Restablecer zoom' }).first().focus()
  await page.keyboard.press('Enter')
  await expect.poll(difference).toBeLessThan(50)
}

export async function inspectVisual(page: Page, label: string, width: number, mode: 'light' | 'dark') {
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `/tmp/opencode/task8-${label}-${width}-${mode}.png`, fullPage: true })
  const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }))
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport + 1)
  const samples = await page.evaluate(() => {
    function rgb(input: string, background = 'white') {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = background
      context.fillRect(0, 0, 1, 1)
      context.fillStyle = input
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value / 255)
    }
    function lum(values: number[]) {
      const [r, g, b] = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return r! * 0.2126 + g! * 0.7152 + b! * 0.0722
    }
    return Array.from(document.querySelectorAll('main h1, main h2, main p, main label, main button')).filter(el => el.textContent?.trim() && (el as HTMLElement).offsetParent !== null).slice(0, 40).map((el) => {
      const style = getComputedStyle(el)
      let backdrop: Element | null = el
      const layers: string[] = []
      while (backdrop) {
        const current = getComputedStyle(backdrop).backgroundColor
        if (current !== 'rgba(0, 0, 0, 0)' && current !== 'transparent') layers.push(current)
        backdrop = backdrop.parentElement
      }
      let background = 'white'
      for (const layer of layers.reverse()) {
        const channel = rgb(layer, background).map(value => Math.round(value * 255))
        background = `rgb(${channel.join(',')})`
      }
      const foreground = rgb(style.color, background)
      const behind = rgb(background)
      const ratio = foreground && behind ? (Math.max(lum(foreground), lum(behind)) + 0.05) / (Math.min(lum(foreground), lum(behind)) + 0.05) : 0
      const bounds = el.getBoundingClientRect()
      return { text: el.textContent?.trim().slice(0, 60), ratio, fg: style.color, bg: background, box: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } }
    })
  })
  expect(samples.length).toBeGreaterThan(0)
  await writeFile(`/tmp/opencode/task8-${label}-${width}-${mode}.json`, JSON.stringify({ dimensions, samples }, null, 2))
  expect(samples.filter(sample => sample.ratio < 4.5), JSON.stringify(samples.filter(sample => sample.ratio < 4.5))).toEqual([])
  expect(samples.filter(sample => sample.box.width === 0 || sample.box.height === 0), JSON.stringify(samples.filter(sample => sample.box.width === 0 || sample.box.height === 0))).toEqual([])
  return { dimensions, samples }
}
