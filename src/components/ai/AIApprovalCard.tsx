import { AlertTriangle, Check, X } from 'tabler-icons-react'
import { Button } from '../ui/button'

interface AIApprovalCardProps {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  summary: string
  onApprove: (toolCallId: string) => void
  onReject: (toolCallId: string) => void
}

export function AIApprovalCard({ toolCallId, name, args, summary, onApprove, onReject }: AIApprovalCardProps) {
  return (
    <div className="my-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs shadow-sm">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="flex-1">
          <p className="font-semibold text-fg">Destructive Action Requires Approval</p>
          <p className="mt-1 text-muted">{summary || `Ed is asking to run ${name}`}</p>
          {args && Object.keys(args).length > 0 && (
            <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-bg/50 p-1.5 font-mono text-[11px] text-muted">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onReject(toolCallId)}
              className="h-7 gap-1 border-border/80 px-2.5 text-xs text-muted hover:text-danger"
            >
              <X size={13} />
              Reject
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onApprove(toolCallId)}
              className="h-7 gap-1 bg-amber-600 px-3 text-xs text-white hover:bg-amber-700"
            >
              <Check size={13} />
              Approve
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
