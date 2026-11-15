/* UserProfile + UserPreferences — the shared user model (brief §1, §13).
   One profile object feeds the dashboard greeting, Style DNA, the AI
   stylist and shopping: preferences live here, never per-feature. */

import type { StyleDNA } from "./styleDNA";

export interface UserPreferences {
  preferredStyles: string[];
  dislikedStyles: string[];
  preferredColors: string[];
  dislikedColors: string[];
  preferredFits: string[];
  preferredBrands: string[];
  /** Monthly-ish shopping budget band in ₹, e.g. "₹2,000–₹5,000". */
  budgetRange: string;
  preferredOccasions: string[];
  /** The weather the user dresses for most, e.g. "Warm". */
  temperaturePreference: string;
}

export const EMPTY_PREFERENCES: UserPreferences = {
  preferredStyles: [],
  dislikedStyles: [],
  preferredColors: [],
  dislikedColors: [],
  preferredFits: [],
  preferredBrands: [],
  budgetRange: "",
  preferredOccasions: [],
  temperaturePreference: "Warm",
};

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  /** Owned image key (hero | overshirt | blacktee) or null → initial tile. */
  avatar: string | null;
  age: number | null;
  preferredStyles: string[];
  preferredColors: string[];
  preferredFits: string[];
  favoriteOccasions: string[];
  styleDNA: StyleDNA | null;
  preferences: UserPreferences;
  styleNotes: string;
}
