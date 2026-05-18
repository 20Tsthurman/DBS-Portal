import type { ReactNode, SVGProps } from "react";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  size?: number;
}

function Svg({
  size = 20,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconIncome(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </Svg>
  );
}

export function IconExpenses(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 7 9 13 13 9 21 17" />
      <polyline points="14 17 21 17 21 10" />
    </Svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12V7H5a2 2 0 0 1 0 -4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
    </Svg>
  );
}

export function IconPiggyBank(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 5l1 -2" />
      <path d="M2 11l2 -1l-.5 -1.3a.5 .5 0 0 1 .5 -.7h2.2c.4 -.6 1 -1 1.8 -1h7c3 0 6 2 6 5v3c0 1 -.5 2 -1.5 2.7v1.8a.5 .5 0 0 1 -.5 .5h-2a.5 .5 0 0 1 -.5 -.5v-1h-4v1a.5 .5 0 0 1 -.5 .5h-2a.5 .5 0 0 1 -.5 -.5v-1.5c-1 -.5 -2 -1.5 -2 -3v-2l-2 -1z" />
      <path d="M16 11h.01" />
      <path d="M11 8h3" />
    </Svg>
  );
}

export function IconTrendingUp(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3 -2 3 -9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </Svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </Svg>
  );
}

export function IconTax(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="2" width="16" height="20" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="16" y1="14" x2="16" y2="18" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </Svg>
  );
}
