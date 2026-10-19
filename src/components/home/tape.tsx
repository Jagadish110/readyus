const CLAIMS = [
  'No delivery fee',
  'No platform fee',
  'No price mark-up',
  'Shops within your radius',
  'Cash on delivery',
  'Verified kitchens'
];

/**
 * Running tape between the hero and the promise band. The track holds the
 * claims twice and slides exactly half its width, so the loop never seams.
 */
export function Tape() {
  return (
    <div className="relative overflow-hidden border-y border-leaf-800/30 bg-leaf-800 py-3.5 text-white">
      <div className="animate-marquee flex w-max gap-10 pr-10">
        {[0, 1].map((copy) => (
          <div key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center gap-10">
            {CLAIMS.map((claim) => (
              <span key={claim} className="flex items-center gap-10 text-eyebrow uppercase">
                {claim}
                <span className="size-1.5 rounded-full bg-saffron-400" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
