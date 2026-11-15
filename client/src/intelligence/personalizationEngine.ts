/* Personalization Engine (§6, §12) — turns advanced feedback into a
   plain-language account of what changed. The durable update happens
   server-side (recordDetailedFeedback writes the signal; the outfit
   engine's taste bias reads it on the next generation). This module
   names the effect so the UI never claims learning it didn't do. */

import type { FeedbackReason } from "../models/intelligence";

export function describePreferenceEffect(rating: "love" | "good" | "unsure" | "not", reason: FeedbackReason | ""): string {
  if (reason === "Perfect") return "This look's colours and style get weighted higher in your next recommendations.";
  if (reason === "Too formal") return "Formality weight drops for everyday occasions — future picks lean more relaxed.";
  if (reason === "Too casual") return "Formality weight rises — future picks for this occasion lean smarter.";
  if (reason === "Don't like the color") return "That colour's preference weight drops; it will appear less as a lead colour.";
  if (reason === "Don't like the combination") return "That pairing is noted — the engine avoids repeating this exact combination.";
  if (reason === "Already wear this too often") return "Rotation weight rises — WearWise will surface fresher pieces first.";
  if (reason === "Not comfortable") return "Comfort signal stored — relaxed fits get a small preference boost.";
  if (reason === "Not suitable for me") return "This style's weight drops in your preference profile.";
  if (rating === "love") return "Loved looks pull their style and colours up in future recommendations.";
  if (rating === "not") return "“Not my style” pushes this style down in future recommendations.";
  return "Signal stored — it shapes your preference weights with the rest of your feedback.";
}
