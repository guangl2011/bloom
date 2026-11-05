import { loadCredits } from '../../lib/data'
import { CreditsView } from '../../components/CreditsView'
import { SourceNote } from '../../components/ui'

export default function CreditsPage() {
  const { credits, source } = loadCredits()
  return (
    <main data-view="credits">
      <div className="page-header">
        <h2>Credits</h2>
        <p className="lede">internal cost accounting per customer — never customer-facing billing</p>
      </div>
      <SourceNote source={source} />
      <CreditsView credits={credits} />
    </main>
  )
}
