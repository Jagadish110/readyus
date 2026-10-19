/**
 * Hand-drawn dish artwork.
 *
 * The landing page needs appetising imagery that stays crisp at any size and
 * costs nothing to download, so every dish here is vector. Texture (rice
 * grains, sprinkles, seeds) is scattered by a seeded generator at module load,
 * which keeps the markup identical on the server and the client.
 */

import { cn } from '@/lib/utils';

/* ---------------------------------------------------------------- texture */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Fleck = { x: number; y: number; rx: number; ry: number; a: number; o: number; i: number };

/** Scatters across a disc, biased to the middle the way food sits in a bowl. */
function scatter(seed: number, count: number, cx: number, cy: number, radius: number): Fleck[] {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * radius;
    return {
      x: Number((cx + Math.cos(angle) * dist).toFixed(2)),
      y: Number((cy + Math.sin(angle) * dist * 0.95).toFixed(2)),
      rx: Number((2.4 + rand() * 1.9).toFixed(2)),
      ry: Number((0.9 + rand() * 0.5).toFixed(2)),
      a: Math.round(rand() * 180),
      o: Number((0.55 + rand() * 0.45).toFixed(2)),
      i
    };
  });
}

const RICE = scatter(7, 300, 120, 120, 70);
const SAMBAR_SEEDS = scatter(21, 34, 120, 128, 30);
const SWEET_NUTS = scatter(33, 46, 120, 118, 50);
const CRATE_SPECKS = scatter(44, 40, 120, 132, 62);

const RICE_TONES = ['#fffaf0', '#ffeec9', '#ffd896', '#ffc46a'];
const NUT_TONES = ['#c98a4b', '#e8b877', '#8d5a2b', '#f2d9a8'];

/* ------------------------------------------------------------------ parts */

/** Shared ceramic plate: soft cast shadow, disc, inner rim. */
function Plate({ id, tone = '#ffffff' }: { id: string; tone?: string }) {
  return (
    <>
      <defs>
        <radialGradient id={id + '-plate'} cx="38%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor={tone} />
          <stop offset="100%" stopColor="#ebe3d6" />
        </radialGradient>
        <radialGradient id={id + '-shade'} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#2b1d12" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#2b1d12" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="124" cy="206" rx="92" ry="20" fill={'url(#' + id + '-shade)'} />
      <circle cx="120" cy="120" r="104" fill={'url(#' + id + '-plate)'} />
      <circle cx="120" cy="120" r="104" fill="none" stroke="#2b1d12" strokeOpacity="0.07" strokeWidth="1.5" />
      <circle cx="120" cy="120" r="88" fill="none" stroke="#2b1d12" strokeOpacity="0.06" strokeWidth="1" />
    </>
  );
}

type ArtProps = { className?: string };

function Frame({
  className,
  label,
  children
}: ArtProps & { label: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 240"
      role="img"
      aria-label={label}
      className={cn('block h-full w-full', className)}
    >
      {children}
    </svg>
  );
}

/* ----------------------------------------------------------------- dishes */

export function BiryaniArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A plate of saffron dum biryani with mutton and boiled egg">
      <Plate id="bir" tone="#fdf6ea" />
      <defs>
        <radialGradient id="bir-rice" cx="40%" cy="32%" r="72%">
          <stop offset="0%" stopColor="#fff8e8" />
          <stop offset="58%" stopColor="#ffe9bd" />
          <stop offset="100%" stopColor="#f3cd86" />
        </radialGradient>
        <linearGradient id="bir-meat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a9542a" />
          <stop offset="100%" stopColor="#6d3015" />
        </linearGradient>
      </defs>

      <circle cx="120" cy="120" r="78" fill="url(#bir-rice)" />
      <path
        d="M72 96c16-14 42-18 62-8 18 9 34 4 44-8 6 20-6 38-26 44-24 7-48 2-66-10-10-6-16-12-14-18Z"
        fill="#ffb648"
        fillOpacity=".5"
      />
      <path
        d="M86 152c14 10 38 13 58 6 14-5 24-14 28-24 4 20-10 38-32 44-22 6-44-2-54-16-3-5-3-8 0-10Z"
        fill="#ff9a2e"
        fillOpacity=".32"
      />

      {RICE.map((g) => (
        <ellipse
          key={g.i}
          cx={g.x}
          cy={g.y}
          rx={g.rx}
          ry={g.ry}
          fill={RICE_TONES[g.i % RICE_TONES.length]}
          fillOpacity={g.o}
          transform={'rotate(' + g.a + ' ' + g.x + ' ' + g.y + ')'}
        />
      ))}

      <path d="M96 84c14-6 28 0 31 12 3 13-7 24-21 25-15 1-25-8-24-21 1-8 6-13 14-16Z" fill="url(#bir-meat)" />
      <path d="M142 128c13-5 25 2 26 13s-9 20-21 20-21-7-21-17c0-7 6-13 16-16Z" fill="url(#bir-meat)" />
      <path d="M74 134c11-4 21 2 22 11 1 10-8 17-18 16-11-1-17-9-15-18 1-5 5-8 11-9Z" fill="url(#bir-meat)" />
      <path d="M100 92c6-1 11 2 12 6" stroke="#d98b52" strokeOpacity=".7" strokeWidth="3" strokeLinecap="round" fill="none" />

      <ellipse cx="160" cy="84" rx="21" ry="19" fill="#fffdf6" />
      <ellipse cx="160" cy="84" rx="21" ry="19" fill="none" stroke="#e8dcc6" strokeWidth="1.5" />
      <ellipse cx="160" cy="84" rx="10" ry="9" fill="#ffc83d" />
      <ellipse cx="156" cy="81" rx="4" ry="3" fill="#ffe08a" fillOpacity=".8" />

      <path
        d="M62 112c10 4 20 3 28-2M150 160c10-2 18-8 23-16M104 170c8 3 18 3 26 0"
        stroke="#8a4a1d"
        strokeOpacity=".6"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M86 108c-7-8-5-18 4-22 5 9 4 18-4 22Z" fill="#3f8d4e" />
      <path d="M176 126c-9-4-12-14-6-21 8 5 11 15 6 21Z" fill="#357a43" />
      <path d="M112 150c-9-3-13-13-8-20 8 4 12 14 8 20Z" fill="#46985a" />
      <circle cx="132" cy="104" r="3.4" fill="#d93025" />
      <circle cx="90" cy="146" r="3" fill="#d93025" />
    </Frame>
  );
}

export function DosaArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A crisp rolled masala dosa with coconut chutney and sambar">
      <Plate id="dos" tone="#fdf8ef" />
      <defs>
        <linearGradient id="dos-crepe" x1="0.15" y1="1" x2="0.85" y2="0">
          <stop offset="0%" stopColor="#c87a1c" />
          <stop offset="38%" stopColor="#eda637" />
          <stop offset="72%" stopColor="#ffd98a" />
          <stop offset="100%" stopColor="#ffe9b5" />
        </linearGradient>
      </defs>

      <path d="M36 120c0-34 38-60 84-60s84 26 84 60-38 60-84 60-84-26-84-60Z" fill="#2f7f52" fillOpacity=".16" />

      {/* the roll: one thick round-capped stroke reads as a cylinder */}
      <path d="M72 170 184 84" stroke="#b5690f" strokeOpacity=".35" strokeWidth="54" strokeLinecap="round" fill="none" />
      <path d="M72 168 182 82" stroke="url(#dos-crepe)" strokeWidth="50" strokeLinecap="round" fill="none" />

      {/* crisp seam and highlights along the length */}
      <path d="M66 152 176 66" stroke="#fff0cf" strokeOpacity=".65" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M80 182 190 96" stroke="#a65f12" strokeOpacity=".3" strokeWidth="6" strokeLinecap="round" fill="none" />
      <path d="M74 166 184 80" stroke="#b96c15" strokeOpacity=".22" strokeWidth="2.5" fill="none" />

      {/* toasted speckle */}
      <circle cx="108" cy="142" r="2.4" fill="#8f4e0b" fillOpacity=".45" />
      <circle cx="132" cy="120" r="2" fill="#8f4e0b" fillOpacity=".4" />
      <circle cx="152" cy="104" r="2.6" fill="#8f4e0b" fillOpacity=".35" />
      <circle cx="96" cy="158" r="1.8" fill="#8f4e0b" fillOpacity=".4" />

      {/* open end with the potato filling */}
      <ellipse cx="180" cy="84" rx="15" ry="24" fill="#f6c445" transform="rotate(-38 180 84)" />
      <ellipse cx="180" cy="84" rx="15" ry="24" fill="none" stroke="#d99a16" strokeOpacity=".5" strokeWidth="2" transform="rotate(-38 180 84)" />
      <circle cx="176" cy="80" r="3.2" fill="#e0a51f" />
      <circle cx="185" cy="89" r="2.6" fill="#e0a51f" />
      <circle cx="182" cy="76" r="2" fill="#fff0c0" />

      {/* chutney and sambar katoris */}
      <circle cx="74" cy="80" r="23" fill="#ffffff" stroke="#e7dfd0" strokeWidth="1.5" />
      <circle cx="74" cy="80" r="17" fill="#f4f6ee" />
      <circle cx="74" cy="80" r="17" fill="#cfe0c4" fillOpacity=".55" />
      <circle cx="68" cy="75" r="3" fill="#8fb37a" fillOpacity=".7" />
      <path d="M64 86c6-4 14-4 20 0" stroke="#ffffff" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" fill="none" />

      <circle cx="176" cy="170" r="25" fill="#ffffff" stroke="#e7dfd0" strokeWidth="1.5" />
      <circle cx="176" cy="170" r="19" fill="#d4612a" />
      <circle cx="176" cy="170" r="19" fill="#b8431a" fillOpacity=".45" />
      {SAMBAR_SEEDS.slice(0, 12).map((g, i) => (
        <circle
          key={g.i}
          cx={176 + (g.x - 120) * 0.42}
          cy={170 + (g.y - 128) * 0.42}
          r={1.6 + (i % 3) * 0.5}
          fill="#f6c445"
          fillOpacity=".85"
        />
      ))}
      <path d="M166 162c6-4 14-4 20 0" stroke="#ffffff" strokeOpacity=".3" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </Frame>
  );
}

export function KebabArt({ className }: ArtProps) {
  const rows = [
    { y: 86, tilt: -6 },
    { y: 118, tilt: -3 },
    { y: 150, tilt: 2 }
  ];

  return (
    <Frame className={className} label="Charcoal grilled seekh kebabs with onion rings and lemon">
      <Plate id="keb" tone="#fbf4e9" />
      <defs>
        <linearGradient id="keb-meat" x1="0" y1="0" x2="1" y2="0.4">
          <stop offset="0%" stopColor="#9c4722" />
          <stop offset="48%" stopColor="#7a3115" />
          <stop offset="100%" stopColor="#52200e" />
        </linearGradient>
      </defs>

      <ellipse cx="120" cy="126" rx="80" ry="66" fill="#2f7f52" fillOpacity=".12" />

      {rows.map((row) => (
        <g key={row.y} transform={'rotate(' + row.tilt + ' 120 ' + row.y + ')'}>
          <rect x="34" y={row.y - 1.5} width="172" height="3" rx="1.5" fill="#b9a68c" />
          <rect x="56" y={row.y - 13} width="128" height="26" rx="13" fill="url(#keb-meat)" />
          <path
            d={'M76 ' + (row.y - 11) + 'v22M100 ' + (row.y - 12) + 'v24M124 ' + (row.y - 11) + 'v22M148 ' + (row.y - 12) + 'v24'}
            stroke="#2e1206"
            strokeOpacity=".45"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d={'M64 ' + (row.y - 7) + 'h112'}
            stroke="#d78a52"
            strokeOpacity=".35"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      ))}

      <circle cx="74" cy="178" r="15" fill="none" stroke="#efe6f3" strokeWidth="5" />
      <circle cx="74" cy="178" r="8" fill="none" stroke="#dcc9e6" strokeWidth="3" />
      <circle cx="102" cy="186" r="12" fill="none" stroke="#f5edf7" strokeWidth="4.5" />

      <path d="M156 176a24 24 0 0 1 34 10 24 24 0 0 1-34-10Z" fill="#ffd93b" />
      <path d="M160 178c8-2 18 2 24 9" stroke="#fff3a8" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M166 176l6 12M174 175l4 13" stroke="#e8b800" strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" />

      <path d="M44 150c-9-6-9-18 0-23 7 7 7 18 0 23Z" fill="#3f8d4e" />
      <path d="M196 138c-10-3-14-14-8-21 9 4 13 15 8 21Z" fill="#357a43" />
    </Frame>
  );
}

export function IdliArt({ className }: ArtProps) {
  const cakes = [
    { cx: 88, cy: 92 },
    { cx: 148, cy: 92 },
    { cx: 88, cy: 148 },
    { cx: 148, cy: 148 }
  ];

  return (
    <Frame className={className} label="A plate of steamed idli with sambar and chutney">
      <Plate id="idl" tone="#fdfaf4" />
      <defs>
        <radialGradient id="idl-cake" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f8f4ea" />
          <stop offset="100%" stopColor="#e6ddcb" />
        </radialGradient>
      </defs>

      <path d="M40 120c0-32 36-56 80-56s80 24 80 56-36 56-80 56-80-24-80-56Z" fill="#2f7f52" fillOpacity=".13" />

      {cakes.map((cake) => (
        <g key={cake.cx + '-' + cake.cy}>
          <ellipse cx={cake.cx} cy={cake.cy + 5} rx="29" ry="22" fill="#2b1d12" fillOpacity=".08" />
          <ellipse cx={cake.cx} cy={cake.cy} rx="29" ry="24" fill="url(#idl-cake)" />
          <ellipse cx={cake.cx} cy={cake.cy} rx="29" ry="24" fill="none" stroke="#e2d8c4" strokeWidth="1.4" />
          <ellipse cx={cake.cx - 8} cy={cake.cy - 8} rx="9" ry="6" fill="#ffffff" fillOpacity=".85" />
          <circle cx={cake.cx + 9} cy={cake.cy + 6} r="1.8" fill="#ded3bd" />
          <circle cx={cake.cx - 4} cy={cake.cy + 10} r="1.5" fill="#ded3bd" />
          <circle cx={cake.cx + 3} cy={cake.cy - 3} r="1.3" fill="#ded3bd" />
        </g>
      ))}

      <circle cx="120" cy="120" r="27" fill="#ffffff" stroke="#e7dfd0" strokeWidth="2" />
      <circle cx="120" cy="120" r="21" fill="#d4612a" />
      {SAMBAR_SEEDS.slice(0, 16).map((g, i) => (
        <circle
          key={g.i}
          cx={120 + (g.x - 120) * 0.55}
          cy={120 + (g.y - 128) * 0.55}
          r={1.5 + (i % 3) * 0.4}
          fill="#f6c445"
          fillOpacity=".9"
        />
      ))}
      <path d="M108 112c7-5 17-5 24 0" stroke="#ffffff" strokeOpacity=".32" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path d="M104 178c-8-6-8-17 0-22 7 7 7 16 0 22Z" fill="#3f8d4e" />
    </Frame>
  );
}

export function SweetArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A bowl of double ka meetha topped with dry fruits">
      <Plate id="swt" tone="#fdf6ee" />
      <defs>
        <radialGradient id="swt-bowl" cx="40%" cy="30%" r="74%">
          <stop offset="0%" stopColor="#fff4e0" />
          <stop offset="60%" stopColor="#f6d9a8" />
          <stop offset="100%" stopColor="#dfae63" />
        </radialGradient>
      </defs>

      <circle cx="120" cy="120" r="80" fill="#ffffff" />
      <circle cx="120" cy="120" r="80" fill="none" stroke="#ece2d1" strokeWidth="2" />
      <circle cx="120" cy="120" r="68" fill="url(#swt-bowl)" />

      <path d="M78 104c18-12 44-14 64-4 14 7 22 18 22 28-16 10-40 14-62 8-18-5-28-16-28-26 0-2 2-4 4-6Z" fill="#e8b457" />
      <path d="M86 140c16 10 40 12 60 4" stroke="#c98a3c" strokeOpacity=".6" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M92 118c16-8 38-9 54-2" stroke="#fff1d6" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" fill="none" />

      <ellipse cx="104" cy="96" rx="22" ry="10" fill="#fff8ec" fillOpacity=".75" />
      <ellipse cx="140" cy="150" rx="18" ry="8" fill="#fff8ec" fillOpacity=".6" />

      {SWEET_NUTS.map((g) => (
        <ellipse
          key={g.i}
          cx={g.x}
          cy={g.y}
          rx={g.rx * 1.1}
          ry={g.ry * 1.8}
          fill={NUT_TONES[g.i % NUT_TONES.length]}
          fillOpacity={g.o}
          transform={'rotate(' + g.a + ' ' + g.x + ' ' + g.y + ')'}
        />
      ))}

      <circle cx="120" cy="92" r="4" fill="#d93025" fillOpacity=".8" />
      <circle cx="96" cy="140" r="3.4" fill="#8d5a2b" />
      <path d="M150 104c-8-4-10-13-5-19 7 4 10 13 5 19Z" fill="#3f8d4e" />
    </Frame>
  );
}

export function ChaiArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A glass of Irani chai on a saucer with rising steam">
      <defs>
        <linearGradient id="chai-brew" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d7a46a" />
          <stop offset="55%" stopColor="#b4713a" />
          <stop offset="100%" stopColor="#8a4e23" />
        </linearGradient>
        <linearGradient id="chai-glass" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity=".55" />
          <stop offset="28%" stopColor="#ffffff" stopOpacity=".08" />
          <stop offset="78%" stopColor="#ffffff" stopOpacity=".3" />
        </linearGradient>
      </defs>

      <ellipse cx="122" cy="206" rx="78" ry="16" fill="#2b1d12" fillOpacity=".16" />

      <g className="animate-steam" style={{ transformOrigin: '120px 70px' }}>
        <path d="M104 70c-8-10 6-16-2-27" stroke="#b9a68c" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M122 64c-9-12 7-18-2-30" stroke="#b9a68c" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M140 70c-8-10 6-16-2-27" stroke="#b9a68c" strokeOpacity=".4" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>

      <ellipse cx="120" cy="192" rx="74" ry="20" fill="#ffffff" />
      <ellipse cx="120" cy="192" rx="74" ry="20" fill="none" stroke="#e7dfd0" strokeWidth="2" />
      <ellipse cx="120" cy="189" rx="46" ry="12" fill="#f6f1e6" />

      <path d="M86 86h68l-9 90c-1 9-8 15-17 15h-16c-9 0-16-6-17-15L86 86Z" fill="#f4efe6" />
      <path d="M90 104h60l-8 72c-.6 6-5 10-11 10h-22c-6 0-10-4-11-10l-8-72Z" fill="url(#chai-brew)" />
      <ellipse cx="120" cy="104" rx="30" ry="7" fill="#e6b887" />
      <ellipse cx="120" cy="104" rx="30" ry="7" fill="#ffffff" fillOpacity=".25" />
      <path d="M86 86h68l-9 90c-1 9-8 15-17 15h-16c-9 0-16-6-17-15L86 86Z" fill="url(#chai-glass)" />
      <path d="M100 112l7 64" stroke="#ffffff" strokeOpacity=".4" strokeWidth="5" strokeLinecap="round" fill="none" />
      <path d="M86 86h68" stroke="#d9cfbd" strokeWidth="3" strokeLinecap="round" />

      <circle cx="176" cy="188" r="15" fill="#e8c382" />
      <circle cx="176" cy="188" r="15" fill="none" stroke="#cfa45c" strokeWidth="1.5" />
      <circle cx="172" cy="185" r="1.6" fill="#b88540" />
      <circle cx="180" cy="190" r="1.6" fill="#b88540" />
      <circle cx="176" cy="194" r="1.4" fill="#b88540" />
    </Frame>
  );
}

export function VegCrateArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A crate of fresh vegetables and greens">
      <ellipse cx="122" cy="204" rx="86" ry="18" fill="#2b1d12" fillOpacity=".14" />

      <path d="M62 128c-14-16-10-38 8-46 12 18 10 38-8 46Z" fill="#2f7f52" />
      <path d="M86 118c-10-20 2-40 22-42 4 22-6 40-22 42Z" fill="#3f9a63" />
      <path d="M178 126c14-14 12-36-6-44-11 17-9 36 6 44Z" fill="#246540" />

      <path d="M48 134h144l-10 56a14 14 0 0 1-14 12H72a14 14 0 0 1-14-12l-10-56Z" fill="#d9a25f" />
      <path d="M48 134h144l-3 16H51l-3-16Z" fill="#c78b45" />
      <path d="M66 156h108M72 174h96" stroke="#b97c3a" strokeOpacity=".7" strokeWidth="5" strokeLinecap="round" />
      <path d="M94 150v52M146 150v52" stroke="#b97c3a" strokeOpacity=".4" strokeWidth="4" />

      <circle cx="84" cy="128" r="22" fill="#d93025" />
      <circle cx="84" cy="128" r="22" fill="#ff5a3c" fillOpacity=".35" />
      <ellipse cx="77" cy="120" rx="7" ry="5" fill="#ff8a6e" fillOpacity=".7" />
      <path d="M84 108c-4-6 2-10 6-7 3 3 1 7-6 7Z" fill="#3f8d4e" />

      <circle cx="126" cy="122" r="26" fill="#f6a81f" />
      <circle cx="126" cy="122" r="26" fill="#ffc94d" fillOpacity=".4" />
      <path d="M126 98c-5-8 3-12 8-8 4 4 0 8-8 8Z" fill="#3f8d4e" />
      <path d="M114 112c6-5 16-6 24-2" stroke="#ffe3a0" strokeOpacity=".7" strokeWidth="4" strokeLinecap="round" fill="none" />

      <circle cx="166" cy="130" r="19" fill="#7a3fa0" />
      <circle cx="166" cy="130" r="19" fill="#a269c4" fillOpacity=".4" />
      <path d="M166 113c-4-6 2-9 6-6 3 3 1 6-6 6Z" fill="#3f8d4e" />

      {CRATE_SPECKS.slice(0, 18).map((g) => (
        <circle key={g.i} cx={g.x} cy={g.y + 36} r={1.4} fill="#ffffff" fillOpacity={g.o * 0.4} />
      ))}
    </Frame>
  );
}

export function KiranaArt({ className }: ArtProps) {
  return (
    <Frame className={className} label="A sack of rice with a jar of pulses and a bottle of cooking oil">
      <ellipse cx="122" cy="204" rx="84" ry="18" fill="#2b1d12" fillOpacity=".14" />

      <path
        d="M58 112c0-10 8-16 18-18 22-5 44-5 66 0 10 2 18 8 18 18l-8 70a16 16 0 0 1-16 14H82a16 16 0 0 1-16-14l-8-70Z"
        fill="#e9dcc3"
      />
      <path d="M58 112c0-10 8-16 18-18 22-5 44-5 66 0 10 2 18 8 18 18-26 8-76 8-102 0Z" fill="#d8c7a6" />
      <path d="M74 92c6-10 16-14 26-14s20 4 26 14c-16 6-36 6-52 0Z" fill="#c7b391" />
      <rect x="76" y="132" width="88" height="44" rx="8" fill="#fdfaf2" />
      <path d="M90 146h60M90 158h44" stroke="#c6b795" strokeWidth="5" strokeLinecap="round" />
      <path d="M152 156c6-6 6-14 0-20-7 6-7 14 0 20Z" fill="#2f7f52" />

      <rect x="36" y="130" width="40" height="62" rx="12" fill="#ffffff" fillOpacity=".92" />
      <rect x="36" y="130" width="40" height="62" rx="12" fill="none" stroke="#e4dac6" strokeWidth="2" />
      <rect x="40" y="152" width="32" height="36" rx="9" fill="#f6c445" />
      <rect x="34" y="124" width="44" height="12" rx="6" fill="#d9a25f" />
      {CRATE_SPECKS.slice(0, 14).map((g, i) => (
        <circle key={g.i} cx={44 + (i % 5) * 7} cy={160 + Math.floor(i / 5) * 9} r="2.6" fill="#e0a51f" />
      ))}

      <path
        d="M176 120h22v10c10 6 14 14 14 24v34a12 12 0 0 1-12 12h-26a12 12 0 0 1-12-12v-34c0-10 4-18 14-24v-10Z"
        fill="#fff6d9"
      />
      <path d="M170 160h40v38a12 12 0 0 1-12 12h-16a12 12 0 0 1-12-12v-38Z" fill="#f6b11f" />
      <rect x="174" y="112" width="26" height="12" rx="5" fill="#246540" />
      <rect x="176" y="166" width="28" height="18" rx="5" fill="#fffaf0" fillOpacity=".85" />
      <path d="M181 174h18" stroke="#c98a3c" strokeWidth="3" strokeLinecap="round" />
    </Frame>
  );
}

/* --------------------------------------------------------------- registry */

export const DISH_ART = {
  biryani: BiryaniArt,
  dosa: DosaArt,
  kebab: KebabArt,
  idli: IdliArt,
  sweet: SweetArt,
  chai: ChaiArt,
  veg: VegCrateArt,
  kirana: KiranaArt
} as const;

export type DishKey = keyof typeof DISH_ART;

/** Renders one dish by key — used by the cards, the rails and the hero. */
export function Dish({ name, className }: { name: DishKey; className?: string }) {
  const Art = DISH_ART[name];
  return <Art className={className} />;
}
