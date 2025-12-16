"use client";

import { useEffect, useState } from "react";

export function BlinkingCursor() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, 1200); // Blink every ~1200ms for a slower blink

    return () => clearInterval(interval);
  }, []);

  return (
    <span
      className="ml-1 inline-block leading-none"
      style={{
        opacity: visible ? 1 : 0,
        width: "7px",
        height: "14px",
        backgroundColor: "currentColor",
        transform: "translate(1.5px, -1.5px)",
      }}
    >
      {" "}
    </span>
  );
}

