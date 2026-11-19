import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createScopedLogger } from '../../lib/logger'

interface Props {
  pageName: string
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class PageErrorBoundary extends Component<Props, State> {
  private logger = createScopedLogger(this.props.pageName)

  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.logger.error('Unhandled React error boundary exception:', error, errorInfo.componentStack)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-panel p-6 text-fg">
          <div className="max-w-md rounded-lg border border-line bg-panel p-6 text-center shadow-lg">
            <h2 className="text-base font-semibold text-fg">Something went wrong in {this.props.pageName}</h2>
            <p className="mt-2 text-xs text-muted">
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded bg-ctl px-4 py-2 text-xs font-medium text-fg hover:opacity-90"
            >
              Reload Window
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
