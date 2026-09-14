// Pure functions, no React/DOM dependency -- classifyAlert and
// determineFrtcon can be unit-tested directly with fake alert data,
// e.g. feed in a fake "Extreme Cold Warning" alert and assert it comes
// back as Level 2.

export function classifyAlert(alert) {
  const p = alert?.properties ?? {};

  // `event` is NOT free text -- NWS draws it from a fixed, published list
  // of canonical alert-type strings (see api.weather.gov/alerts/types),
  // e.g. "Winter Storm Warning", "Extreme Cold Warning". `headline` and
  // `description` are the genuinely free-text narrative fields. Matching
  // against `event` alone (rather than all three concatenated, as this
  // function used to) avoids a real false-positive path: a Watch's
  // description can legitimately contain the word "Warning" in a sentence
  // like "a Winter Storm Warning may be issued if conditions worsen",
  // which the old combined-string approach would have matched.
  //
  // Substring matching (rather than exact equality) is intentional and
  // kept from before: individual NWS offices sometimes use regional
  // variants of a base product name -- e.g. "Hard Freeze Warning" instead
  // of "Freeze Warning" -- and a substring check against `event` alone
  // still catches those, since the base phrase is still in there, without
  // requiring an exhaustive hardcoded list of every regional variant.
  const event = (p.event || "").toLowerCase();

  // The one exception: whether a Winter Storm Warning specifically
  // involves "significant ice" isn't a distinct NWS event type or any
  // other fixed field -- event stays "Winter Storm Warning" either way.
  // That nuance only exists in the free-text description, so (and only
  // for this one case) this still has to look there.
  const description = (p.description || "").toLowerCase();

  const checks = [
    {
      level: 1,
      label: "FRTCON 1",
      title: "Severe — stay inside, this is not a drill",
      reason: "Severe winter weather conditions are active.",
      match:
        event.includes("blizzard warning") ||
        event.includes("ice storm warning") ||
        event.includes("heavy freezing spray warning") ||
        (event.includes("winter storm warning") && description.includes("significant ice")),
    },
    {
      level: 2,
      label: "FRTCON 2",
      title: "Major weather warning active",
      reason: "A major winter weather warning is active.",
      match:
        event.includes("winter storm warning") ||
        event.includes("lake effect snow warning") ||
        event.includes("snow squall warning") ||
        event.includes("freezing rain warning") ||
        // Not a storm, but a genuine "stay inside" threshold (roughly -25°F
        // wind chill/air temp in most areas) — treated at Warning severity.
        event.includes("extreme cold warning"),
    },
    {
      level: 3,
      label: "FRTCON 3",
      title: "Moderate impacts active",
      reason: "Moderate winter weather impacts are active.",
      match:
        event.includes("winter weather advisory") ||
        event.includes("freezing fog advisory") ||
        event.includes("freezing rain advisory") ||
        event.includes("snow advisory") ||
        event.includes("blowing snow advisory") ||
        // Advisory-tier cold hazard: significant but short of the "stay
        // inside" threshold, similar in spirit to a weather advisory.
        // (Frost Advisory and Freeze Warning used to live here too, but
        // those are mostly agricultural alerts -- common in spring/fall
        // far from real winter conditions, and not really a "should I
        // stay home" event -- so they've been moved down to level 4.)
        event.includes("cold weather advisory"),
    },
    {
      level: 4,
      label: "FRTCON 4",
      title: "Being watched, no major impacts yet",
      reason: "Winter weather is being watched, but major impacts are not active yet.",
      match:
        event.includes("winter storm watch") ||
        event.includes("blizzard watch") ||
        event.includes("lake effect snow watch") ||
        event.includes("ice storm watch") ||
        event.includes("extreme cold watch") ||
        event.includes("heavy freezing spray watch") ||
        event.includes("freeze watch") ||
        // Frost Advisory and Freeze Warning: mostly agricultural cold
        // hazards, common outside real winter conditions (e.g. a fall
        // Frost Advisory), so treated at this same low-stakes level
        // alongside the watches rather than at level 3's "moderate
        // impacts active" tier.
        event.includes("frost advisory") ||
        event.includes("freeze warning"),
    },
  ];

  return checks.find((check) => check.match) || null;
}

export function determineFrtcon(alerts) {
  if (!alerts.length) {
    return {
      level: 5,
      label: "FRTCON 5",
      title: "No major winter storm alerts",
      reason:
        "No active winter storm, blizzard, ice storm, or winter weather alerts were found for this zone.",
      matchingAlerts: [],
    };
  }

  const winterMatches = alerts
    .map((alert) => ({ alert, classification: classifyAlert(alert) }))
    .filter((item) => item.classification !== null)
    .sort((a, b) => a.classification.level - b.classification.level);

  if (!winterMatches.length) {
    return {
      level: 5,
      label: "FRTCON 5",
      title: "Active alerts, but not winter storm alerts",
      reason:
        "There are active alerts in this zone, but none matched the winter storm conditions used for the FRTCON scale.",
      matchingAlerts: [],
    };
  }

  const top = winterMatches[0];

  return {
    level: top.classification.level,
    label: top.classification.label,
    title: top.classification.title,
    reason: top.classification.reason,
    matchingAlerts: winterMatches,
  };
}

export function pickRandomItems(items, count) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}
