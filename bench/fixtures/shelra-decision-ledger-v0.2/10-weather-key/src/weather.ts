export interface Forecast {
  city: string;
  celsius: number;
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const BASE_URL = "https://api.weather.example/v1";

/** Today's forecast for a city. */
export async function getForecast(city: string, fetcher: Fetcher = fetch): Promise<Forecast> {
  const response = await fetcher(`${BASE_URL}/forecast?city=${encodeURIComponent(city)}`);
  if (!response.ok) throw new Error(`The weather API answered ${response.status}`);
  const data = (await response.json()) as { temp_c: number };
  return { city, celsius: data.temp_c };
}
