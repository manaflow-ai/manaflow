"use client";

interface DoubleChevronProps {
  height?: number;
  className?: string;
}

export default function DoubleChevron({ height = 550, className = "" }: DoubleChevronProps) {
  return (
    <svg
      className={`absolute w-[calc(100%+600px)] -ml-[300px] -z-10 ${className}`}
      viewBox="-200 0 1700 500"
      preserveAspectRatio="none"
      style={{ height: `${height}px`, overflow: 'visible' }}
    >
      <defs>
        {/* Vertical fade for tops and bottoms - light mode */}
        <linearGradient id="verticalFadeLight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="15%" stopColor="white" stopOpacity="0" />
          <stop offset="85%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
        {/* Vertical fade for tops and bottoms - dark mode */}
        <linearGradient id="verticalFadeDark" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0a0a0a" stopOpacity="1" />
          <stop offset="15%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="85%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="1" />
        </linearGradient>
        {/* Left fade for outer left chevron - light mode */}
        <linearGradient id="leftFadeLight" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="50%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        {/* Left fade for outer left chevron - dark mode */}
        <linearGradient id="leftFadeDark" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0a0a0a" stopOpacity="1" />
          <stop offset="50%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="0" />
        </linearGradient>
        {/* Right fade for outer right chevron - light mode */}
        <linearGradient id="rightFadeLight" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity="0" />
          <stop offset="100%" stopColor="white" stopOpacity="1" />
        </linearGradient>
        {/* Right fade for outer right chevron - dark mode */}
        <linearGradient id="rightFadeDark" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="50%" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="100%" stopColor="#0a0a0a" stopOpacity="1" />
        </linearGradient>
        {/* Combined masks - light mode */}
        <mask id="innerChevronMaskLight">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeLight)" />
        </mask>
        <mask id="outerLeftMaskLight">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeLight)" />
          <rect x="-300" y="0" width="400" height="500" fill="url(#leftFadeLight)" />
        </mask>
        <mask id="outerRightMaskLight">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeLight)" />
          <rect x="1300" y="0" width="400" height="500" fill="url(#rightFadeLight)" />
        </mask>
        {/* Combined masks - dark mode */}
        <mask id="innerChevronMaskDark">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeDark)" />
        </mask>
        <mask id="outerLeftMaskDark">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeDark)" />
          <rect x="-300" y="0" width="400" height="500" fill="url(#leftFadeDark)" />
        </mask>
        <mask id="outerRightMaskDark">
          <rect x="-300" y="0" width="2100" height="500" fill="white" />
          <rect x="-300" y="0" width="2100" height="500" fill="url(#verticalFadeDark)" />
          <rect x="1300" y="0" width="400" height="500" fill="url(#rightFadeDark)" />
        </mask>
      </defs>

      {/* Light mode chevrons */}
      <g className="dark:hidden">
        {/* Left chevron 1 < (inner) */}
        <polygon
          points="150,0 0,250 150,500 100,500 -50,250 100,0"
          fill="#e0e7ff"
          mask="url(#innerChevronMaskLight)"
          className="animate-pulse"
          style={{ animationDuration: '3s' }}
        />
        {/* Left chevron 2 < (outer - lighter) */}
        <polygon
          points="50,0 -100,250 50,500 0,500 -150,250 0,0"
          fill="#eef2ff"
          mask="url(#outerLeftMaskLight)"
          className="animate-pulse"
          style={{ animationDuration: '3s', animationDelay: '0.5s' }}
        />
        {/* Right chevron 1 > (inner) */}
        <polygon
          points="1150,0 1300,250 1150,500 1200,500 1350,250 1200,0"
          fill="#e0e7ff"
          mask="url(#innerChevronMaskLight)"
          className="animate-pulse"
          style={{ animationDuration: '3s' }}
        />
        {/* Right chevron 2 > (outer - lighter) */}
        <polygon
          points="1250,0 1400,250 1250,500 1300,500 1450,250 1300,0"
          fill="#eef2ff"
          mask="url(#outerRightMaskLight)"
          className="animate-pulse"
          style={{ animationDuration: '3s', animationDelay: '0.5s' }}
        />
      </g>

      {/* Dark mode chevrons */}
      <g className="hidden dark:block">
        {/* Left chevron 1 < (inner) */}
        <polygon
          points="150,0 0,250 150,500 100,500 -50,250 100,0"
          fill="#312e81"
          mask="url(#innerChevronMaskDark)"
          className="animate-pulse"
          style={{ animationDuration: '3s' }}
        />
        {/* Left chevron 2 < (outer - lighter) */}
        <polygon
          points="50,0 -100,250 50,500 0,500 -150,250 0,0"
          fill="#1e1b4b"
          mask="url(#outerLeftMaskDark)"
          className="animate-pulse"
          style={{ animationDuration: '3s', animationDelay: '0.5s' }}
        />
        {/* Right chevron 1 > (inner) */}
        <polygon
          points="1150,0 1300,250 1150,500 1200,500 1350,250 1200,0"
          fill="#312e81"
          mask="url(#innerChevronMaskDark)"
          className="animate-pulse"
          style={{ animationDuration: '3s' }}
        />
        {/* Right chevron 2 > (outer - lighter) */}
        <polygon
          points="1250,0 1400,250 1250,500 1300,500 1450,250 1300,0"
          fill="#1e1b4b"
          mask="url(#outerRightMaskDark)"
          className="animate-pulse"
          style={{ animationDuration: '3s', animationDelay: '0.5s' }}
        />
      </g>
    </svg>
  );
}
