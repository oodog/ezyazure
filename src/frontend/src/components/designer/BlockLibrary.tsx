import { useState } from 'react'
import { blockCategories, categoryStyles, blockIcons, type CategoryName } from './blockMetadata'
import type { BlockMeta } from './blockMetadata'

function BlockItem({ meta, onDragStart }: { meta: BlockMeta; onDragStart: (e: React.DragEvent, type: string) => void }) {
  const styles = categoryStyles[meta.category]
  const iconPath = blockIcons[meta.type] ?? blockIcons['Resource Group']

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, meta.type)}
      title={meta.description}
      className="group flex items-center gap-2.5 px-2 py-2 rounded-lg border border-transparent hover:border-gray-200 hover:bg-white hover:shadow-sm cursor-grab active:cursor-grabbing select-none transition-all duration-100"
    >
      {/* Icon */}
      <div
        className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: styles.accent + '18' }}
      >
        <svg
          className="w-3.5 h-3.5"
          style={{ color: styles.accent }}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>

      {/* Label */}
      <span className="text-xs text-gray-700 font-medium leading-tight flex-1 truncate">
        {meta.label}
      </span>

      {/* Drag indicator */}
      <svg
        className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 flex-shrink-0 transition-opacity"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M8 6h2v2H8zm6 0h2v2h-2zM8 11h2v2H8zm6 0h2v2h-2zM8 16h2v2H8zm6 0h2v2h-2z" />
      </svg>
    </div>
  )
}

export default function BlockLibrary() {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Partial<Record<CategoryName, boolean>>>({})

  const onDragStart = (event: React.DragEvent, blockType: string) => {
    event.dataTransfer.setData('application/easyazure-block', blockType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const filteredCategories = blockCategories.map((cat) => ({
    ...cat,
    blocks: cat.blocks.filter(
      (b) =>
        !search ||
        b.label.toLowerCase().includes(search.toLowerCase()) ||
        b.description.toLowerCase().includes(search.toLowerCase()),
    ),
  })).filter((cat) => cat.blocks.length > 0)

  const toggleCategory = (cat: CategoryName) =>
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))

  return (
    <aside className="w-56 bg-gray-50 border border-gray-200 rounded-xl shrink-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-gray-200 bg-white">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Block library</p>
        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search blocks..."
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none bg-gray-50"
          />
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {filteredCategories.map((cat) => {
          const styles = categoryStyles[cat.category]
          const isCollapsed = collapsed[cat.category]

          return (
            <div key={cat.category}>
              {/* Category header */}
              <button
                onClick={() => toggleCategory(cat.category)}
                className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg hover:bg-white text-left transition-colors group mb-0.5"
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: styles.accent }}
                />
                <span className="text-[11px] font-semibold text-gray-600 flex-1 uppercase tracking-wide">
                  {cat.category}
                </span>
                <span className="text-[10px] text-gray-400 font-medium">{cat.blocks.length}</span>
                <svg
                  className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {!isCollapsed && (
                <div className="space-y-0.5 mb-1">
                  {cat.blocks.map((block) => (
                    <BlockItem key={block.type} meta={block} onDragStart={onDragStart} />
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {filteredCategories.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">No blocks match "{search}"</p>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-gray-200 bg-white">
        <p className="text-[10px] text-gray-400 text-center">Drag a block onto the canvas</p>
      </div>
    </aside>
  )
}
