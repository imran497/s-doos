/** SellerDoos mark: a rank line climbing to the top spot. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
      <path d="M8 21.5 13.5 15.5l4 3.5 6.5-8" fill="none" stroke="#fff" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
