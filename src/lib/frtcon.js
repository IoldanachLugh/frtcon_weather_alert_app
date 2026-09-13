// Pure functions, no React/DOM dependency -- classifyAlert and
// determineFrtcon can be unit-tested directly with fake alert data,
// e.g. feed in a fake "Extreme Cold Warning" alert and assert it comes
// back as Level 2.

export function classifyAlert(alert) {
  const p = alert?.properties ?? {};
  const event = (p.event || "").toLowerCase();
  const headline = (p.headline || "").toLowerCase();
  const description = (p.description || "").toLowerCase();
  const combined = `${event} ${headline} ${description}`;

  const checks = [
    {
      level: 1,
      label: "FRTCON 1",
      reason: "Severe winter weather conditions are active.",
      match:
        combined.includes("blizzard warning") ||
        combined.includes("ice storm warning") ||
        combined.includes("heavy freezing spray warning") ||
        (combined.includes("winter storm warning") && combined.includes("significant ice")),
    },
    {
      level: 2,
      label: "FRTCON 2",
      reason: "A major winter weather warning is active.",
      match:
        combined.includes("winter storm warning") ||
        combined.includes("lake effect snow warning") ||
        combined.includes("snow squall warning") ||
        combined.includes("freezing rain warning") ||
        // Not a storm, but a genuine "stay inside" threshold (roughly -25°F
        // wind chill/air temp in most areas) — treated at Warning severity.
        combined.includes("extreme cold warning"),
    },
    {
      level: 3,
      label: "FRTCON 3",
      reason: "Moderate winter weather impacts are active.",
      match:
        combined.includes("winter weather advisory") ||
        combined.includes("freezing fog advisory") ||
        combined.includes("freezing rain advisory") ||
        combined.includes("snow advisory") ||
        combined.includes("blowing snow advisory") ||
        // Advisory-tier cold hazards: significant but short of the
        // "stay inside" threshold, similar in spirit to a weather advisory.
        combined.includes("cold weather advisory") ||
        combined.includes("frost advisory") ||
        combined.includes("freeze warning"),
    },
    {
      level: 4,
      label: "FRTCON 4",
      reason: "Winter weather is being watched, but major impacts are not active yet.",
      match:
        combined.includes("winter storm watch") ||
        combined.includes("blizzard watch") ||
        combined.includes("lake effect snow watch") ||
        combined.includes("ice storm watch") ||
        combined.includes("extreme cold watch") ||
        combined.includes("heavy freezing spray watch") ||
        combined.includes("freeze watch"),
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
    title: top.classification.reason,
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
