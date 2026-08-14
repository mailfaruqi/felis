import type { CountryTally } from '../../types'
import { formatCount } from '../../lib/data'

type Props = {
  title: string
  subtitle: string | null
  total: number
  countries: CountryTally[]
  yearMin: number | null
  yearMax: number | null
}

/** ISO 3166-1 alpha-2 to its flag, by offsetting into the regional indicators. */
function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return '🏳️'
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)),
  )
}

export function SpeciesSummary({ title, subtitle, total, countries, yearMin, yearMax }: Props) {
  const top = countries[0]?.count ?? 1

  return (
    <section className="summary" aria-label="Summary for the current selection">
      <header className="summary-head">
        <h2 className="summary-title">{title}</h2>
        {subtitle && <p className="summary-sub">{subtitle}</p>}
        <p className="summary-total">
          <b>{formatCount(total)}</b> sightings
          {yearMin && yearMax ? ` reported between ${yearMin} and ${yearMax}` : ''}
        </p>
      </header>

      {countries.length > 0 && (
        <ol className="summary-countries">
          {countries.map((c) => (
            <li key={c.code}>
              <span className="summary-flag" aria-hidden="true">
                {flag(c.code)}
              </span>
              <span className="summary-country">{c.name}</span>
              <span className="summary-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(4, (c.count / top) * 100)}%` }} />
              </span>
              <span className="summary-num">{formatCount(c.count)}</span>
            </li>
          ))}
        </ol>
      )}

      <ul className="legend">
        <li>
          <i className="dot dot-precise" /> located to 1 km
        </li>
        <li>
          <i className="dot dot-approx" /> within 10 km
        </li>
        <li>
          <i className="dot dot-coarse" /> vaguer or unrecorded
        </li>
      </ul>
    </section>
  )
}
