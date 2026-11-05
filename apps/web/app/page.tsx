const agents: Array<{ name: string; scope: string }> = [
  { name: 'Revenue Intelligence', scope: 'Market map, competitor scan, purchase signals' },
  { name: 'ICP', scope: 'Per-customer lead-scoring model tuning' },
  { name: 'Lead', scope: 'Lead discovery to the monthly quota' },
  { name: 'Outreach', scope: 'Approval-gated email sequences' },
  { name: 'Ad', scope: 'Read-only Google Ads / LinkedIn Ads recommendations' },
  { name: 'Conversion', scope: 'Opportunity tracking via approval-queued CRM writes' },
]

export default function HomePage() {
  return (
    <main style={{ margin: '4rem auto', maxWidth: '40rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Bloom</h1>
      <p>Ops dashboard placeholder — Bloom v1.0 single-tenant platform.</p>
      <ul>
        {agents.map((agent) => (
          <li key={agent.name}>
            <strong>{agent.name}</strong> — {agent.scope}
          </li>
        ))}
      </ul>
      <p>
        Health endpoint: <code>/health</code>
      </p>
    </main>
  )
}
