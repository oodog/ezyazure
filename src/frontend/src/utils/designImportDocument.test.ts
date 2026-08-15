// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { deflateRaw } from 'pako'
import { parseDrawioXml } from './designImportDocument'

const graphModel = `
  <mxGraphModel>
    <root>
      <mxCell id="0" />
      <mxCell id="1" parent="0" />
      <mxCell id="vnet" value="Core VNet" style="shape=mxgraph.azure.virtual_networks" vertex="1" parent="1">
        <mxGeometry x="40" y="60" width="300" height="220" as="geometry" />
      </mxCell>
      <mxCell id="subnet" value="Web Subnet" style="shape=mxgraph.azure.subnets" vertex="1" parent="vnet">
        <mxGeometry x="80" y="110" width="180" height="90" as="geometry" />
      </mxCell>
      <mxCell id="link" value="contains" edge="1" source="vnet" target="subnet" parent="1">
        <mxGeometry relative="1" as="geometry" />
      </mxCell>
    </root>
  </mxGraphModel>`

describe('draw.io import parser', () => {
  it('parses plain mxGraph XML with geometry and relationships', () => {
    const hints = parseDrawioXml(graphModel)

    expect(hints).toHaveLength(3)
    expect(hints.find((hint) => hint.id === 'vnet')).toMatchObject({
      kind: 'shape',
      label: 'Core VNet',
      x: 40,
      y: 60,
      width: 300,
      height: 220,
    })
    expect(hints.find((hint) => hint.id === 'subnet')?.parentId).toBe('vnet')
    expect(hints.find((hint) => hint.id === 'link')).toMatchObject({
      kind: 'edge',
      sourceId: 'vnet',
      targetId: 'subnet',
    })
  })

  it('decodes compressed draw.io pages', () => {
    const encoded = encodeURIComponent(graphModel)
    const compressed = deflateRaw(new TextEncoder().encode(encoded))
    const base64 = Buffer.from(compressed).toString('base64')
    const drawio = `<mxfile><diagram id="page-1" name="Page-1">${base64}</diagram></mxfile>`

    const hints = parseDrawioXml(drawio)

    expect(hints.map((hint) => hint.id)).toEqual(['vnet', 'subnet', 'link'])
  })

  it('rejects invalid XML', () => {
    expect(() => parseDrawioXml('<mxfile><diagram>')).toThrow('invalid')
  })

  it('rejects DTD and entity declarations', () => {
    const xml = '<!DOCTYPE mxfile [<!ENTITY test "value">]><mxfile><diagram>&test;</diagram></mxfile>'
    expect(() => parseDrawioXml(xml)).toThrow('DTD or entity')
  })

  it('rejects compressed diagrams that expand beyond the safety limit', () => {
    const oversized = `<mxGraphModel><root>${'x'.repeat(5_100_000)}</root></mxGraphModel>`
    const encoded = encodeURIComponent(oversized)
    const compressed = deflateRaw(new TextEncoder().encode(encoded))
    const base64 = Buffer.from(compressed).toString('base64')
    const drawio = `<mxfile><diagram>${base64}</diagram></mxfile>`

    expect(() => parseDrawioXml(drawio)).toThrow('too large')
  })
})