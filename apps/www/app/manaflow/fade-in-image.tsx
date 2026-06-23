"use client";

import clsx from "clsx";
import {
  useCallback,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

type FadeInImageProps = ImgHTMLAttributes<HTMLImageElement>;

export function FadeInImage({
  className,
  onLoad,
  ...props
}: FadeInImageProps) {
  const [loaded, setLoaded] = useState(false);

  const imageRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    onLoad?.(event);
  };

  return (
    <img
      {...props}
      ref={imageRef}
      onLoad={handleLoad}
      className={clsx(
        className,
        "transition-opacity duration-500 ease-out motion-reduce:transition-none",
        loaded ? "opacity-100" : "opacity-[0.01]"
      )}
    />
  );
}
