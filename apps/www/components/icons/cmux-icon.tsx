import { useId, type SVGProps } from "react";

export function CmuxIcon(props: SVGProps<SVGSVGElement>) {
  const id = useId();
  const gradientId = `cmuxIconGradient-${id}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00D4FF" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <path
        d="M4 3L19 12L4 21V16.5L12.5 12L4 7.5V3Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
