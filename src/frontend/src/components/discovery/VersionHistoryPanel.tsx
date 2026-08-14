import { useEffect, useMemo, useState } from 'react'
import { discoveryService } from '@/services/discoveryService'
import type { DiscoverySnapshotSummary, DiscoveryDiff } from '@/services/discoveryService'

interface VersionHistoryPanelProps {
  /** Subscriptions currently selected — used when saving a new snapshot. */
  subscriptionIds: string[]
  /** Whether a topology is loaded (enables the "Save current" action). */
  hasTopology: boolean
  onClose: () => void
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * Discovery versioning UI. Lists persisted snapshots, lets the user save the current
 * topology, pick two snapshots to compare, and shows the diff (added / removed / changed
 * resources) so customers can see exactly what changed between discoveries.
 */
export default function VersionHistoryPanel({
  subscriptionIds,
  hasTopology,
  onClose,
}: VersionHistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<DiscoverySnapshotSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [diff, setDiff] = useState<DiscoveryDiff | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await discoveryService.listSnapshots()
      setSnapshots(list)
      // Default the comparison to the two most recent snapshots.
      if (list.length >= 2) {
        setToId((cur) => cur ?? list[0].id)
        setFromId((cur) => cur ?? list[1].id)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const save = async () => {
    if (subscriptionIds.length === 0) return
    setSaving(true)
    setError(null)
    try {
      await discoveryService.saveSnapshot({
        subscriptionIds,
        label: label.trim() || undefined,
      })
      setLabel('')
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save snapshot.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await discoveryService.deleteSnapshot(id)
      if (fromId === id) setFromId(null)
      if (toId === id) setToId(null)
      setDiff(null)
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete snapshot.')
    }
  }

  const compare = async () => {
    if (!fromId || !toId || fromId === toId) return
    setDiffLoading(true)
    setError(null)
    try {
      const result = await discoveryService.diffSnapshots(fromId, toId)
      setDiff(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to compute diff.')
    } finally {
      setDiffLoading(false)
    }
  }

  const canCompare = !!fromId && !!toId && fromId !== toId

  const totalChanges = useMemo(
    () => (diff ? diff.added.length + diff.removed.length + diff.changed.length : 0),
    [diff],
  )

  return (
    <aside className="w-[28rem] shrink-0 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Version history</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close">
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto">
        {/* Save current */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-700">Save current discovery as a version</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label (e.g. before firewall change)"
              className="flex-1 text-sm px-3 py-2 border border-gray-300 rounded-lg"
            />
            <button
              type="button"
              onClick={save}
              disabled={!hasTopology || subscriptionIds.length === 0 || saving}
              className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg whitespace-nowrap"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {!hasTopology && (
            <p className="text-[11px] text-gray-400">Run a discovery first to capture a version.</p>
          )}
        </div>

        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{error}</div>
        )}

        {/* Snapshot list */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-700">Saved versions ({snapshots.length})</span>
            <button onClick={refresh} className="text-[11px] text-azure-600 hover:underline">
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {snapshots.length === 0 ? (
            <p className="text-xs text-gray-400">No versions saved yet.</p>
          ) : (
            <ul className="space-y-1">
              {snapshots.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 px-2 py-1.5 border border-gray-100 rounded-lg text-xs"
                >
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <label className="flex items-center gap-1" title="Compare from (older)">
                      <input
                        type="radio"
                        name="fromSnap"
                        checked={fromId === s.id}
                        onChange={() => setFromId(s.id)}
                      />
                      <span className="text-[10px] text-gray-500">from</span>
                    </label>
                    <label className="flex items-center gap-1" title="Compare to (newer)">
                      <input
                        type="radio"
                        name="toSnap"
                        checked={toId === s.id}
                        onChange={() => setToId(s.id)}
                      />
                      <span className="text-[10px] text-gray-500">to</span>
                    </label>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">{s.label || fmt(s.capturedAt)}</div>
                    <div className="text-gray-400 truncate">
                      {fmt(s.capturedAt)} · {s.nodeCount} resources
                    </div>
                  </div>
                  <button
                    onClick={() => remove(s.id)}
                    className="text-gray-300 hover:text-red-600 shrink-0"
                    title="Delete this version"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Compare */}
        <div>
          <button
            type="button"
            onClick={compare}
            disabled={!canCompare || diffLoading}
            className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg"
          >
            {diffLoading ? 'Comparing…' : 'Compare selected versions'}
          </button>
          {fromId && toId && fromId === toId && (
            <p className="text-[11px] text-amber-600 mt-1">Select two different versions to compare.</p>
          )}
        </div>

        {/* Diff result */}
        {diff && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-900">Changes</span>
              <span className="text-gray-400">{totalChanges} total</span>
            </div>
            <p className="text-[11px] text-gray-500">
              {fmt(diff.fromCapturedAt)} → {fmt(diff.toCapturedAt)}
            </p>

            {totalChanges === 0 && (
              <p className="text-xs text-gray-500">No differences between these versions.</p>
            )}

            {diff.added.length > 0 && (
              <DiffGroup title={`Added (${diff.added.length})`} color="green">
                {diff.added.map((r) => (
                  <ResourceRow key={r.id} name={r.name} type={r.type} />
                ))}
              </DiffGroup>
            )}

            {diff.removed.length > 0 && (
              <DiffGroup title={`Removed (${diff.removed.length})`} color="red">
                {diff.removed.map((r) => (
                  <ResourceRow key={r.id} name={r.name} type={r.type} />
                ))}
              </DiffGroup>
            )}

            {diff.changed.length > 0 && (
              <DiffGroup title={`Changed (${diff.changed.length})`} color="amber">
                {diff.changed.map((r) => (
                  <li key={r.id} className="text-xs">
                    <div className="font-medium text-gray-900">{r.name}</div>
                    <div className="text-gray-400 mb-1">{r.type.split('/').pop()}</div>
                    <ul className="space-y-0.5 pl-2 border-l-2 border-amber-200">
                      {r.changes.slice(0, 12).map((c, i) => (
                        <li key={i} className="text-[11px]">
                          <span className="text-gray-500 font-mono">{c.path}</span>
                          <div className="flex gap-1 flex-wrap">
                            <span className="text-red-600 line-through break-all">{c.oldValue ?? '∅'}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-green-700 break-all">{c.newValue ?? '∅'}</span>
                          </div>
                        </li>
                      ))}
                      {r.changes.length > 12 && (
                        <li className="text-[11px] text-gray-400">+{r.changes.length - 12} more changes…</li>
                      )}
                    </ul>
                  </li>
                ))}
              </DiffGroup>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function DiffGroup({
  title,
  color,
  children,
}: {
  title: string
  color: 'green' | 'red' | 'amber'
  children: React.ReactNode
}) {
  const colorMap = {
    green: 'text-green-700',
    red: 'text-red-700',
    amber: 'text-amber-700',
  }
  return (
    <div>
      <p className={`text-xs font-semibold mb-1 ${colorMap[color]}`}>{title}</p>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  )
}

function ResourceRow({ name, type }: { name: string; type: string }) {
  return (
    <li className="text-xs">
      <span className="font-medium text-gray-900">{name}</span>
      <span className="text-gray-400"> · {type.split('/').pop()}</span>
    </li>
  )
}
