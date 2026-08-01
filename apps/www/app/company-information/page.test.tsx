import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CompanyInformationPage, { metadata } from "./page";
import ManaflowPage from "../manaflow/page";

describe("company information", () => {
  it("publishes the legal entity, contact, address, and both domains", () => {
    const html = renderToStaticMarkup(<CompanyInformationPage />);

    expect(html).toContain("Manaflow, Inc.");
    expect(html).toContain("18428 Vantage Pointe Dr");
    expect(html).toContain("Rowland Heights");
    expect(html).toContain("91748-5142");
    expect(html).toContain("founders@manaflow.com");
    expect(html).toContain("manaflow.com");
    expect(html).toContain("cmux.com");
    expect(html).toContain("application/ld+json");
  });

  it("uses the public manaflow.com URL as its canonical URL", () => {
    expect(metadata.alternates?.canonical).toBe(
      "https://manaflow.com/company-information",
    );
  });

  it("keeps the direct page out of search indexes", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("does not link the direct page from the public Manaflow page", () => {
    const html = renderToStaticMarkup(<ManaflowPage />);

    expect(html).not.toContain('href="/company-information"');
  });
});
