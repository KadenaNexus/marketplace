import { type EscrowState } from "@/lib/kadena";
import { cn } from "@/lib/utils";
import { 
  Clock, 
  UserCheck, 
  Lock, 
  DollarSign, 
  CheckCircle, 
  XCircle 
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
  DEPOSITED: { 
    label: "Deposited", 
    icon: Lock, 
    className: "status-active" 
  },
  MARKED_PAID: { 
    label: "Marked Paid", 
    icon: DollarSign, 
    className: "status-active" 
  },
  RELEASED: { 
    label: "Released", 
    icon: CheckCircle, 
    className: "status-completed" 
  },
  REFUNDED: { 
    label: "Refunded", 
    icon: XCircle, 
    className: "status-cancelled" 
  },
};

export function EscrowStatus({ state, className }: EscrowStatusProps) {
  const config = stateConfig[state];
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
