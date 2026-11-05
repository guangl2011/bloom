import { loadLeadQuality } from '../../lib/data'
import { LeadsView } from '../../components/LeadsView'
import { SourceNote } from '../../components/ui'

export default function LeadsPage() {
  const { leads, source } = loadLeadQuality()
  return (
    <main data-view="leads">
      <div className="page-header">
        <h2>Lead quality</h2>
        <p className="lede">internal_v1 scores · engine attribution (obvious primary, deepline fallback)</p>
      </div>
      <SourceNote source={source} />
      <LeadsView leads={leads} />
    </main>
  )
}
