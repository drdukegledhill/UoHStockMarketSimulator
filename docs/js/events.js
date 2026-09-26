// ---------------------------------------------------------------------------
// Market events the presenter can trigger (and autopilot can fire).
// Each event schedules headlines and price effects through the `m` helper
// object supplied by the engine. Percentages are approximate: the engine adds
// a little randomness so no two sessions look identical.
//
// `lesson` and `module` appear on the debrief screens, linking what happened
// in the game to what applicants would study. Check module names each year.
// ---------------------------------------------------------------------------

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const EVENTS = [
  {
    key: 'crash', label: 'Market crash', group: 'Market-wide', autopilot: true,
    desc: 'Broad sell-off, gold rises as a safe haven, volatility spikes.',
    lesson: 'Systemic risk: in a crash most assets fall together, so spreading your money helps less than you would hope. Gold often rises as investors run for safety.',
    module: 'Investment, Portfolio and Risk Management (Year 3 option)',
    fire(m) {
      m.news(pick([
        'Global sell-off as recession fears grip markets',
        'Markets in freefall after shock banking collapse',
        'Panic selling as global growth forecasts slashed',
      ]), { kind: 'breaking' });
      m.move({ BRENT: -18, COPPER: -15, SILVER: -10, NATGAS: -12 }, 25, { permanent: true });
      m.move({ GOLD: +4 }, 30, { permanent: true });
      m.vol(2.5, 60);
    },
  },
  {
    key: 'flash', label: 'Flash crash', group: 'Market-wide', autopilot: true, sym: 'any',
    desc: 'A sudden plunge in one commodity that recovers within a minute.',
    lesson: 'Liquidity and algorithms: automated trading can cause sudden drops that reverse within minutes. Anyone who panic-sold locked in a loss.',
    module: 'Financial Technology and Control Environment (Year 2)',
    fire(m, o) {
      const s = o.sym || m.randomSym();
      m.news(`Flash crash: algorithmic selling floods the ${m.name(s)} market`, { kind: 'breaking', delay: 0 });
      m.move({ [s]: -10 }, 3, { delay: 1 });
      m.move({ [s]: +9.5 }, 40, { delay: 8 });
      m.vol(2, 30, { syms: [s], delay: 1 });
      m.news(`${m.name(s)} recovers as exchange pauses rogue trading algorithms`, { kind: 'news', delay: 12 });
    },
  },
  {
    key: 'boom', label: 'Bull run', group: 'Market-wide', autopilot: true,
    desc: 'Strong growth data lifts everything gradually.',
    lesson: 'The economic cycle: when the economy grows, demand for energy and metals rises and prices follow.',
    module: 'Economics of Business (Year 1)',
    fire(m) {
      m.news(pick([
        'Growth figures smash forecasts: factories running flat out',
        'China announces huge infrastructure spending programme',
      ]), { kind: 'news' });
      m.move({ BRENT: +9, COPPER: +10, SILVER: +7, NATGAS: +6, GOLD: +2 }, 60, { permanent: true });
    },
  },
  {
    key: 'rates', label: 'Interest rate rise', group: 'Market-wide', autopilot: true,
    desc: 'Central bank raises rates: metals and oil dip.',
    lesson: 'Interest rates: when rates rise, assets that pay no interest (like gold) look less attractive, and a stronger dollar makes commodities dearer for everyone else.',
    module: 'Banking with Financial Markets (Year 2 option)',
    fire(m) {
      m.news('Central bank surprises markets with 0.5% interest rate rise', { kind: 'breaking' });
      m.move({ GOLD: -4, SILVER: -6, COPPER: -4, BRENT: -3, NATGAS: -2 }, 20, { permanent: true });
    },
  },
  {
    key: 'opec', label: 'OPEC+ supply cut', group: 'Commodity', autopilot: true,
    desc: 'Brent jumps, gas follows.',
    lesson: 'Supply and demand: when producers cut supply, prices rise even though demand has not changed.',
    module: 'Economics of Business (Year 1)',
    fire(m) {
      m.news('OPEC+ announces surprise cut to oil production', { kind: 'breaking' });
      m.move({ BRENT: +14, NATGAS: +5 }, 15, { permanent: true });
      m.vol(1.8, 40, { syms: ['BRENT'] });
    },
  },
  {
    key: 'mine', label: 'Copper mine strike', group: 'Commodity', autopilot: true,
    desc: 'Copper spikes on supply fears.',
    lesson: 'Concentration risk: a single strike at one huge mine can move the world price of a metal.',
    module: 'Foundations of Finance (Year 1)',
    fire(m) {
      m.news('Strike halts output at the world\'s largest copper mine', { kind: 'breaking' });
      m.move({ COPPER: +11, SILVER: +2 }, 20, { permanent: true });
    },
  },
  {
    key: 'winter', label: 'Mild winter forecast', group: 'Commodity', autopilot: true,
    desc: 'Natural gas slides on weak demand.',
    lesson: 'Demand shocks and climate: weather forecasts move energy prices, and climate change is making them harder to predict.',
    module: 'Climate Economics and Finance (Year 3 option)',
    fire(m) {
      m.news('Forecasters predict mildest winter on record across Europe', { kind: 'news' });
      m.move({ NATGAS: -16 }, 30, { permanent: true });
    },
  },
  {
    key: 'safehaven', label: 'Central banks buy gold', group: 'Commodity', autopilot: true,
    desc: 'Gold and silver rally.',
    lesson: 'Safe-haven demand: when big institutions worry about currencies, they buy gold, and silver tends to follow.',
    module: 'Global Financial Management (Year 3 option)',
    fire(m) {
      m.news('Central banks announce record gold purchases', { kind: 'news' });
      m.move({ GOLD: +6, SILVER: +9 }, 30, { permanent: true });
    },
  },
  {
    key: 'bubble', label: 'Bubble (inflate then burst)', group: 'Drama', autopilot: true, sym: 'any',
    desc: 'Hype builds for about 90 seconds, then it pops. Use "Burst bubble now" to pop it early.',
    lesson: 'Bubbles and herd behaviour: the price raced ahead of any real value because everyone was buying. From Tulip Mania to the dot-com crash, bubbles always burst.',
    module: 'Economic History (Year 2 option)',
    fire(m, o) {
      const s = o.sym || m.randomSym(['GOLD']);
      const len = 80 + Math.floor(Math.random() * 30);
      m.news(`Social media frenzy: "${m.name(s)} can only go up!"`, { kind: 'rumour' });
      m.move({ [s]: +18 }, Math.floor(len / 2), { tag: 'bubble' });
      m.news(`${m.name(s)} hits all-time high as retail traders pile in`, { kind: 'news', delay: Math.floor(len / 2), tag: 'bubble' });
      m.move({ [s]: +18 }, Math.ceil(len / 2), { delay: Math.floor(len / 2), tag: 'bubble' });
      m.scheduleBurst(s, len);
    },
  },
  {
    key: 'rumour', label: 'False rumour', group: 'Drama', autopilot: true, sym: 'any',
    desc: 'A fake story knocks a price down, then it is corrected.',
    lesson: 'Information and misinformation: markets react to news in seconds, true or not. Checking sources before you trade is a real skill.',
    module: 'Issues in Accounting and Finance (Year 3)',
    fire(m, o) {
      const s = o.sym || m.randomSym();
      m.news(`RUMOUR: unconfirmed reports of a giant new ${m.name(s)} discovery`, { kind: 'rumour' });
      m.move({ [s]: -8 }, 10);
      m.news(`CORRECTION: ${m.name(s)} discovery reports were false`, { kind: 'news', delay: 35 });
      m.move({ [s]: +8.5 }, 15, { delay: 35 + m.lead });
    },
  },
  {
    key: 'volstorm', label: 'Volatility storm', group: 'Drama', autopilot: true,
    desc: 'Prices swing wildly for a minute, no direction.',
    lesson: 'Volatility is risk: bigger swings mean bigger possible gains and bigger possible losses. Measuring it is core quantitative finance.',
    module: 'Quantitative Analysis (Year 1)',
    fire(m) {
      m.news('Traders brace for data release: markets on edge', { kind: 'news' });
      m.vol(3, 60);
    },
  },
  {
    key: 'halt', label: 'Halt trading (circuit breaker)', group: 'Controls', autopilot: false,
    desc: 'Freezes prices and trading for the halt period.',
    lesson: 'Circuit breakers: exchanges pause trading after big falls so that people can think rather than panic.',
    module: 'Financial Technology and Control Environment (Year 2)',
    fire(m) {
      m.halt('Trading halted by the exchange');
    },
  },
];

export const EVENT_MAP = Object.fromEntries(EVENTS.map((e) => [e.key, e]));
