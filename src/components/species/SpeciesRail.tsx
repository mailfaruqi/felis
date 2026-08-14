import type { Dataset, Species } from '../../types'
import { formatCount } from '../../lib/data'

type Props = {
  dataset: Dataset
  selectedIndex: number | null
  onSelect: (index: number | null) => void
  showFossils: boolean
  onToggleFossils: (value: boolean) => void
  onCollapse: () => void
}

/** A latin binomial means nothing to most readers, so the common name leads. */
function primaryName(s: Species): string {
  if (s.unidentified) return 'Not identified'
  return s.vernacularName ?? s.scientificName
}

function secondaryName(s: Species): string {
  if (s.unidentified) return 'Recorded only as Felis'
  if (s.vernacularName) return s.scientificName
  if (s.extinct) return 'Extinct, no common name'
  return s.authorship
}

export function SpeciesRail({
  dataset,
  selectedIndex,
  onSelect,
  showFossils,
  onToggleFossils,
  onCollapse,
}: Props) {
  const totalVisible = showFossils ? dataset.count : dataset.count - dataset.fossilCount

  return (
    <nav className="rail" aria-label="Species filter">
      <div className="rail-head">
        <div className="rail-head-top">
          <p className="rail-kicker">Genus</p>
          <button
            type="button"
            className="rail-collapse"
            onClick={onCollapse}
            aria-label="Hide the species list"
          >
            ‹
          </button>
        </div>
        <h1 className="rail-title">Felis</h1>
        <p className="rail-sub">
          {formatCount(totalVisible)} sightings reported in {dataset.countryCount} countries and
          areas
        </p>
      </div>

      <ul className="species-list">
        <li>
          <button
            type="button"
            className={`species-item ${selectedIndex === null ? 'is-active' : ''}`}
            onClick={() => onSelect(null)}
            aria-pressed={selectedIndex === null}
          >
            <span className="species-name">Every cat</span>
            <span className="species-count">{formatCount(totalVisible)}</span>
            <span className="species-common">All species together</span>
          </button>
        </li>

        {dataset.species.map((s, i) => {
          const visible = showFossils ? s.count : s.count - s.fossilCount

          return (
            <li key={s.key}>
              <button
                type="button"
                className={`species-item ${selectedIndex === i ? 'is-active' : ''}`}
                onClick={() => onSelect(i)}
                aria-pressed={selectedIndex === i}
              >
                <span className="species-name">{primaryName(s)}</span>
                <span className="species-count">{formatCount(visible)}</span>
                <span className="species-common">{secondaryName(s)}</span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="rail-foot">
        <label className="toggle">
          <input
            type="checkbox"
            checked={showFossils}
            onChange={(e) => onToggleFossils(e.target.checked)}
          />
          <span>
            Show ancient cats
            <small>
              {formatCount(dataset.fossilCount)} fossil records from{' '}
              {dataset.extinctSpeciesCount} species that no longer exist
            </small>
          </span>
        </label>

        <p className="provenance">
          Sightings reported to{' '}
          <a href="https://www.gbif.org" target="_blank" rel="noreferrer">
            GBIF
          </a>
          , the global biodiversity database
        </p>
      </div>
    </nav>
  )
}
