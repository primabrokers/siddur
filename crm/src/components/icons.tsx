import type { SVGProps } from 'react'

/**
 * Icon set copied verbatim from the wireframes
 * (`docs/donor-crm/spec/wireframes/Main.dc.html` + `MobileToday.dc.html`).
 * 16×16 viewBox, 1.6 stroke, `currentColor` — do not redraw them.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Today / Action Stream — clock. */
export const IconToday = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 2" />
  </Icon>
)

/** Contacts — person. */
export const IconContacts = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="5.5" r="2.6" />
    <path d="M2.8 13.4c.9-2.4 2.9-3.6 5.2-3.6s4.3 1.2 5.2 3.6" />
  </Icon>
)

/** Pipeline — kanban columns. */
export const IconPipeline = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2" y="2.5" width="3.2" height="11" rx="1" />
    <rect x="6.4" y="2.5" width="3.2" height="7" rx="1" />
    <rect x="10.8" y="2.5" width="3.2" height="9" rx="1" />
  </Icon>
)

/** Giving — coin stack. */
export const IconGiving = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 2.5c-3 0-5.5 1.2-5.5 2.7S5 7.9 8 7.9s5.5-1.2 5.5-2.7S11 2.5 8 2.5z" />
    <path d="M2.5 5.2v5.6c0 1.5 2.5 2.7 5.5 2.7s5.5-1.2 5.5-2.7V5.2" />
  </Icon>
)

/** Reports — ascending bars. */
export const IconReports = (props: IconProps) => (
  <Icon {...props}>
    <path d="M2.5 13.5v-4M8 13.5V6M13.5 13.5V2.8" />
  </Icon>
)

/** Settings — gear. */
export const IconSettings = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4" />
  </Icon>
)

/** Global search. */
export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M13.5 13.5 10.4 10.4" />
  </Icon>
)

/** Phone — inline row action. */
export const IconPhone = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 2.5h2.4l1.2 3-1.6 1.2a10 10 0 0 0 4.3 4.3l1.2-1.6 3 1.2v2.4c0 .6-.5 1-1 1C7 14 2 9 2 3.5c0-.5.4-1 1-1z" />
  </Icon>
)

/** WhatsApp — inline row action. */
export const IconWhatsApp = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c3 0 5.5 2.5 5.5 5.5z" />
    <path d="M5.5 8.6c.8 1.4 2 2.3 3.4 2.3l1-.8" />
  </Icon>
)

/** More — the mobile tab-bar overflow. */
export const IconMore = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="3.5" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="12.5" cy="8" r="1.2" />
  </Icon>
)

/** Note / document. */
export const IconNote = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
    <path d="M5.5 6.5h5M5.5 9h3" />
  </Icon>
)

/** The Magic Plus — capture. 24×24 viewBox, 2.2 stroke (MobileToday). */
export const IconPlus = ({ size = 24, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconCheck = ({ size = 24, ...rest }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M4.5 12.5 10 18 19.5 7" />
  </svg>
)
