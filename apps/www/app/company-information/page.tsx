import type { Metadata } from "next";
import Link from "next/link";

const legalName = "Manaflow, Inc.";
const contactEmail = "founders@manaflow.com";
const streetAddress = "18428 Vantage Pointe Dr";
const locality = "Rowland Heights";
const region = "CA";
const postalCode = "91748-5142";

export const metadata: Metadata = {
  title: "Company information — Manaflow",
  description:
    "Legal entity, address, contact, and domain information for Manaflow and cmux",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "https://manaflow.com/company-information",
  },
  openGraph: {
    title: "Company information — Manaflow",
    description:
      "Legal entity, address, contact, and domain information for Manaflow and cmux",
    type: "website",
    url: "https://manaflow.com/company-information",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Manaflow",
  legalName,
  url: "https://manaflow.com",
  email: contactEmail,
  address: {
    "@type": "PostalAddress",
    streetAddress,
    addressLocality: locality,
    addressRegion: region,
    postalCode,
    addressCountry: "US",
  },
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "general inquiries",
    email: contactEmail,
  },
  sameAs: ["https://manaflow.com", "https://cmux.com"],
};

export default function CompanyInformationPage() {
  const jsonLd = JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c");

  return (
    <div
      className="min-h-dvh bg-white px-4 py-10 text-black dark:bg-neutral-950 dark:text-neutral-100 sm:min-h-screen sm:py-16 print:!bg-white print:!text-black print:px-0 print:py-0"
      style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}
    >
      <main className="mx-auto max-w-xl">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
        <Link
          href="/"
          className="text-sm text-neutral-500 hover:text-black hover:underline dark:text-neutral-400 dark:hover:text-white print:hidden"
        >
          ← Manaflow
        </Link>
        <h1 className="mt-6 text-2xl font-bold sm:text-3xl print:mt-0">
          Company information
        </h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-400 sm:text-base print:!text-black">
          Official legal entity and domain information for Manaflow and cmux.
        </p>

        <dl className="mt-8 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800 print:!border-neutral-200">
          <CompanyDetail term="Legal entity">{legalName}</CompanyDetail>
          <CompanyDetail term="Business address">
            <address className="not-italic">
              {streetAddress}
              <br />
              {locality}, {region} {postalCode}
              <br />
              United States
            </address>
          </CompanyDetail>
          <CompanyDetail term="Contact">
            <a
              href={`mailto:${contactEmail}`}
              className="underline decoration-neutral-300 underline-offset-2 hover:decoration-black dark:decoration-neutral-600 dark:hover:decoration-white print:!decoration-neutral-300"
            >
              {contactEmail}
            </a>
          </CompanyDetail>
          <CompanyDetail term="Company domain">
            <a
              href="https://manaflow.com"
              className="underline decoration-neutral-300 underline-offset-2 hover:decoration-black dark:decoration-neutral-600 dark:hover:decoration-white print:!decoration-neutral-300"
            >
              manaflow.com
            </a>
          </CompanyDetail>
          <CompanyDetail term="Product domain">
            <a
              href="https://cmux.com"
              className="underline decoration-neutral-300 underline-offset-2 hover:decoration-black dark:decoration-neutral-600 dark:hover:decoration-white print:!decoration-neutral-300"
            >
              cmux.com
            </a>
          </CompanyDetail>
        </dl>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Domain ownership and operation
          </h2>
          <p className="mt-3 text-sm leading-6 text-neutral-700 dark:text-neutral-300 sm:text-base print:!text-black">
            {legalName} owns and operates{" "}
            <a
              href="https://manaflow.com"
              className="underline decoration-neutral-300 underline-offset-2 hover:decoration-black dark:decoration-neutral-600 dark:hover:decoration-white print:!decoration-neutral-300"
            >
              manaflow.com
            </a>{" "}
            and{" "}
            <a
              href="https://cmux.com"
              className="underline decoration-neutral-300 underline-offset-2 hover:decoration-black dark:decoration-neutral-600 dark:hover:decoration-white print:!decoration-neutral-300"
            >
              cmux.com
            </a>
            . cmux is developed and operated by {legalName}.
          </p>
        </section>

        <p className="mt-8 text-xs text-neutral-500 dark:text-neutral-500 print:!text-black">
          Last updated: July 30, 2026
        </p>
      </main>
    </div>
  );
}

function CompanyDetail({
  term,
  children,
}: {
  readonly term: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-neutral-200 px-5 py-4 last:border-b-0 dark:border-neutral-800 sm:grid-cols-[10rem_1fr] sm:gap-6 print:!border-neutral-200">
      <dt className="text-sm font-medium text-neutral-600 dark:text-neutral-400 print:!text-black">
        {term}
      </dt>
      <dd className="text-sm leading-6 text-black dark:text-neutral-100 print:!text-black">
        {children}
      </dd>
    </div>
  );
}
