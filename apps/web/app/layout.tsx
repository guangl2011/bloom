import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import './dashboard.css'

export const metadata: Metadata = {
  title: 'Bloom — Ops Dashboard',
  description: 'Bloom v1.0 operations dashboard: workflow runs, approval queue, credits, lead quality',
}

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: '/', label: 'Overview' },
  { href: '/runs', label: 'Runs' },
  { href: '/approvals', label: 'Approvals' },
  { href: '/credits', label: 'Credits' },
  { href: '/leads', label: 'Lead quality' },
]

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="masthead">
            <h1>Bloom Ops</h1>
            <span className="workspace">v1.0 single-tenant · internal use</span>
          </header>
          <nav className="nav" aria-label="Dashboard sections">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </body>
    </html>
  )
}
