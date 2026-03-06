import Image from "next/image";

export default function CityBackground() {
  return (
    <>
      <Image
        src="/city-bg-light.png"
        alt=""
        fill
        className="object-cover dark:hidden"
        priority
        aria-hidden
      />
      <Image
        src="/city-bg-dark.png"
        alt=""
        fill
        className="object-cover hidden dark:block"
        priority
        aria-hidden
      />
    </>
  );
}
