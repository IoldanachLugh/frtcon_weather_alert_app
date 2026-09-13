import React, { useMemo } from "react";
import { alertMessages } from "../data/alertMessages";
import { pickRandomItems } from "../lib/frtcon";

export function FrtconMessage({ level, zoneName }) {
  const message = alertMessages[level] || alertMessages[5];
  const selectedLines = useMemo(() => pickRandomItems(message.body, 4), [level, zoneName]);

  return (
    <div className="frtcon-condition-status">
      <div className="frtcon-condition-headline">
        {message.headline} - {zoneName} is currently at French Toast Condition #{level}.
      </div>
      <div className="frtcon-condition-title">{message.title}</div>
      {selectedLines.map((line, index) => (
        <p key={index} className="frtcon-condition-line">
          {line}
        </p>
      ))}
      <p className="frtcon-footnote">
        * Unlike the French Toast Alert System, #FRTCON only defines whether people in your region
        are likely to need to remain home due to a weather event. It does not measure the overall
        scale of the storm beyond whether going out where you live is a bad idea.
      </p>
    </div>
  );
}
