# Market Challenge

A live commodities trading game for University of Huddersfield applicant events, built to promote the **Accounting and Finance BSc(Hons)** course at Huddersfield Business School.

The presenter's laptop runs the market on the big screen. Applicants scan a QR code, get pretend cash and trade five real commodities from their phones. Prices start from the real closing prices and then evolve in a simulation. The presenter can trigger crashes, bubbles, supply shocks and breaking news. At the closing bell, a debrief screen explains what happened and links each event to a module on the course.

The whole thing is static HTML, CSS and JavaScript, so it runs on **GitHub Pages** with no server of its own. The website lives in the `docs/` folder, which GitHub Pages publishes. Everything else in the repository (the price script, the workflow and this README) stays out of the published site.

![Lobby](screenshots/lobby.jpg)
![Live market](screenshots/live.jpg)
![Debrief](screenshots/debrief.jpg)
![Phone screens](screenshots/phone.jpg)

---

## Contents

- [How it works](#how-it-works)
- [Setting up GitHub Pages](#setting-up-github-pages)
- [Running a session](#running-a-session)
- [The presenter controls](#the-presenter-controls)
- [Opening prices and the GitHub Action](#opening-prices-and-the-github-action)
- [Customising](#customising)
- [Networking: what can go wrong](#networking-what-can-go-wrong)
- [Privacy](#privacy)
- [Project structure](#project-structure)
- [Testing locally](#testing-locally)
- [Credits and licences](#credits-and-licences)

---

## How it works

```
                    GitHub Pages (static files only)
                 host.html   play.html   control.html
                     |           |            |
   presenter laptop  v           v            v   presenter's phone (optional)
  +------------------------+   phones    +----------------+
  |  host.html             |<-- WebRTC --|  play.html     |
  |  - market engine       |   (PeerJS)  |  buy / sell    |
  |  - big screen          |             +----------------+
  |  - control drawer      |<-- WebRTC --  control.html
  +------------------------+
             ^
             | fetches docs/data/prices.json on load
             |
  GitHub Action (weekday mornings) writes docs/data/prices.json from Yahoo Finance / Stooq
```

- **The host page is the server.** `host.html` runs the whole market in the browser: prices, orders, portfolios, events and the leaderboard. Phones only send orders and display what the host tells them.
- **Phones connect peer-to-peer** using [PeerJS](https://peerjs.com/) (WebRTC data channels). PeerJS's free public signalling server introduces each phone to the host. After that, data flows directly between them.
- **Opening prices** come from `docs/data/prices.json`, which a scheduled GitHub Action refreshes each weekday morning. When the host page loads, it takes those prices as the "opening bell" values. From then on the market runs on its own.
- **The price model** for each tick (one second) combines:
  - random noise, scaled to each commodity's volatility;
  - drift from any active events (crash, bubble and so on);
  - order-flow pressure, so that when the room piles into one commodity its price rises, and herding creates momentum. With the default settings, one person's trade barely registers, a third of the room going all in moves a price by about 5%, and the whole room by about 17%;
  - a gentle pull back towards the "fundamental" price, which events can move permanently.

## Setting up GitHub Pages

1. **Put the workflow file in place.** GitHub only runs workflows from `.github/workflows/`, and that folder could not be written from here, so the file is waiting in `setup/`. From the project folder, run:

   ```bash
   mkdir -p .github/workflows && mv setup/update-prices.yml .github/workflows/ && rmdir setup
   ```

   Then create a GitHub repository (for example `UoHStockMarketSimulator`) and push this folder to it.
2. In the repository, go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, **Branch** to `main` and the folder to `/docs`, then save.
3. Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**. The price updater commits `docs/data/prices.json`, so it needs this.
4. Go to the **Actions** tab, open **Update opening prices** and click **Run workflow** once. This replaces the seed prices with fresh ones. After that it runs automatically at about 06:15 UK time on weekdays.
5. The site will be at `https://<your-username>.github.io/<repo-name>/`. For example: `https://drdukegledhill.github.io/UoHStockMarketSimulator/`.

A custom domain works too (for example `market.drduke.uk`). Add it under **Settings → Pages → Custom domain**.

> The `docs/.nojekyll` file tells GitHub Pages to serve the files as they are. Leave it in place.

## Running a session

### Before the event

- **Rehearse.** Open `index.html` and choose **Rehearsal mode** (`host.html?net=local`). Everything runs in one browser with no network. Click **Open a test phone** to open phone windows, and add bots from the control panel.
- **Test on the actual Wi-Fi.** On the day, in the room, scan the QR code with your own phone and with one on mobile data. If a phone can't connect, see [Networking](#networking-what-can-go-wrong).
- **Plug in the laptop**, and turn off sleep and screen savers. The page also asks the browser to keep the screen awake.
- **Choose your screen setup:**
  - *Extended display (best):* put `host.html` full screen (press **F**) on the projector. Open the control panel in its own window on the laptop screen: press **C**, then **Open control panel in a new window**.
  - *Mirrored display:* use your phone as a remote (see below), or press **C** to slide the drawer out briefly. The audience will see it.

### During the event

1. Open `host.html` on the projector. Check the lobby shows the QR code, the room code and the opening prices.
2. Applicants scan the QR code (or visit the site and type the four-letter code) and tap **Join**. Their names appear on the trading floor. Names are generated, for example "Bullish Badger", so nothing rude reaches the screen.
3. With a small group, add a few **bots** so the market feels busy. Bots are shown on the live leaderboard but never win the final podium.
4. Press **Space** (or **Ring opening bell**) to start. The default session is 10 minutes.
5. Trigger events as you talk. The headline appears on the ticker and on every phone a few seconds before prices react, so the room gets a chance to respond. Alternatively, turn on **Autopilot** and let random events fire.
6. At the closing bell (or **End session now**), the big screen switches to the debrief:
   - the final chart with events marked;
   - the top traders;
   - how many people beat a do-nothing buy-and-hold benchmark;
   - each event explained, with the module that teaches it;
   - a QR code for the course page.

   Every phone gets its own result and links to the course.

### Keyboard shortcuts (big screen)

The yellow **Controls** button in the top-right corner opens the control panel. While the market is running it fades after four seconds without mouse movement, so it doesn't distract the audience. Move the mouse and it comes straight back.


| Key | Action |
| --- | --- |
| **C** | Show or hide the control panel (or click the yellow **Controls** button, top right) |
| **F** | Full screen |
| **Space** | Opening bell, then pause and resume |
| **M** | Sounds on or off |
| **Esc** | Close the control panel |

### If something goes wrong

- **The host page was refreshed or closed.** Reopen it in the same browser and choose **Resume**. Portfolios are restored, phones reconnect by themselves, and the market restarts paused. Press Space to continue. Pending headlines (for example the second half of a bubble) are lost.
- **A phone lost its connection** (screen locked, left the page). It reconnects automatically when the page is visible again and keeps its portfolio, because the phone remembers its identity for that room.
- **Someone picked a silly custom name.** Use **Rename** or **Remove** in the Traders list. Custom names are off by default.
- **Start again with the same people.** Use **Reset session** (click twice). Everyone goes back to the starting cash and stays connected.

## The presenter controls

| Event | What happens | Linked module (debrief) |
| --- | --- | --- |
| Market crash | Oil, copper, gas and silver fall sharply. Gold rises as a safe haven. Volatility spikes. The circuit breaker often trips. | Investment, Portfolio and Risk Management |
| Flash crash | One commodity plunges about 10% in seconds, then recovers | Financial Technology and Control Environment |
| Bull run | Everything drifts up on strong growth data | Economics of Business |
| Interest rate rise | Metals and oil dip | Banking with Financial Markets |
| OPEC+ supply cut | Brent jumps, gas follows | Economics of Business |
| Copper mine strike | Copper spikes | Foundations of Finance |
| Mild winter forecast | Natural gas slides | Climate Economics and Finance |
| Central banks buy gold | Gold and silver rally | Global Financial Management |
| Bubble | Hype builds for about 90 seconds, then it bursts (or use **Burst bubble now**) | Economic History |
| False rumour | A fake story knocks a price down, then a correction restores it | Issues in Accounting and Finance |
| Volatility storm | Wild swings, no direction | Quantitative Analysis |
| Halt trading | Freezes the market for the halt period | Financial Technology and Control Environment |
| Custom breaking news | Type any headline, with an optional % move on one or all commodities | Foundations of Finance |

Set **Target commodity** before clicking an event to aim a flash crash, bubble or rumour at a specific commodity.

**Crowd behaviour is visible.** Each price tile on the big screen has a buyers-vs-sellers bar showing the balance of trading over the last few seconds (it reads "Quiet" when little is happening). If half or more of the traders pile into, or out of, the same commodity within 20 seconds, the ticker runs a headline such as "Frenzied buying of Silver on the trading floor" or "Panic selling of Copper". It also appears in the debrief with a lesson on herd behaviour. Bots are ignored for this when at least three real people are playing.

The **automatic circuit breaker** halts trading if any commodity falls 12% or more within a minute. The threshold is configurable.

**Phone remote:** in the control panel, click **Show phone remote QR code** and scan it with your own phone. Anyone with that code has full control, so don't show it on the projector for long.

## Opening prices and the GitHub Action

- `scripts/fetch-prices.mjs` fetches the latest daily close for each commodity. It uses Node 22 with no dependencies:
  - First source: Yahoo Finance's chart endpoint (`GC=F`, `SI=F`, `BZ=F`, `NG=F`, `HG=F`).
  - Fallback: Stooq's CSV quotes.
- If both sources fail for a commodity, the script keeps the previous value and marks it `stale`, so the game always has sensible opening prices.
- It rejects any value that differs from the last one by more than 50%. This guards against a data source changing units.
- `.github/workflows/update-prices.yml` (shipped in `setup/` until you move it; see setup step 1) runs the script at 05:17 UTC on weekdays and commits the file if it changed. You can also run it any time from the Actions tab.
- The repo ships with **seed prices** from the close on 25 September 2026. Run the workflow once to replace them.
- The lobby and the control panel show where the opening prices came from.

Caveats:

- Both sources are free and unofficial. They are fine for a game, not for anything that matters.
- GitHub disables scheduled workflows in repositories with no activity for 60 days. If prices stop updating, re-enable the workflow in the Actions tab. The game still works with the last saved prices.
- To run it locally: `node scripts/fetch-prices.mjs`.

## Customising

Almost everything lives in two files.

**`docs/js/config.js`**

- `APP`: the title, the course name and URL, the debrief selling points, and an optional second button such as an Open Day booking link (`APP.course.secondary.url`).
- `COMMODITIES`: the five commodities, their colours, volatility, fallback prices and data symbols. Adding or swapping commodities works, but the events in `events.js` refer to these symbols by name.
- `DEFAULT_SETTINGS`: session length, starting cash, commission, headline warning time, autopilot, circuit breaker, custom names and bots on the leaderboard. Most of these can also be changed in the control panel before the opening bell. The panel remembers them in that browser.
- `MARKET`: how strongly trading moves prices (`impactAlpha`, `pressureBeta`), mean reversion, and the crowd-headline rules (`herdWindowSec`, `herdShare`, `herdMinTraders`, `herdCooldownSec`). Halve `impactAlpha` and `pressureBeta` if trading moves prices too much for your group.
- `NETWORK`: PeerJS and ICE (STUN/TURN) settings.

**`docs/js/events.js`**

The events, their headlines, how much they move each price, and the debrief lesson and module for each one. Add your own by copying an existing entry.

**`docs/js/version.js`**

The version number (bottom left of every page and in the control panel) and the copyright line (bottom right). **Bump `VERSION` each time you publish a change.** It's the quickest way to check that a projector or phone has picked up the new code rather than a cached copy.

**Brand**

- Colours are CSS variables at the top of `docs/css/style.css`: navy `#1A1464` and yellow `#FDE580`, from the corporate template.
- Logos are in `docs/assets/`, resized from the official brand files.
- The typeface is Arial, as in the corporate PowerPoint template.

**Check each recruitment cycle**

Module names, accreditations and the course URL (it contains the academic year) all go out of date. Update them in `docs/js/config.js` and `docs/js/events.js`.

## Networking: what can go wrong

This is a 100% GitHub Pages build, so it depends on outside services:

1. **The PeerJS public signalling server** (`0.peerjs.com`), which introduces phones to the host. If it is down, new phones can't join, although phones already connected keep working. The host shows a warning and keeps retrying.
2. **Google's public STUN servers**, which help phones find a direct route to the laptop.
3. **A TURN relay (strongly recommended).** A direct route usually fails when phones are on 4G/5G and the laptop is on university Wi-Fi: the mobile network shares addresses between customers and the campus network blocks incoming peer-to-peer traffic. The symptom is phones stuck on "Connecting". A TURN relay fixes it by passing the traffic through a server on port 443, which almost every network allows.

### Setting up the free TURN relay (about five minutes)

1. Sign up for a free account on Metered's [Open Relay Project](https://www.metered.ca/tools/openrelay/). The free tier includes 20 GB of relay traffic a month. A 10-minute session with 50 phones uses a few megabytes.
2. In the Metered dashboard, create an app and copy its **TURN credentials URL**. It looks like:
   `https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_API_KEY`
3. Paste it into `docs/js/config.js`:

   ```js
   turnCredentialsUrl: 'https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=YOUR_API_KEY',
   ```

4. Commit and push. Open the control panel on the big screen (press **C**). The status line should say **"Online with relay: phones can join from any network"**.

To try a credentials URL without committing it, add `?turnurl=<the URL, URL-encoded>` to the host address. The QR code passes it on to phones.

The API key is visible in the page source, as with any static site. Anyone could borrow your relay allowance. That doesn't matter much on a free tier, but check the Metered dashboard for options to limit where the key can be used. You can also list TURN servers directly in `NETWORK.extraIceServers` if the University or another provider gives you one.

### Other things to try on the day

- If a phone still can't connect, ask the user to switch between Wi-Fi and mobile data and reload. The phone page suggests this after a failed attempt.
- Putting the laptop on a phone hotspot also works as a stopgap without a relay.
- To avoid the public signalling server, run your own PeerJS server and point `NETWORK.peerOptions` (`host`, `port`, `path`, `secure`) at it. For a quick test, add `?peer=host:port` to the host URL.

Capacity: the host sends one small update per phone per second. A normal laptop handles a lecture theatre (100+ phones) comfortably. A group of 25 phones has been tested.

## Privacy

- Players choose a generated nickname. No names, emails, sign-ups, cookies or analytics.
- Everything stays in the presenter's browser. The laptop keeps a copy of the current session in local storage so that it can be resumed. Starting a new session replaces it.
- Each phone remembers a random ID for the room so that it can reconnect.
- The PeerJS signalling server sees random connection IDs and IP addresses, as any website would.

## Project structure

```
README.md                 This file
package.json              Handy scripts (npm run prices, npm run serve); no dependencies
scripts/fetch-prices.mjs  Price fetcher used by the Action
setup/update-prices.yml   Weekday price update (move to .github/workflows/)
screenshots/              Screenshots for this README (not published)

docs/                     THE WEBSITE (GitHub Pages serves this folder)
  index.html              Landing page: join with a code, open the big screen, rehearsal mode
  host.html               Big screen and market engine (open this on the projector laptop)
  play.html               Phone page
  control.html            Stand-alone control panel (second window, or presenter's phone)
  .nojekyll               Tells GitHub Pages to serve files as they are
  css/style.css           All styling (University of Huddersfield brand)
  js/config.js            Settings, commodities, course details, networking
  js/events.js            Market events, headlines and debrief lessons
  js/engine.js            Market simulation: prices, orders, events, bots, results
  js/net.js               PeerJS and same-browser (rehearsal) transports
  js/host.js              Host page logic: networking, rendering, persistence
  js/play.js              Phone logic
  js/control.js           Stand-alone control panel page logic
  js/controls.js          Control panel UI (shared by host drawer and control.html)
  js/chart.js             Canvas line charts and sparklines
  js/names.js             Name generator and a basic name filter
  js/ui.js                Formatting, QR codes, sounds, storage helpers
  js/version.js           Version number and copyright credit
  js/footer.js            Adds the version and copyright footer to each page
  vendor/                 PeerJS 1.5.5 and qrcode-generator 2.0.4, bundled so no CDN is needed
  data/prices.json        Opening prices (written by the GitHub Action)
  assets/                 Logos and icons
```

There is no build step. Edit a file, commit, and GitHub Pages serves it.

## Testing locally

ES modules need a web server (opening the files directly with `file://` won't work). Run:

```bash
python3 -m http.server 8000 --directory docs
# then open http://localhost:8000/
```

- Use **rehearsal mode** (`host.html?net=local`) to test everything in one browser.
- To test real phones against your laptop, open the host page using the laptop's network address rather than `localhost` (for example `http://192.168.1.20:8000/host.html`), so that the QR code points somewhere the phones can reach. The phones must be on the same network. Or push to GitHub Pages and test there.
- For debugging, the browser console on the host page exposes `__uoh.market` (the live engine) and `__uoh.debugLog` (the last few orders received).

## Credits and licences

- [PeerJS](https://github.com/peers/peerjs) (MIT) for WebRTC data connections.
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase (MIT) for QR codes.
- The University of Huddersfield name, logos and brand are the property of the University of Huddersfield. They are used here for official University recruitment activity.
- The game uses pretend money and simplified market behaviour. It is for education only and is not financial advice.
