import "altcha";
import type { AltchaWidgetElement } from "altcha/types/generic";
import type {} from "altcha/types/react";
import type { CSSProperties, Ref } from "react";
import { useCallback, useEffect, useImperativeHandle, useRef } from "react";

/**
 * The server won't accept a challenge sooner than CAPTCHA_MIN_SECONDS (3 s) after issuing it
 * (django-foundation's foundation/settings.py). The widget holds the payload back a little
 * longer than that, which covers the challenge's round trip, so people never see "too quick".
 */
const CAPTCHA_MIN_MS = 3500;

const CONFIGURATION = JSON.stringify({
  // Start solving as soon as the form shows: it's done by the time the password is typed.
  auto: "onload",
  hideFooter: true,
  minDuration: CAPTCHA_MIN_MS,
});

// The widget's colours, from the app's theme tokens, so it follows light and dark mode.
const THEME = {
  "--altcha-color-base": "var(--card)",
  "--altcha-color-base-content": "var(--card-foreground)",
  "--altcha-color-neutral": "var(--muted-foreground)",
  "--altcha-color-primary": "var(--primary)",
  "--altcha-color-primary-content": "var(--primary-foreground)",
  "--altcha-color-error": "var(--destructive)",
  "--altcha-border-color": "var(--border)",
  "--altcha-checkbox-border-color": "var(--input)",
  "--altcha-border-radius": "var(--radius-lg)",
  "--altcha-max-width": "100%",
} as CSSProperties;

export type AltchaHandle = {
  /** Fetch and solve a new challenge. Each one is single-use, so call this after every submit. */
  renew: () => void;
};

/**
 * ALTCHA proof-of-work captcha (django-foundation's foundation/security/captcha.py). Reports the solved payload,
 * which the form sends as `altcha`, or null while there's none to send.
 */
export function Altcha({
  onChange,
  ref,
}: {
  onChange: (payload: string | null) => void;
  ref?: Ref<AltchaHandle>;
}) {
  const widget = useRef<AltchaWidgetElement>(null);

  const renew = useCallback(() => {
    const el = widget.current;
    onChange(null);
    if (!el) return;
    el.reset();
    void el.verify();
  }, [onChange]);

  useImperativeHandle(ref, () => ({ renew }), [renew]);

  useEffect(() => {
    const el = widget.current;
    if (!el) return;
    const onState = (e: Event) => {
      const { state, payload } = (e as CustomEvent<{ state: string; payload?: string }>).detail;
      onChange(state === "verified" && payload ? payload : null);
    };
    el.addEventListener("statechange", onState);
    // An unused challenge expires after 20 minutes; get a fresh one rather than make people click.
    el.addEventListener("expired", renew);
    return () => {
      el.removeEventListener("statechange", onState);
      el.removeEventListener("expired", renew);
    };
  }, [onChange, renew]);

  return (
    <altcha-widget
      ref={widget}
      challenge="/api/auth/captcha/"
      configuration={CONFIGURATION}
      style={THEME}
      className="block w-full"
    />
  );
}
