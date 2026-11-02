import type { CSSProperties, ReactElement } from "react";

export type IconName =
  | "search" | "x" | "check" | "check-circle" | "plus" | "minus" | "trash" | "edit" | "bell" | "user" | "log-out"
  | "chevron-down" | "chevron-up" | "chevron-left" | "chevron-right" | "arrow-left" | "arrow-right" | "arrow-up" | "arrow-down"
  | "arrow-down-left" | "arrow-up-right" | "alert-triangle" | "alert-circle" | "info" | "package" | "grid" | "book-open"
  | "more-horizontal" | "filter" | "clock" | "calendar" | "external-link" | "download" | "upload" | "file-text" | "inbox"
  | "truck" | "tag" | "link" | "refresh" | "camera" | "menu" | "layers" | "activity" | "hash" | "eye" | "copy" | "printer"
  | "settings" | "sun" | "moon" | "tool" | "users" | "user-plus" | "clipboard-check";

export type Tone = "neutral" | "success" | "warning" | "danger" | "accent";
export type MovementType = "in" | "out" | "fault" | "adjust";

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

type Shape =
  | { t: "circle"; cx: number; cy: number; r: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number }
  | { t: "polyline"; points: string }
  | { t: "polygon"; points: string }
  | { t: "path"; d: string }
  | { t: "rect"; x: number; y: number; width: number; height: number; rx?: number; ry?: number };

const c = (cx: number, cy: number, r: number): Shape => ({ t: "circle", cx, cy, r });
const l = (x1: number, y1: number, x2: number, y2: number): Shape => ({ t: "line", x1, y1, x2, y2 });
const pl = (points: string): Shape => ({ t: "polyline", points });
const pg = (points: string): Shape => ({ t: "polygon", points });
const p = (d: string): Shape => ({ t: "path", d });
const r = (x: number, y: number, width: number, height: number, rx?: number, ry?: number): Shape => ({ t: "rect", x, y, width, height, rx, ry });

/* Feather-style, 24 viewBox, stroke 2, round caps/joins — ported from the reference bundle. */
const ICONS: Record<IconName, Shape[]> = {
  "search": [c(11, 11, 8), l(21, 21, 16.65, 16.65)],
  "x": [l(18, 6, 6, 18), l(6, 6, 18, 18)],
  "check": [pl("20 6 9 17 4 12")],
  "check-circle": [p("M22 11.08V12a10 10 0 1 1-5.93-9.14"), pl("22 4 12 14.01 9 11.01")],
  "plus": [l(12, 5, 12, 19), l(5, 12, 19, 12)],
  "minus": [l(5, 12, 19, 12)],
  "trash": [pl("3 6 5 6 21 6"), p("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"), l(10, 11, 10, 17), l(14, 11, 14, 17)],
  "edit": [p("M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z")],
  "bell": [p("M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"), p("M13.73 21a2 2 0 0 1-3.46 0")],
  "user": [p("M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"), c(12, 7, 4)],
  "log-out": [p("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), pl("16 17 21 12 16 7"), l(21, 12, 9, 12)],
  "chevron-down": [pl("6 9 12 15 18 9")],
  "chevron-up": [pl("18 15 12 9 6 15")],
  "chevron-left": [pl("15 18 9 12 15 6")],
  "chevron-right": [pl("9 18 15 12 9 6")],
  "arrow-left": [l(19, 12, 5, 12), pl("12 19 5 12 12 5")],
  "arrow-right": [l(5, 12, 19, 12), pl("12 5 19 12 12 19")],
  "arrow-up": [l(12, 19, 12, 5), pl("5 12 12 5 19 12")],
  "arrow-down": [l(12, 5, 12, 19), pl("19 12 12 19 5 12")],
  "arrow-down-left": [l(17, 7, 7, 17), pl("17 17 7 17 7 7")],
  "arrow-up-right": [l(7, 17, 17, 7), pl("7 7 17 7 17 17")],
  "alert-triangle": [p("M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"), l(12, 9, 12, 13), l(12, 17, 12.01, 17)],
  "alert-circle": [c(12, 12, 10), l(12, 8, 12, 12), l(12, 16, 12.01, 16)],
  "info": [c(12, 12, 10), l(12, 16, 12, 12), l(12, 8, 12.01, 8)],
  "package": [p("M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"), pl("3.27 6.96 12 12.01 20.73 6.96"), l(12, 22.08, 12, 12)],
  "grid": [r(3, 3, 7, 7), r(14, 3, 7, 7), r(14, 14, 7, 7), r(3, 14, 7, 7)],
  "book-open": [p("M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"), p("M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z")],
  "more-horizontal": [c(12, 12, 1), c(19, 12, 1), c(5, 12, 1)],
  "filter": [pg("22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3")],
  "clock": [c(12, 12, 10), pl("12 6 12 12 16 14")],
  "calendar": [r(3, 4, 18, 18, 2), l(16, 2, 16, 6), l(8, 2, 8, 6), l(3, 10, 21, 10)],
  "external-link": [p("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"), pl("15 3 21 3 21 9"), l(10, 14, 21, 3)],
  "download": [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), pl("7 10 12 15 17 10"), l(12, 15, 12, 3)],
  "upload": [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), pl("17 8 12 3 7 8"), l(12, 3, 12, 15)],
  "file-text": [p("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"), pl("14 2 14 8 20 8"), l(16, 13, 8, 13), l(16, 17, 8, 17), pl("10 9 9 9 8 9")],
  "inbox": [pl("22 12 16 12 14 15 10 15 8 12 2 12"), p("M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")],
  "truck": [r(1, 3, 15, 13), pg("16 8 20 8 23 11 23 16 16 16 16 8"), c(5.5, 18.5, 2.5), c(18.5, 18.5, 2.5)],
  "tag": [p("M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"), l(7, 7, 7.01, 7)],
  "link": [p("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"), p("M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71")],
  "refresh": [pl("23 4 23 10 17 10"), pl("1 20 1 14 7 14"), p("M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15")],
  "camera": [p("M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"), c(12, 13, 4)],
  "menu": [l(3, 12, 21, 12), l(3, 6, 21, 6), l(3, 18, 21, 18)],
  "layers": [pg("12 2 2 7 12 12 22 7 12 2"), pl("2 17 12 22 22 17"), pl("2 12 12 17 22 12")],
  "activity": [pl("22 12 18 12 15 21 9 3 6 12 2 12")],
  "hash": [l(4, 9, 20, 9), l(4, 15, 20, 15), l(10, 3, 8, 21), l(16, 3, 14, 21)],
  "eye": [p("M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"), c(12, 12, 3)],
  "copy": [r(9, 9, 13, 13, 2, 2), p("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1")],
  "printer": [pl("6 9 6 2 18 2 18 9"), p("M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"), r(6, 14, 12, 8)],
  "settings": [c(12, 12, 3), p("M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z")],
  "sun": [c(12, 12, 4), l(12, 2, 12, 4), l(12, 20, 12, 22), l(4.93, 4.93, 6.34, 6.34), l(17.66, 17.66, 19.07, 19.07), l(2, 12, 4, 12), l(20, 12, 22, 12), l(4.93, 19.07, 6.34, 17.66), l(17.66, 6.34, 19.07, 4.93)],
  "moon": [p("M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z")],
  "tool": [p("M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z")],
  "users": [p("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"), c(9, 7, 4), p("M23 21v-2a4 4 0 0 0-3-3.87"), p("M16 3.13a4 4 0 0 1 0 7.75")],
  "user-plus": [p("M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"), c(8.5, 7, 4), l(20, 8, 20, 14), l(23, 11, 17, 11)],
  "clipboard-check": [p("M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"), r(8, 2, 8, 4, 1, 1), pl("9 14 11 16 15 12")],
};

export const ICON_NAMES = Object.keys(ICONS) as IconName[];

function renderShape(s: Shape, i: number): ReactElement {
  switch (s.t) {
    case "circle": return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
    case "line": return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />;
    case "polyline": return <polyline key={i} points={s.points} />;
    case "polygon": return <polygon key={i} points={s.points} />;
    case "path": return <path key={i} d={s.d} />;
    case "rect": return <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} ry={s.ry} />;
  }
}

export function Icon({ name, size = 16, strokeWidth = 2, className, style }: IconProps): ReactElement {
  const parts = ICONS[name] ?? [];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={style}
    >
      {parts.map(renderShape)}
    </svg>
  );
}
