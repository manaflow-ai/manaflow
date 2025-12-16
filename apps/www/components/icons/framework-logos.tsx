import type { SVGProps } from "react";

export function AngularLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="48"
      height="48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      {...props}
    >
      <path
        d="M24 1L3 8.636l3.203 28.313L24 47l17.797-10.051L45 8.636 24 1z"
        fill="#DA0B36"
      />
      <path
        d="M24 1v5.106-.023V47l17.797-10.051L45 8.636 24 1z"
        fill="#C10933"
      />
      <path
        d="M24.022 6L11 36h4.855l2.618-6.713h11.054L32.145 36H37L24.022 6zm3.804 19.15H20.22l3.803-9.403 3.804 9.402z"
        fill="#fff"
      />
    </svg>
  );
}

export function NextLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="48"
      height="48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      {...props}
    >
      <mask
        id="next-mask"
        style={{ maskType: "alpha" }}
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="48"
        height="48"
      >
        <circle cx="24" cy="24" r="24" fill="#000" />
      </mask>
      <g mask="url(#next-mask)">
        <circle
          cx="24"
          cy="24"
          r="23.2"
          fill="#000"
          stroke="#fff"
          strokeWidth="1.6"
        />
        <path
          d="M39.8687 42.0055L18.4378 14.4H14.3999V33.592H17.6302V18.5023L37.333 43.9587C38.222 43.3637 39.069 42.7108 39.8687 42.0055Z"
          fill="url(#next-gradient0)"
        />
        <rect
          x="30.6667"
          y="14.4"
          width="3.2"
          height="19.2"
          fill="url(#next-gradient1)"
        />
      </g>
      <defs>
        <linearGradient
          id="next-gradient0"
          x1="29.0666"
          y1="31.0667"
          x2="38.5332"
          y2="42.8"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient
          id="next-gradient1"
          x1="32.2667"
          y1="14.4"
          x2="32.2132"
          y2="28.5001"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function NuxtLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="61"
      height="40"
      viewBox="0 0 61 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M33.997 39.539h22.528c.715 0 1.418-.183 2.038-.53a4.014 4.014 0 0 0 1.492-1.447 3.861 3.861 0 0 0 .545-1.977 3.86 3.86 0 0 0-.547-1.977L44.923 8.19a4.016 4.016 0 0 0-1.49-1.447 4.172 4.172 0 0 0-2.038-.53c-.716 0-1.418.183-2.038.53a4.016 4.016 0 0 0-1.492 1.447l-3.868 6.504-7.563-12.718A4.018 4.018 0 0 0 24.942.53 4.175 4.175 0 0 0 22.904 0c-.716 0-1.419.183-2.039.53a4.018 4.018 0 0 0-1.492 1.446L.547 33.608A3.861 3.861 0 0 0 0 35.585c0 .694.188 1.376.545 1.977.358.601.873 1.1 1.492 1.447.62.347 1.323.53 2.038.53h14.141c5.603 0 9.735-2.387 12.578-7.044l6.902-11.596 3.698-6.205 11.096 18.64H37.695l-3.699 6.205Zm-16.011-6.212-9.869-.002L22.91 8.474l7.381 12.425-4.942 8.305c-1.888 3.022-4.033 4.123-7.363 4.123Z"
        fill="#00DC82"
      />
    </svg>
  );
}

export function ReactLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="48"
      height="48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      {...props}
    >
      <g clipPath="url(#react-clip0)">
        <path
          d="M24 28.631a4.278 4.278 0 1 0 0-8.556 4.278 4.278 0 0 0 0 8.556z"
          fill="#61DAFB"
        />
        <path
          d="M24 33.118c12.678 0 22.956-3.924 22.956-8.765 0-4.84-10.278-8.765-22.956-8.765-12.679 0-22.957 3.924-22.957 8.765 0 4.841 10.278 8.765 22.957 8.765z"
          stroke="#61DAFB"
        />
        <path
          d="M16.409 28.736c6.34 10.98 14.877 17.918 19.07 15.498 4.191-2.42 2.451-13.284-3.888-24.264C25.25 8.99 16.714 2.053 12.52 4.473 8.33 6.892 10.07 17.756 16.41 28.736z"
          stroke="#61DAFB"
        />
        <path
          d="M16.409 19.97c-6.34 10.98-8.08 21.843-3.887 24.264 4.192 2.42 12.73-4.518 19.069-15.498 6.34-10.98 8.08-21.843 3.887-24.264-4.192-2.42-12.73 4.519-19.069 15.498z"
          stroke="#61DAFB"
        />
      </g>
      <defs>
        <clipPath id="react-clip0">
          <path fill="#fff" transform="translate(0 3)" d="M0 0H48V42.706H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function RemixLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M700 0H100C44.772 0 0 44.772 0 100v600c0 55.228 44.772 100 100 100h600c55.228 0 100-44.772 100-100V100C800 44.772 755.228 0 700 0Z"
        fill="#212121"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M587.947 527.768c4.254 54.65 4.254 80.268 4.254 108.232H465.756c0-6.091.109-11.663.219-17.313.342-17.564.699-35.88-2.147-72.868-3.761-54.152-27.08-66.185-69.957-66.185H195v-98.525h204.889c54.16 0 81.241-16.476 81.241-60.098 0-38.357-27.081-61.601-81.241-61.601H195V163h227.456C545.069 163 606 220.912 606 313.42c0 69.193-42.877 114.319-100.799 121.84 48.895 9.777 77.48 37.605 82.746 92.508Z"
        fill="#fff"
      />
      <path
        d="M195 636v-73.447h133.697c22.332 0 27.181 16.563 27.181 26.441V636H195Z"
        fill="#fff"
      />
      <path
        d="M194.5 636v.5h161.878v-47.506c0-5.006-1.226-11.734-5.315-17.224-4.108-5.515-11.059-9.717-22.366-9.717H194.5V636Z"
        stroke="#fff"
        strokeOpacity=".8"
      />
    </svg>
  );
}

export function SvelteLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="47"
      height="48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 47 48"
      {...props}
    >
      <g clipPath="url(#svelte-clip0)">
        <path
          d="M39.792 6.09C35.507-.027 27.044-1.84 20.924 2.048L10.177 8.88a12.297 12.297 0 0 0-5.57 8.237 12.922 12.922 0 0 0 1.28 8.315 12.313 12.313 0 0 0-1.844 4.596c-.619 3.47.19 7.043 2.244 9.91 4.287 6.119 12.75 7.931 18.869 4.042l10.747-6.831a12.295 12.295 0 0 0 5.57-8.237 12.927 12.927 0 0 0-1.28-8.315A12.31 12.31 0 0 0 42.037 16c.619-3.47-.19-7.043-2.245-9.91"
          fill="#FF3E00"
        />
        <path
          d="M19.873 40.52a8.55 8.55 0 0 1-9.165-3.388 7.866 7.866 0 0 1-1.35-5.962c.062-.339.148-.674.257-1.001l.202-.616.55.404a13.881 13.881 0 0 0 4.206 2.095l.4.121-.037.398a2.4 2.4 0 0 0 .433 1.594 2.575 2.575 0 0 0 2.76 1.022 2.37 2.37 0 0 0 .66-.29l10.75-6.833a2.233 2.233 0 0 0 1.011-1.492 2.377 2.377 0 0 0-.407-1.797 2.577 2.577 0 0 0-2.76-1.022 2.37 2.37 0 0 0-.66.289L22.62 26.65c-.675.428-1.411.75-2.183.956a8.55 8.55 0 0 1-9.166-3.388 7.866 7.866 0 0 1-1.35-5.962 7.394 7.394 0 0 1 3.35-4.954l10.75-6.834a7.844 7.844 0 0 1 2.185-.957 8.55 8.55 0 0 1 9.165 3.388 7.866 7.866 0 0 1 1.35 5.962c-.062.34-.148.674-.256 1.001l-.203.616-.55-.403a13.87 13.87 0 0 0-4.206-2.096l-.4-.121.037-.398a2.404 2.404 0 0 0-.433-1.594 2.575 2.575 0 0 0-2.76-1.022 2.37 2.37 0 0 0-.66.29l-10.75 6.833a2.229 2.229 0 0 0-1.01 1.492c-.112.63.034 1.277.406 1.797a2.577 2.577 0 0 0 2.76 1.023c.234-.063.457-.16.661-.29l4.102-2.607a7.834 7.834 0 0 1 2.183-.957 8.55 8.55 0 0 1 9.165 3.388 7.865 7.865 0 0 1 1.35 5.962 7.398 7.398 0 0 1-3.35 4.955l-10.75 6.833a7.842 7.842 0 0 1-2.185.958"
          fill="#fff"
        />
      </g>
      <defs>
        <clipPath id="svelte-clip0">
          <path fill="#fff" transform="translate(3.84)" d="M0 0H38.4V46.08H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function ViteLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="410"
      height="404"
      viewBox="0 0 410 404"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M399.641 59.5246L215.643 388.545C211.844 395.338 202.084 395.378 198.228 388.618L10.5817 59.5563C6.38087 52.1896 12.6802 43.2665 21.0281 44.7586L205.223 77.6824C206.398 77.8924 207.601 77.8904 208.776 77.6763L389.119 44.8058C397.439 43.2894 403.768 52.1434 399.641 59.5246Z"
        fill="url(#vite-paint0-linear)"
      />
      <path
        d="M292.965 1.5744L156.801 28.2552C154.563 28.6937 152.906 30.5903 152.771 32.8664L144.395 174.33C144.198 177.662 147.258 180.248 150.51 179.498L188.42 170.749C191.967 169.931 195.172 173.055 194.443 176.622L183.18 231.775C182.422 235.487 185.907 238.661 189.532 237.56L212.947 230.446C216.577 229.344 220.065 232.527 219.297 236.242L201.398 322.875C200.278 328.294 207.486 331.249 210.492 326.603L212.5 323.5L323.454 102.072C325.312 98.3645 322.108 94.137 318.036 94.9228L279.014 102.454C275.347 103.161 272.227 99.746 273.262 96.1583L298.731 7.86689C299.767 4.27314 296.636 0.855181 292.965 1.5744Z"
        fill="url(#vite-paint1-linear)"
      />
      <defs>
        <linearGradient
          id="vite-paint0-linear"
          x1="6.00017"
          y1="32.9999"
          x2="235"
          y2="344"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#41D1FF" />
          <stop offset="1" stopColor="#BD34FE" />
        </linearGradient>
        <linearGradient
          id="vite-paint1-linear"
          x1="194.651"
          y1="8.81818"
          x2="236.076"
          y2="292.989"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#FFEA83" />
          <stop offset="0.0833333" stopColor="#FFDD35" />
          <stop offset="1" stopColor="#FFA800" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function VueLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="48"
      height="48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      {...props}
    >
      <g clipPath="url(#vue-clip0)">
        <path
          d="M29.54 3L24 12.7 18.456 3H-.001l24 42L47.998 3H29.54z"
          fill="#41B883"
        />
        <path
          d="M29.54 3L24 12.7 18.456 3H9.599l14.4 25.2L38.398 3H29.54z"
          fill="#34495E"
        />
      </g>
      <defs>
        <clipPath id="vue-clip0">
          <path fill="#fff" transform="translate(0 3)" d="M0 0H48V42H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}
