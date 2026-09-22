import React from 'react';

/* ═══════════════════════════════════════════════════════════
   Official emblems — AAYUSH SAARTHI

   These wrap the real government artwork shipped in /public. They exist so
   the crop/blend rules below live in exactly one place instead of being
   re-derived at every call site.

   `ayush-emblem.jpg` is the Ministry of AYUSH artwork: a Lion Capital over
   the words "Ministry of Ayush / Government of India", on an opaque white
   square. Two consequences it is the component's job to absorb:

     1. This portal belongs to the *state* Department of AYUSH, and the
        approved design sets that wording as live text beside the emblem. So
        the baked-in central-government wordmark is cropped away and only the
        Lion Capital is shown — the artwork is used as supplied, never redrawn.
     2. A white JPEG square would sit as a visible block on the warm canvas,
        so it is composited with `mix-blend-mode: multiply`, which drops the
        white and keeps the black linework.
   ═══════════════════════════════════════════════════════════ */

interface EmblemProps {
  /** Rendered height in px. Width follows the artwork's own aspect ratio. */
  size?: number;
  className?: string;
}

/** Government of Madhya Pradesh state emblem (full colour, transparent). */
export const MpEmblem: React.FC<EmblemProps> = ({ size = 56, className = '' }) => (
  <img
    src="/mp-emblem.webp"
    alt="Emblem of the Government of Madhya Pradesh"
    width={size}
    height={size}
    className={`object-contain flex-shrink-0 ${className}`}
    style={{ height: size, width: size }}
    loading="eager"
    decoding="async"
  />
);

/**
 * Lion Capital of Ashoka, from the Ministry of AYUSH artwork.
 *
 * The source square is 447x447 with the wordmark occupying the bottom ~31%.
 * For this portal (Madhya Pradesh Department of AYUSH, not Government of
 * India Ministry), only the Lion Capital is shown — the baked-in central
 * wordmark is intentionally cropped and replaced by live Dept. text beside
 * the emblem. Aspect ratio is preserved — the artwork is cropped, never
 * squashed or distorted. Confirmed: keep this crop.
 */
export const AyushEmblem: React.FC<EmblemProps> = ({ size = 56, className = '' }) => {
  const VISIBLE = 0.69;
  return (
    <span
      className={`relative block overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: Math.round(size * VISIBLE) }}
      role="img"
      aria-label="Lion Capital of Ashoka — Department of AYUSH, Madhya Pradesh"
    >
      <img
        src="/ayush-emblem.jpg"
        alt=""
        aria-hidden="true"
        className="absolute left-0 top-0 max-w-none"
        style={{ width: size, height: size, mixBlendMode: 'multiply' }}
        loading="eager"
        decoding="async"
      />
    </span>
  );
};

/** The national tricolour, used as a rule under headings. */
export const TricolourRule: React.FC<{ width?: number; className?: string }> = ({
  width = 120,
  className = '',
}) => (
  <span
    className={`inline-flex h-[3px] overflow-hidden rounded-full ${className}`}
    style={{ width }}
    aria-hidden="true"
  >
    <span className="h-full flex-1 bg-[#FF9933]" />
    <span className="h-full flex-1 bg-[#E8E8E8]" />
    <span className="h-full flex-1 bg-[#138808]" />
  </span>
);
