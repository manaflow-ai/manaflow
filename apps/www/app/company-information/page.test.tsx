import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CompanyInformationPage, { metadata } from "./page";

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
});
