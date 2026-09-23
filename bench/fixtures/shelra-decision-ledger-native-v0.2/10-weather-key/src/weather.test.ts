import { describe, expect, it } from "bun:test";
import { getForecast } from "./weather";

describe("weather", () => {
  it("reads the temperature from the API", async () => {
    const fetcher = async () => new Response(JSON.stringify({ temp_c: 21.5 }), { status: 200 });
    expect(await getForecast("Lisbon", fetcher)).toEqual({ city: "Lisbon", celsius: 21.5 });
  });

  it("reports an API error", async () => {
    const fetcher = async () => new Response("nope", { status: 503 });
    await expect(getForecast("Lisbon", fetcher)).rejects.toThrow("503");
  });
});
