import { type EscrowState } from "@/lib/kadena";
import { cn } from "@/lib/utils";
import { 
  Clock, 
  UserCheck, 
  Lock, 
  DollarSign, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface EscrowStatusProps {
  state: EscrowState;
  className?: string;
}

const stateConfig: Record<EscrowState, { 
  label: string; 
  icon: typeof Clock; 
  className: string;
}> = {
  CREATED: { 
    label: "Created", 
    icon: Clock, 
    className: "status-pending" 
  },
  ACCEPTED: { 
    label: "Accepted", 
    icon: UserCheck, 
    className: "status-pending" 
  },
  FUNDED: { 
    label: "Funded", 
    icon: Lock, 
    className: "status-active" 
  },
  PAID: { 
    label: "Paid", 
    icon: DollarSign, 
    className: "status-active" 
  },
  COMPLETED: { 
    label: "Completed", 
    icon: CheckCircle, 
    className: "status-completed" 
  },
  REFUNDED: { 
    label: "Refunded", 
    icon: XCircle, 
    className: "status-cancelled" 
  },
  CLOSED: { 
    label: "Closed", 
    icon: XCircle, 
    className: "status-cancelled" 
  },
  DELETED: { 
    label: "Deleted", 
    icon: XCircle, 
    className: "status-cancelled" 
  },
  DISPUTED: { 
    label: "Disputed", 
    icon: AlertTriangle, 
    className: "status-cancelled" 
  },
};

const DEFAULT_STATE_CONFIG = {
  label: "Unknown",
  icon: Clock,
  className: "status-pending",
} as const;

export function EscrowStatus({ state, className }: EscrowStatusProps) {
  const config = stateConfig[state] ?? DEFAULT_STATE_CONFIG;
  const Icon = config.icon;

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1.5 rounded-md border font-medium text-sm",
      config.className,
      className
    )}>
      <Icon className="h-4 w-4" />
      {config.label}
    </div>
  );
}
