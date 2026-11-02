/** Thin, bare, one stroke width: the same hand as web shamla's bag. */
function Svg({ size = 20, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function BagIcon() {
  return (
    <Svg>
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </Svg>
  );
}

export function SearchIcon() {
  return (
    <Svg size={18}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

export function CloseIcon() {
  return (
    <Svg>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function PlusIcon() {
  return (
    <Svg size={16}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function MinusIcon() {
  return (
    <Svg size={16}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function ChevronDownIcon() {
  return (
    <Svg size={18}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function ArrowIcon() {
  return (
    <Svg size={18}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}
