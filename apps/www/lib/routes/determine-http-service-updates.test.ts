import { describe, expect, it } from "vitest";

import {
  determineHttpServiceUpdates,
  type ManagedHttpService,
} from "./determine-http-service-updates";

const createService = (
  service: Partial<ManagedHttpService> = {}
): ManagedHttpService => ({
  name: "port-3000",
  port: 3000,
  url: "https://example.com",
  ...service,
});

describe("determineHttpServiceUpdates", () => {
  it("computes ports to expose and services to hide", () => {
    const existing: ManagedHttpService[] = [
      createService({ name: "port-3000", port: 3000 }),
      createService({ name: "port-4000", port: 4000 }),
    ];

    const { portsToExpose, servicesToHide } = determineHttpServiceUpdates(
      existing,
      [3000, 5000]
    );

    expect(portsToExpose).toEqual([5000]);
    expect(servicesToHide.map((service) => service.port)).toEqual([4000]);
  });

  it("ignores services that are not managed by cmux", () => {
    const existing: ManagedHttpService[] = [
      createService({ name: "admin", port: 6000 }),
      createService({ name: "port-39377", port: 39377 }),
    ];

    const { portsToExpose, servicesToHide } = determineHttpServiceUpdates(
      existing,
      []
    );

    expect(portsToExpose).toEqual([]);
    expect(servicesToHide).toEqual([]);
  });
});
