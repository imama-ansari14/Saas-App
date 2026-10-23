import type { SVGProps } from "react";

// Small stroke icons drawn for this app, 20px grid.
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IconOverview = (p: P) => (
  <Svg {...p}><rect x="3" y="3" width="6" height="8" rx="1.5" /><rect x="11" y="3" width="6" height="5" rx="1.5" /><rect x="11" y="10" width="6" height="7" rx="1.5" /><rect x="3" y="13" width="6" height="4" rx="1.5" /></Svg>
);
export const IconCampaigns = (p: P) => (
  <Svg {...p}><path d="M3 8.5v3a1 1 0 0 0 1 1h2l5 3.5V4L6 7.5H4a1 1 0 0 0-1 1Z" /><path d="M14 7.5a3 3 0 0 1 0 5" /><path d="M16 5.5a6 6 0 0 1 0 9" /></Svg>
);
export const IconCities = (p: P) => (
  <Svg {...p}><path d="M10 17s5.5-4.6 5.5-9A5.5 5.5 0 0 0 4.5 8c0 4.4 5.5 9 5.5 9Z" /><circle cx="10" cy="8" r="2" /></Svg>
);
export const IconSignals = (p: P) => (
  <Svg {...p}><circle cx="10" cy="10" r="1.6" /><path d="M6.5 6.5a5 5 0 0 0 0 7M13.5 6.5a5 5 0 0 1 0 7" /><path d="M4 4a8.5 8.5 0 0 0 0 12M16 4a8.5 8.5 0 0 1 0 12" /></Svg>
);
export const IconPlug = (p: P) => (
  <Svg {...p}><path d="M7 3v4M13 3v4" /><path d="M5 7h10v3a5 5 0 0 1-10 0V7Z" /><path d="M10 15v2.5" /></Svg>
);
export const IconStore = (p: P) => (
  <Svg {...p}><path d="M4 7h12l-1 10H5L4 7Z" /><path d="M7.5 7V5.5a2.5 2.5 0 0 1 5 0V7" /></Svg>
);
export const IconTruck = (p: P) => (
  <Svg {...p}><path d="M2.5 5.5h9v8h-9z" /><path d="M11.5 8.5h3l3 3v2h-6" /><circle cx="6" cy="14.5" r="1.5" /><circle cx="14.5" cy="14.5" r="1.5" /></Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="4" /><circle cx="10" cy="10" r="1" /></Svg>
);
export const IconSync = (p: P) => (
  <Svg {...p}><path d="M16 9a6 6 0 0 0-10.5-3.5L4 7" /><path d="M4 3.5V7h3.5" /><path d="M4 11a6 6 0 0 0 10.5 3.5L16 13" /><path d="M16 16.5V13h-3.5" /></Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}><path d="M5 5l10 10M15 5L5 15" /></Svg>
);
export const IconChevron = (p: P) => (
  <Svg {...p}><path d="M7 5l5 5-5 5" /></Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}><path d="M5 8l5 5 5-5" /></Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}><path d="M3.5 6h13M3.5 10h13M3.5 14h13" /></Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}><path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" /><path d="M4 13v2.5h12V13" /></Svg>
);
export const IconFile = (p: P) => (
  <Svg {...p}><path d="M5.5 2.5h6l3 3v12h-9z" /><path d="M11.5 2.5v3h3" /><path d="M7.5 10h5M7.5 13h5" /></Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></Svg>
);
export const IconCopy = (p: P) => (
  <Svg {...p}><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7" /></Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}><path d="M10 2.5 4 5v4.5c0 3.8 2.6 6.6 6 8 3.4-1.4 6-4.2 6-8V5l-6-2.5Z" /><path d="M7.5 10l2 2 3.5-4" /></Svg>
);
export const IconBolt = (p: P) => (
  <Svg {...p}><path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" /></Svg>
);
export const IconAudit = (p: P) => (
  <Svg {...p}><path d="M5.5 2.5h9v15h-9z" /><path d="M8 6h4M8 9h4" /><circle cx="11.5" cy="13" r="2" /><path d="m13 14.5 1.8 1.8" /></Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}><path d="M10 4v12M4 10h12" /></Svg>
);
