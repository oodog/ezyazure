import { getNodesBounds, getViewportForBounds, type Edge, type Node } from 'reactflow'
import { toJpeg } from 'html-to-image'
import type { AzureResource } from '@/types/azure'

export type TopologyExportFormat = 'pdf' | 'jpeg' | 'drawio'

export interface TopologyImage {
  dataUrl: string
  blob: Blob
  width: number
  height: number
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 100
const MIN_EXPORT_WIDTH = 1200
const MIN_EXPORT_HEIGHT = 800
const MAX_EXPORT_DIMENSION = 8192
const MAX_EXPORT_PIXELS = 32_000_000

export function getTopologyImageLayout(nodes: Node[]) {
  const measurableNodes = nodes.map((node) => ({
    ...node,
    width: node.width ?? NODE_WIDTH,
    height: node.height ?? NODE_HEIGHT,
  }))
  const bounds = getNodesBounds(measurableNodes)
  const desiredWidth = Math.max(MIN_EXPORT_WIDTH, Math.ceil(bounds.width + 160))
  const desiredHeight = Math.max(MIN_EXPORT_HEIGHT, Math.ceil(bounds.height + 160))
  const dimensionScale = Math.min(
    1,
    MAX_EXPORT_DIMENSION / desiredWidth,
    MAX_EXPORT_DIMENSION / desiredHeight,
  )
  const width = Math.max(1, Math.round(desiredWidth * dimensionScale))
  const height = Math.max(1, Math.round(desiredHeight * dimensionScale))
  const pixelRatio = Math.min(2, Math.sqrt(MAX_EXPORT_PIXELS / (width * height)))
  const viewport = getViewportForBounds(bounds, width, height, 0.05, 2, 0.12)

  return { bounds, width, height, pixelRatio, viewport }
}

export async function captureTopologyJpeg(
  viewportElement: HTMLElement,
  nodes: Node[],
): Promise<TopologyImage> {
  if (nodes.length === 0) throw new Error('There is no topology to export.')

  const { width, height, pixelRatio, viewport } = getTopologyImageLayout(nodes)
  const dataUrl = await toJpeg(viewportElement, {
    backgroundColor: '#f8fafc',
    cacheBust: true,
    quality: 0.92,
    width,
    height,
    pixelRatio,
    style: {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    },
    filter: (element) => !element.classList?.contains('react-flow__handle'),
  })
  const blob = await (await fetch(dataUrl)).blob()
  return { dataUrl, blob, width, height }
}

export async function createTopologyPdf(
  image: TopologyImage,
  title: string,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const orientation = image.width >= image.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ orientation, unit: 'pt', format: 'a3', compress: true })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 28
  const titleHeight = 24
  const availableWidth = pageWidth - margin * 2
  const availableHeight = pageHeight - margin * 2 - titleHeight
  const scale = Math.min(availableWidth / image.width, availableHeight / image.height)
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  const x = (pageWidth - renderedWidth) / 2
  const y = margin + titleHeight + (availableHeight - renderedHeight) / 2

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor('#0f172a')
  pdf.text(title, margin, margin + 12)
  pdf.addImage(image.dataUrl, 'JPEG', x, y, renderedWidth, renderedHeight, undefined, 'FAST')
  pdf.setProperties({ title, subject: 'EasyAzure discovered topology', creator: 'EasyAzure' })
  return pdf.output('blob')
}

export function createDrawioXml(
  nodes: Node<AzureResource>[],
  edges: Edge[],
  diagramName = 'EasyAzure discovery',
): string {
  const positions = nodes.map((node) => ({
    node,
    x: finiteNumber(node.position.x),
    y: finiteNumber(node.position.y),
  }))
  const minX = positions.length > 0 ? Math.min(...positions.map((item) => item.x)) : 0
  const minY = positions.length > 0 ? Math.min(...positions.map((item) => item.y)) : 0
  const offsetX = minX < 0 ? Math.ceil(-minX + 40) : 0
  const offsetY = minY < 0 ? Math.ceil(-minY + 40) : 0
  const maxX = positions.length > 0
    ? Math.max(...positions.map((item) => item.x + offsetX + NODE_WIDTH))
    : 0
  const maxY = positions.length > 0
    ? Math.max(...positions.map((item) => item.y + offsetY + NODE_HEIGHT))
    : 0
  const pageWidth = Math.min(32767, Math.max(1169, Math.ceil(maxX + 80)))
  const pageHeight = Math.min(32767, Math.max(827, Math.ceil(maxY + 80)))
  const nodeCellIds = new Map(nodes.map((node, index) => [node.id, `node-${index + 2}`]))
  const nodeCells = positions.map(({ node, x: originalX, y: originalY }) => {
    const cellId = nodeCellIds.get(node.id)!
    const label = [node.data.name, shortResourceType(node.data.type), node.data.location]
      .filter(Boolean)
      .join('\n')
    const x = originalX + offsetX
    const y = originalY + offsetY
    return `        <mxCell id="${cellId}" value="${escapeXml(label)}" vertex="1" parent="1" style="rounded=1;whiteSpace=wrap;html=1;shadow=1;fillColor=#ffffff;strokeColor=${nodeColor(node.data.type)};strokeWidth=2;fontColor=#0f172a;align=left;verticalAlign=middle;spacingLeft=12;" easyazureResourceId="${escapeXml(node.data.id)}" easyazureResourceType="${escapeXml(node.data.type)}" easyazureSubscriptionId="${escapeXml(node.data.subscriptionId)}" easyazureResourceGroup="${escapeXml(node.data.resourceGroup)}">
          <mxGeometry x="${x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" as="geometry" />
        </mxCell>`
  })
  const edgeCells = edges.flatMap((edge, index) => {
    const source = nodeCellIds.get(edge.source)
    const target = nodeCellIds.get(edge.target)
    if (!source || !target) return []
    const category = typeof edge.data?.category === 'string' ? edge.data.category : 'contains'
    const dashed = category === 'peering' || category === 'connectedTo' ? '1' : '0'
    return [`        <mxCell id="edge-${index + 2}" value="${escapeXml(String(edge.label ?? ''))}" edge="1" parent="1" source="${source}" target="${target}" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeColor=${edgeColor(category)};strokeWidth=${category === 'default-route' ? 3 : 2};dashed=${dashed};">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>`]
  })
  const modified = new Date().toISOString()

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" modified="${modified}" agent="EasyAzure" version="24.7.17" type="device">
  <diagram id="easyazure-discovery" name="${escapeXml(diagramName)}">
    <mxGraphModel dx="${pageWidth}" dy="${pageHeight}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageWidth}" pageHeight="${pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${[...nodeCells, ...edgeCells].join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
}

export function downloadFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.hidden = true
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function topologyExportFileName(view: string, extension: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10)
  const safeView = view.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `easyazure-${safeView || 'topology'}-${day}.${extension}`
}

function shortResourceType(type: string): string {
  const parts = type.split('/')
  return parts.at(-1) || type
}

function nodeColor(type: string): string {
  const normalized = type.toLowerCase()
  if (normalized.includes('privateendpoint') || normalized.includes('privatelink')) return '#059669'
  if (normalized.includes('firewall') || normalized.includes('networksecuritygroup')) return '#dc2626'
  if (normalized.includes('routetable')) return '#f59e0b'
  if (normalized.includes('virtualnetwork') || normalized.includes('virtualhub')) return '#2563eb'
  if (normalized.includes('virtualmachine')) return '#7c3aed'
  return '#64748b'
}

function edgeColor(category: string): string {
  switch (category) {
    case 'default-route': return '#dc2626'
    case 'peering': return '#2563eb'
    case 'route': return '#f59e0b'
    case 'associatedWith': return '#be185d'
    case 'connectedTo': return '#059669'
    default: return '#94a3b8'
  }
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
}