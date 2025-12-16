import * as React from "react";

type Props = Omit<
  React.SVGProps<SVGSVGElement>,
  "width" | "height" | "title"
> & {
  height?: number | string;
  label?: string;
  from?: string;
  to?: string;
  showWordmark?: boolean;
  wordmarkText?: string;
  wordmarkFill?: string;
};

export default function CmuxLogo({
  height = "1em",
  label,
  from = "#00D4FF",
  to = "#7C3AED",
  showWordmark = true,
  wordmarkText = "cmux",
  wordmarkFill = "#fff",
  style,
  ...rest
}: Props) {
  const id = React.useId();
  const gradId = `cmuxGradient-${id}`;
  const glowId = `cmuxGlow-${id}`;
  const titleId = label ? `cmuxTitle-${id}` : undefined;

  const css = `
    .wordmark  { font-weight: 700; letter-spacing: 1.5px;
                 font-family: "JetBrains Mono","SFMono-Regular","Menlo","Consolas","ui-monospace","Monaco","Courier New",monospace; }
  `;

  const markTranslateX = 87.2;
  const markTranslateY = 62.7;
  const markScale = 0.2;

  return (
    <svg
      viewBox="60 0 680 240"
      role="img"
      aria-labelledby={label ? titleId : undefined}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="xMinYMid meet"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        height,
        width: "auto",
        ...style,
      }}
      {...rest}
    >
      {label ? <title id={titleId}>{label}</title> : null}

      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={from} />
          <stop offset="100%" stopColor={to} />
        </linearGradient>
        <filter
          id={glowId}
          x="0"
          y="0"
          width="517"
          height="667"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="32" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.3 0"
          />
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="effect1_dropShadow"
          />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha2"
          />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="8" />
          <feComposite in2="hardAlpha2" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.4 0"
          />
          <feBlend
            mode="normal"
            in2="effect1_dropShadow"
            result="effect2_dropShadow"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect2_dropShadow"
            result="shape"
          />
        </filter>
        <style>{css}</style>
      </defs>

      {/* Logomark (left-flush) */}
      <g transform={`translate(${markTranslateX}, ${markTranslateY}) scale(${markScale})`}>
        <g filter={`url(#${glowId})`}>
          <path
            d="M64 64L453 333.5L64 603V483.222L273.462 333.5L64 183.778V64Z"
            fill={`url(#${gradId})`}
          />
        </g>
      </g>

      {/* Wordmark */}
      {showWordmark ? (
        <text
          className="wordmark"
          fill={wordmarkFill}
          x={208}
          y={162}
          fontSize={108}
        >
          {wordmarkText}
        </text>
      ) : null}
    </svg>
  );
}
