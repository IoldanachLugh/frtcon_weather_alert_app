# FRTCON — French Toast Conditions

FRTCON checks live National Weather Service (NWS) alerts for your location and
translates them into a **French Toast Condition** level: a tongue-in-cheek
1–5 scale for "should I make French toast and stay home today?"

The live app is at <https://frtcon.com/>. It is a client-side web app: the
alert lookup runs in the visitor's browser (by browser geolocation or ZIP
code), so there is no server-side API to call. To open it for a specific
US location, add `lat` and `lon` query parameters, e.g.
<https://frtcon.com/?lat=46.7867&lon=-92.1005>.

## The scale

| Level | Meaning | Example NWS alerts |
|---|---|---|
| 1 | Severe — stay inside | Blizzard Warning, Ice Storm Warning, Heavy Freezing Spray Warning |
| 2 | Major weather warning active | Winter Storm Warning, Lake Effect Snow Warning, Snow Squall Warning, Extreme Cold Warning |
| 3 | Moderate impacts active | Winter Weather Advisory, Freezing Fog/Rain Advisory, Cold Weather Advisory |
| 4 | Being watched, no major impacts yet | Winter Storm/Blizzard/Ice Storm Watch, Frost Advisory, Freeze Warning — or no winter alert but 1+ in of snow or any ice forecast in the next 48 hours |
| 5 | All clear | No active winter-weather alerts and no significant snow or ice forecast |

When several winter alerts are active, the most severe one sets the level. The
forecast only ever moves an all-clear 5 to a 4; levels 1–3 come from alerts.

## Data sources

- [api.weather.gov](https://www.weather.gov/documentation/services-web-api) — active alerts, and a 48-hour winter outlook (snow, ice, temperature, chance of precipitation) from its gridpoint forecast
- [api.zippopotam.us](https://www.zippopotam.us/) — ZIP code to coordinates
