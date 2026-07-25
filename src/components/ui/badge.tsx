import { cn } from '@/lib/utils'

type BadgeVariant =
  | 'default'
  | 'new'
  | 'responded'
  | 'pending'
  | 'red'
  | 'blue'
  | 'orange'
  | 'sla'
  | 'outline'
  | 'secondary'
  | 'destructive'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  new: 'bg-blue-100 text-blue-700',
  responded: 'bg-green-100 text-green-700',
  pending: 'bg-orange-100 text-orange-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  sla: 'bg-amber-100 text-amber-800 text-[10px]',
  outline: 'border border-input bg-transparent text-foreground',
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive/10 text-destructive',
}

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
