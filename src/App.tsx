import { useEffect, useMemo, useState } from 'react'
import { MapView } from './components/map/MapView'
import { SpeciesRail } from './components/species/SpeciesRail'
import { OccurrenceCard } from './components/occurrence/OccurrenceCard'
import { loadDataset, loadPoints, formatDatasetDate } from './lib/data'
import type { Dataset, PackedPoint } from './types'

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [points, setPoints] = useState<PackedPoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [speciesIndex, setSpeciesIndex] = useState<number | null>(null)
  const [showFossils, setShowFossils] = useState(false)
  const [selectedKey, setSelectedKey] = useState<number | null>(null)
  // Open on desktop, closed on narrow screens where the map needs the room.
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 780)

  // The small species index loads first so the rail can render, then the large
  // point file streams in behind it. The map is usable as soon as points land.
  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch(() => setError('Could not load the dataset. Run "bun run data:all" to generate it.'))
    loadPoints()
      .then(setPoints)
      .catch(() => setError('Could not load the occurrence data. Run "bun run data:all" first.'))
  }, [])

  const filter = useMemo(() => ({ speciesIndex, showFossils }), [speciesIndex, showFossils])

  // Names the map uses for its hover readout, in packed speciesIndex order.
  const speciesNames = useMemo(
    () => dataset?.species.map((s) => s.vernacularName ?? s.scientificName) ?? [],
    [dataset],
  )

  // An extinct species selected while palaeontological records are hidden shows
  // an empty map, which reads as a bug unless we say why.
  const hiddenByFossilToggle =
    !showFossils && speciesIndex !== null && (dataset?.species[speciesIndex]?.extinct ?? false)

  const visibleCount = useMemo(() => {
    if (!points) return null
    if (speciesIndex === null && showFossils) return points.length
    let n = 0
    for (const p of points) {
      if (speciesIndex !== null && p[2] !== speciesIndex) continue
      if (!showFossils && p[6] === 1) continue
      n++
    }
    return n
  }, [points, speciesIndex, showFossils])

  if (error) {
    return (
      <div className="fatal">
        <h1>Felis</h1>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className={`app ${railOpen ? 'rail-open' : ''}`}>
      {dataset && (
        <SpeciesRail
          dataset={dataset}
          selectedIndex={speciesIndex}
          onSelect={(i) => {
            setSpeciesIndex(i)
            setSelectedKey(null)
            // On narrow screens the rail covers the map, so step out of the way
            // once a choice is made. On desktop it sits beside the map already.
            if (window.innerWidth <= 780) setRailOpen(false)
          }}
          showFossils={showFossils}
          onToggleFossils={setShowFossils}
          onCollapse={() => setRailOpen(false)}
        />
      )}

      <main className="stage">
        <header className="topbar">
          <button
            type="button"
            className="rail-toggle"
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? 'Hide the species list' : 'Show the species list'}
            aria-expanded={railOpen}
          >
            🐾 <span className="rail-toggle-text">Cats</span>
          </button>
          <span className="topbar-title">Where have cats been seen?</span>
          {visibleCount !== null && (
            <span className="topbar-count">
              {visibleCount.toLocaleString('en-US')} sightings
            </span>
          )}
        </header>

        <MapView
          points={points}
          filter={filter}
          speciesNames={speciesNames}
          onSelect={setSelectedKey}
          selectedKey={selectedKey}
        />

        {!points && !error && (
          <div className="loading" role="status">
            🐾 Finding the cats…
          </div>
        )}

        {points && visibleCount === 0 && (
          <div className="empty" role="status">
            {hiddenByFossilToggle
              ? 'This cat is extinct. Switch on “Show ancient cats” to see where its fossils were found.'
              : 'No sightings match this choice.'}
          </div>
        )}

        {dataset && (
          <p className="datestamp">
            Updated {formatDatasetDate(dataset.fetchedAt ?? dataset.generatedAt)}
          </p>
        )}
      </main>

      {selectedKey !== null && (
        <OccurrenceCard occurrenceKey={selectedKey} onClose={() => setSelectedKey(null)} />
      )}
    </div>
  )
}
