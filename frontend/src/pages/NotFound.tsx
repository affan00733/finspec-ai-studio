import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui'

export default function NotFound({ standalone }: { standalone?: boolean }) {
  return (
    <div className={standalone ? 'mx-auto max-w-lg px-5 py-24' : ''}>
      <EmptyState
        title="Page not found"
        action={
          <Link to={standalone ? '/' : '/app'} className="font-medium text-brand-700 hover:underline">
            {standalone ? 'Back to home' : 'Back to the dashboard'}
          </Link>
        }
      >
        That route does not exist in this workspace.
      </EmptyState>
    </div>
  )
}
