import { useEffect, useState } from 'react'
import type { OccurrenceDetail } from '../../types'
import { fetchOccurrence, formatBasisOfRecord } from '../../lib/gbif'

type Props = {
  occurrenceKey: number
  onClose: () => void
}

function formatUncertainty(m: number | undefined): string {
  if (m == null) return 'Not recorded'
  if (m < 1000) return `± ${Math.round(m)} m`
  return `± ${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

function formatDate(iso: string | undefined, year: number | undefined): string {
  if (!iso) return year ? String(year) : 'Not recorded'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return year ? String(year) : iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function OccurrenceCard({ occurrenceKey, onClose }: Props) {
  const [detail, setDetail] = useState<OccurrenceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    setImageFailed(false)

    fetchOccurrence(occurrenceKey, controller.signal)
      .then(setDetail)
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError('This record could not be loaded from GBIF. It may have been withdrawn.')
      })

    return () => controller.abort()
  }, [occurrenceKey])

  // Escape closes the card, matching the close button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const image = detail?.media.find((m) => m.url)

  return (
    <aside className="card" aria-label="Occurrence detail">
      <button type="button" className="card-close" onClick={onClose} aria-label="Close detail">
        ×
      </button>

      {!detail && !error && <p className="card-status">Loading record {occurrenceKey}…</p>}
      {error && <p className="card-status card-error">{error}</p>}

      {detail && (
        <>
          <p className="card-kicker">Occurrence {detail.key}</p>
          <h2 className="card-title">{detail.species ?? detail.scientificName ?? 'Felis sp.'}</h2>

          {image && !imageFailed && (
            <figure className="card-figure">
              <img
                src={image.url}
                alt={`Photograph of ${detail.species ?? 'this Felis record'}`}
                onError={() => setImageFailed(true)}
                loading="lazy"
              />
              <figcaption>
                {image.creator ?? image.rightsHolder ?? 'Unknown'} · {image.license}
              </figcaption>
            </figure>
          )}

          <dl className="card-fields">
            <div>
              <dt>Location</dt>
              <dd>{detail.locality ?? detail.country ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Country</dt>
              <dd>{detail.country ?? 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{formatDate(detail.eventDate, detail.year)}</dd>
            </div>
            <div>
              <dt>Coordinates</dt>
              <dd>
                {detail.latitude.toFixed(4)}, {detail.longitude.toFixed(4)}
              </dd>
            </div>
            <div>
              <dt>Precision</dt>
              <dd>{formatUncertainty(detail.coordinateUncertaintyInMeters)}</dd>
            </div>
            <div>
              <dt>Basis</dt>
              <dd>{formatBasisOfRecord(detail.basisOfRecord)}</dd>
            </div>
            <div>
              <dt>Recorded by</dt>
              <dd>{detail.recordedBy ?? 'Not stated'}</dd>
            </div>
            <div>
              <dt>Dataset</dt>
              <dd>{detail.datasetName ?? 'Not stated'}</dd>
            </div>
          </dl>

          <a className="card-link" href={detail.gbifUrl} target="_blank" rel="noreferrer">
            View on GBIF ↗
          </a>
        </>
      )}
    </aside>
  )
}
