import { Inflate } from 'pako'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type {
  DesignImportHint,
  DesignImportRequest,
} from '@/services/designImportService'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_PDF_PAGES = 8
const MAX_TEXT_LENGTH = 60_000
const MAX_IMAGE_DIMENSION = 1_600
const MAX_IMAGE_DATA_LENGTH = 3_500_000
const MAX_TOTAL_IMAGE_DATA_LENGTH = 16_000_000
const MAX_DRAWIO_XML_LENGTH = 5_000_000

export async function prepareDesignImport(file: File): Promise<DesignImportRequest> {
  if (file.size <= 0) throw new Error('The selected file is empty.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Files must be 15 MB or smaller.')

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (file.type === 'application/pdf' || extension === 'pdf') return preparePdf(file)
  if (extension === 'drawio' || extension === 'xml') return prepareDrawio(file)
  if (['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return prepareImage(file)

  throw new Error('Use a PNG, JPEG, WebP, PDF, .drawio, or draw.io XML file.')
}

async function prepareImage(file: File): Promise<DesignImportRequest> {
  return {
    fileName: file.name,
    documentType: 'image',
    images: [{ dataUrl: await resizeImage(file), pageNumber: 1 }],
    diagramHints: [],
  }
}

async function preparePdf(file: File): Promise<DesignImportRequest> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const bytes = new Uint8Array(await file.arrayBuffer())
  const document = await pdfjs.getDocument({ data: bytes }).promise
  const pageCount = Math.min(document.numPages, MAX_PDF_PAGES)
  const images: DesignImportRequest['images'] = []
  const text: string[] = []

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1.5 })
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(baseViewport.width, baseViewport.height))
    const viewport = page.getViewport({ scale: 1.5 * scale })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('This browser cannot render PDF pages.')
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    canvas.width = 1
    canvas.height = 1
    if (dataUrl.length > MAX_IMAGE_DATA_LENGTH)
      throw new Error(`PDF page ${pageNumber} is too detailed to analyze safely.`)
    if (images.reduce((total, image) => total + image.dataUrl.length, 0) + dataUrl.length > MAX_TOTAL_IMAGE_DATA_LENGTH)
      throw new Error('Combined PDF page images are too large to analyze safely.')
    images.push({ dataUrl, pageNumber })

    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
      .join(' ')
    if (pageText) text.push(`Page ${pageNumber}: ${pageText}`)
    page.cleanup()
  }
  await document.cleanup()

  const omitted = document.numPages > MAX_PDF_PAGES
    ? `Only the first ${MAX_PDF_PAGES} of ${document.numPages} pages were analyzed.`
    : ''
  return {
    fileName: file.name,
    documentType: 'pdf',
    textContent: trimText([omitted, ...text].filter(Boolean).join('\n')),
    images,
    diagramHints: [],
  }
}

async function prepareDrawio(file: File): Promise<DesignImportRequest> {
  const xml = await file.text()
  const hints = parseDrawioXml(xml)
  return {
    fileName: file.name,
    documentType: 'drawio',
    textContent: trimText(hints
      .filter((hint) => hint.label)
      .map((hint) => `${hint.kind}: ${hint.label}`)
      .join('\n')),
    images: [],
    diagramHints: hints,
  }
}

export function parseDrawioXml(xml: string): DesignImportHint[] {
  validateXmlText(xml)
  const parser = new DOMParser()
  const sourceDocument = parser.parseFromString(xml, 'application/xml')
  if (sourceDocument.querySelector('parsererror')) throw new Error('The draw.io XML is invalid.')

  const diagrams = Array.from(sourceDocument.querySelectorAll('mxfile > diagram'))
  const models = sourceDocument.documentElement.tagName === 'mxGraphModel'
    ? [sourceDocument.documentElement]
    : diagrams.map((diagram) => extractGraphModel(diagram, parser))
  if (models.length === 0) throw new Error('No draw.io diagram was found in this file.')

  const hints: DesignImportHint[] = []
  for (const model of models) {
    for (const cell of Array.from(model.querySelectorAll('mxCell'))) {
      const isShape = cell.getAttribute('vertex') === '1'
      const isEdge = cell.getAttribute('edge') === '1'
      if (!isShape && !isEdge) continue
      const geometry = cell.querySelector('mxGeometry')
      hints.push({
        id: cell.getAttribute('id') ?? `element-${hints.length + 1}`,
        label: cleanLabel(cell.getAttribute('value') ?? ''),
        style: trimText(cell.getAttribute('style') ?? '', 2_000),
        kind: isEdge ? 'edge' : 'shape',
        x: numberAttribute(geometry, 'x'),
        y: numberAttribute(geometry, 'y'),
        width: numberAttribute(geometry, 'width'),
        height: numberAttribute(geometry, 'height'),
        parentId: cell.getAttribute('parent') ?? undefined,
        sourceId: cell.getAttribute('source') ?? undefined,
        targetId: cell.getAttribute('target') ?? undefined,
      })
    }
  }
  return hints.slice(0, 400)
}

function extractGraphModel(diagram: Element, parser: DOMParser): Element {
  const directModel = diagram.querySelector('mxGraphModel')
  if (directModel) return directModel
  const encoded = diagram.textContent?.trim()
  if (!encoded) throw new Error('A draw.io page did not contain diagram data.')
  try {
    const compressed = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const inflated = inflateRawBounded(compressed)
    const decoded = decodeURIComponent(inflated)
    validateXmlText(decoded)
    const document = parser.parseFromString(decoded, 'application/xml')
    const model = document.querySelector('mxGraphModel')
    if (!model || document.querySelector('parsererror')) throw new Error()
    return model
  } catch (error: unknown) {
    if (error instanceof Error &&
        (error.message.includes('too large') || error.message.includes('DTD or entity'))) {
      throw error
    }
    throw new Error('The compressed draw.io diagram could not be decoded.')
  }
}

async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height))
  const canvas = window.document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser cannot process images.')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  canvas.width = 1
  canvas.height = 1
  if (dataUrl.length > MAX_IMAGE_DATA_LENGTH)
    throw new Error('The image is too detailed to analyze safely.')
  return dataUrl
}

function cleanLabel(value: string): string {
  const document = new DOMParser().parseFromString(`<body>${value}</body>`, 'text/html')
  return trimText(document.body.textContent ?? '', 500)
}

function numberAttribute(element: Element | null, name: string): number {
  const value = Number(element?.getAttribute(name) ?? 0)
  return Number.isFinite(value) ? value : 0
}

function trimText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const trimmed = value.trim()
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength)
}

function validateXmlText(xml: string) {
  if (xml.length > MAX_DRAWIO_XML_LENGTH)
    throw new Error('The expanded draw.io diagram is too large.')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Draw.io files containing DTD or entity declarations are not supported.')
}

function inflateRawBounded(compressed: Uint8Array): string {
  const inflater = new Inflate({ raw: true, chunkSize: 64 * 1024 })
  const chunks: Uint8Array[] = []
  let total = 0
  inflater.onData = (chunk) => {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
    total += bytes.byteLength
    if (total > MAX_DRAWIO_XML_LENGTH)
      throw new Error('The expanded draw.io diagram is too large.')
    chunks.push(bytes)
  }
  inflater.push(compressed, true)
  if (inflater.err) throw new Error('The compressed draw.io diagram could not be decoded.')
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(output)
}