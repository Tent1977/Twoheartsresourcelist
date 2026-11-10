# Reno Utopia 🍌

A stick-figure banana brawler. You start at **Safe Camp** and fight through seven zones to the front door:

1. Safe Camp (pods behind the fence)
2. The Showers (filthy, and the puddles slow you down)
3. Laundry Room
4. General Sleeping Area (the big tent: bunks and cubbies)
5. The Cafeteria
6. Admin Offices
7. Welcome Center: **the Big Kahuna**

**Rules:** every banana hit = 1 point; every 5 points another resident joins and throws with you.
You have 3 lives. The Big Kahuna is shielded unless **5 people are throwing bananas**. Show up short and he wins:
you lose a life and get sent back to Admin to recruit.

**Chain of command:** Facility Assistant (mop/broom) → Maintenance (wrenches) → Caseworker (notebooks) →
Supervisor (finger beebees, some on fire) → Assistant Administrator (ruler) → Administrator (staplers + pens) → Big Kahuna.

**Playable characters:** The Newcomer, Speedy Pete, Big Momma Bev, and the over-amped **Ralph the Inhabitant**
(bananas, eggs, beer bottles, flaming cigarettes, and a fire-fart special).

## Run it
It's a static site with no build step and no dependencies. Serve the folder from any web host
(GitHub Pages, Netlify, the existing website) or locally:

```
cd reno-utopia && python3 -m http.server 8000   # then open http://localhost:8000
```

## Install on a phone
It's a Progressive Web App. Open the site on the phone, then:
- **Android/Chrome:** tap **Install on your phone** on the title screen (or menu → Install app).
- **iPhone/Safari:** Share → **Add to Home Screen**.

After installing, it runs full-screen and works offline. Installing requires HTTPS (any normal host provides it).

## Files
- `index.html`, `style.css`: menus and layout
- `game.js`: the game engine (canvas + Web Audio)
- `zones.js`: the seven maps; `tests/renoUtopiaZones.test.js` checks that every maze can be finished
- `manifest.webmanifest`, `sw.js`, `icons/`: phone install + offline support

Add `?debug` to the URL for test keys: N = next zone, H = add helper, K = burn every staff member in the zone.

*A parody. Every character is a fictional stick figure, not a depiction of any real person.*
