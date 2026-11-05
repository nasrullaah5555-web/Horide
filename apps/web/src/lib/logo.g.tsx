// GENERATED from design/tokens.json by scripts/gen-tokens.mjs. Do not edit by hand.

/** The Musride logo: Route M symbol (pickup ring to drop-off dot) and the wordmark. */
export function MusrideLogo({
  onDark = false,
  wordmark = true,
  className = '',
}: {
  onDark?: boolean;
  wordmark?: boolean;
  className?: string;
}) {
  const ink = onDark ? 'var(--color-white)' : 'var(--color-navy)';
  const hole = onDark ? 'var(--color-navy)' : 'var(--color-white)';
  return (
    <span className={`inline-flex items-center gap-[0.35em] ${className}`}>
      <svg viewBox="0 0 100 100" className="h-[1.6em] w-[1.6em] shrink-0" role="img" aria-label="Musride">
        <path d="M22 72V17L50 53L78 17V72" fill="none" stroke={ink} strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="21" cy="81" r="11" fill="var(--color-sign)" />
        <circle cx="21" cy="81" r="4.4" fill={hole} />
        <circle cx="79" cy="81" r="11" fill={ink} />
      </svg>
      {wordmark && (
        <span aria-hidden style={{ fontFamily: "var(--font-brand)", fontWeight: 700, letterSpacing: "var(--tracking-wordmark)", color: ink }}>
          MUSRIDE
        </span>
      )}
    </span>
  );
}
