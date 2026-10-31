import { DEFAULT_POLICY, Policy } from "@rebuttal/core";

export type PresetId = "cautious" | "balanced" | "autopilot";

/** Starting points for the settings page and onboarding; each is a valid core Policy. */
export const PRESETS: Record<PresetId, { label: string; summary: string; policy: Policy }> = {
  cautious: {
    label: "Cautious",
    summary: "Nothing is filed without your approval, except the safe default right before a deadline.",
    policy: Policy.parse({ ...DEFAULT_POLICY, autonomy: { ...DEFAULT_POLICY.autonomy, enabled: false } }),
  },
  balanced: {
    label: "Balanced",
    summary:
      "Auto-file small, strong cases (under $50, p(win) at least 80%, complete evidence). Ask for the rest.",
    policy: DEFAULT_POLICY,
  },
  autopilot: {
    label: "Autopilot",
    summary:
      "Auto-file fights, offers and accepts up to $250 when p(win) is at least 65%. Ask for larger cases.",
    policy: Policy.parse({
      ...DEFAULT_POLICY,
      autonomy: {
        ...DEFAULT_POLICY.autonomy,
        enabled: true,
        maxAmountCents: 25_000,
        minPWinToFight: 0.65,
        minCompletenessToFight: 0.7,
        options: ["FIGHT", "OFFER", "ACCEPT"],
      },
    }),
  },
};

/** Which preset a stored policy matches on the fields presets set, if any. */
export function matchPreset(p: Policy): PresetId | null {
  for (const [id, preset] of Object.entries(PRESETS) as [PresetId, (typeof PRESETS)[PresetId]][]) {
    const a = preset.policy.autonomy;
    const b = p.autonomy;
    if (
      a.enabled === b.enabled &&
      (!a.enabled ||
        (a.maxAmountCents === b.maxAmountCents &&
          a.minPWinToFight === b.minPWinToFight &&
          a.minCompletenessToFight === b.minCompletenessToFight &&
          [...a.options].sort().join() === [...b.options].sort().join()))
    )
      return id;
  }
  return null;
}
