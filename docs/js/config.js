// ---------------------------------------------------------------------------
// Market Challenge: site-wide configuration
// Everything you are likely to want to change lives in this file.
// ---------------------------------------------------------------------------

export const APP = {
  title: 'Market Challenge',
  subtitle: 'Huddersfield Business School',
  // Shown on the debrief screens (big screen and phones).
  course: {
    name: 'Accounting and Finance BSc(Hons)',
    url: 'https://courses.hud.ac.uk/2027-28/undergraduate/accounting-and-finance-bsc-hons/',
    // Optional second call to action, e.g. an Applicant Day or Open Day booking page.
    // Leave the url empty to hide the button.
    secondary: { label: 'Book an Open Day', url: '' },
    // Selling points for the debrief panel. Check these each recruitment cycle.
    highlights: [
      'Trade for real in our dedicated Trading Room',
      'Accredited by ACCA, CIMA and ICAEW, with exam exemptions',
      'Optional 48-week placement year',
      'AACSB-accredited Huddersfield Business School',
    ],
  },
  currency: 'USD',
  currencySymbol: '$',
};

// Commodities traded in the game. `vol` is the standard deviation of the log
// return per tick (one tick = one second by default). `fallback` is used when
// data/prices.json cannot be loaded. `yahoo` and `stooq` are the symbols the
// GitHub Action uses to fetch the opening prices each morning.
// Colours were checked for colour-vision-deficiency separation on the navy
// surface; every line is also labelled directly, so colour is never the only cue.
export const COMMODITIES = [
  { sym: 'GOLD',   name: 'Gold',        unit: 'oz',    unitLong: 'troy ounce', vol: 0.0012, color: '#F2CB4B', fallback: 4278.82, yahoo: 'GC=F', stooq: 'gc.f',
    blurb: 'The classic "safe haven". Investors often buy gold when they are scared.' },
  { sym: 'SILVER', name: 'Silver',      unit: 'oz',    unitLong: 'troy ounce', vol: 0.0022, color: '#9B8CFF', fallback: 63.95,   yahoo: 'SI=F', stooq: 'si.f',
    blurb: 'Part precious metal, part industrial metal used in electronics and solar panels.' },
  { sym: 'BRENT',  name: 'Brent Crude', unit: 'bbl',   unitLong: 'barrel',     vol: 0.0022, color: '#FF6FA0', fallback: 105.30,  yahoo: 'BZ=F', stooq: 'cb.f',
    blurb: 'The global benchmark for oil. Very sensitive to supply decisions and politics.' },
  { sym: 'NATGAS', name: 'Natural Gas', unit: 'MMBtu', unitLong: 'MMBtu',      vol: 0.0035, color: '#5CC8F5', fallback: 3.15,    yahoo: 'NG=F', stooq: 'ng.f',
    blurb: 'Heats homes and powers industry. Famously volatile, and moved by the weather.' },
  { sym: 'COPPER', name: 'Copper',      unit: 'lb',    unitLong: 'pound',      vol: 0.0018, color: '#F08A3C', fallback: 6.69,    yahoo: 'HG=F', stooq: 'hg.f',
    blurb: '"Dr Copper" is used in wiring and construction, so it tracks the health of the economy.' },
];

// Default session settings. The presenter can change these in the lobby.
export const DEFAULT_SETTINGS = {
  durationMin: 10,          // length of the trading session
  startCash: 10000,         // each trader's starting cash
  feePct: 0.1,              // commission per trade, as a percentage
  tickMs: 1000,             // how often prices update
  newsLeadTicks: 3,         // headline appears this many ticks before prices react
  autopilot: false,         // fire random events automatically
  autopilotEverySec: 75,    // average gap between autopilot events
  circuitBreaker: true,     // halt trading after a fall of circuitBreakerPct within 60 ticks
  circuitBreakerPct: 12,
  haltSec: 15,
  allowCustomNames: false,  // false = players pick from generated names only
  showBotsOnLeaderboard: true,
};

// Market microstructure. Tweak with care.
export const MARKET = {
  impactAlpha: 0.03,     // immediate price impact of the whole room's worth of cash trading at once
  pressureBeta: 0.006,   // follow-through drift per tick from recent order flow (herding)
  pressureDecay: 0.9,
  meanReversion: 0.002,  // gentle pull back towards the "fundamental" price
  minLiquidityPlayers: 8 // treat small rooms as at least this many players for impact
};

// Networking. With no settings PeerJS uses its free public signalling server
// and Google's public STUN server. That only works when phone and laptop can
// reach each other directly. Phones on 4G/5G talking to a laptop on university
// Wi-Fi usually CANNOT, so set up a TURN relay (see README, "Networking").
export const NETWORK = {
  peerIdPrefix: 'uoh-market-challenge-',
  // Easiest option: a free Metered "Open Relay" account (20 GB/month). Paste the
  // credentials URL from your Metered dashboard, e.g.
  // 'https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_API_KEY'
  turnCredentialsUrl: '',
  // Alternatively, list TURN servers directly:
  // { urls: 'turns:turn.example.com:443?transport=tcp', username: '...', credential: '...' }
  extraIceServers: [
    {
      urls: "stun:stun.relay.metered.ca:80",
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "61b1b04692c9e659fa1b9c17",
      credential: "kZc2h/kYOUsWzW8K",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "61b1b04692c9e659fa1b9c17",
      credential: "kZc2h/kYOUsWzW8K",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "61b1b04692c9e659fa1b9c17",
      credential: "kZc2h/kYOUsWzW8K",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "61b1b04692c9e659fa1b9c17",
      credential: "kZc2h/kYOUsWzW8K",
    }
  ],
  peerOptions: {
    // host: 'your-peer-server.example.com', port: 443, path: '/', secure: true,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
  },
};
