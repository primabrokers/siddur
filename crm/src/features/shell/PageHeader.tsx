import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  /** The meta line — counts on Today, filters elsewhere. */
  subtitle?: ReactNode
  /** Right-aligned actions. */
  actions?: ReactNode
}

/** Page title block. Mobile-first sizing per `MobileToday.dc.html`. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-col gap-1">
        <h1 className="text-[22px] leading-none font-bold lg:text-[20px]">{title}</h1>
        {subtitle ? <div className="text-[13px] text-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
