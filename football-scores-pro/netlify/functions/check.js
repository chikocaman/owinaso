import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const subStore = getStore("push-subs");
const stateStore = getStore("match-state");

function ensureVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("Missing VAPID keys in env");
  webpush.setVapidDetails("mailto:admin@example.com", pub, priv);
}

const LEAGUES = [
  { key: "eng.1", name: "Premier League" },
  { key: "esp.1", name: "LaLiga" },
  { key: "ita.1", name: "Serie A" },
  { key: "ger.1", name: "Bundesliga" },
  { key: "fra.1", name: "Ligue 1" },
  { key: "uefa.champions", name: "Champions League" },
  { key: "uefa.europa", name: "Europa League" }
];

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error("Fetch failed");
  return res.json();
}

function normalizeTime(displayClock) {
  return String(displayClock || "").replace(/'/g, "");
}

function statusBucket(statusType, shortDetail) {
  const st = (statusType || "").toLowerCase();
  const sd = (shortDetail || "").toLowerCase();

  if (sd.includes("aet")) return "AET";
  if (sd.includes("ft") || sd.includes("full")) return "FT";
  if (sd.includes("ht") || sd.includes("half")) return "HT";
  if (st.includes("in") || sd.includes("live") || sd.includes("1st") || sd.includes("2nd")) return "LIVE";
  if (st.includes("pre") || sd.includes("scheduled")) return "SCHED";
  if (st.includes("post") || sd.includes("postponed")) return "POSTP";
  return "OTHER";
}

function extractMatch(leagueName, evt) {
  const comp = evt.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c=>c.homeAway==="home");
  const away = comp.competitors?.find(c=>c.homeAway==="away");

  const st = evt.status?.type || {};
  const clock = normalizeTime(evt.status?.displayClock);
  return {
    id: evt.id,
    league: leagueName,
    homeTeam: home?.team?.displayName || "Home",
    awayTeam: away?.team?.displayName || "Away",
    homeScore: Number(home?.score ?? 0),
    awayScore: Number(away?.score ?? 0),
    statusType: st.name || "",
    statusDetail: st.shortDetail || "",
    clock
  };
}

async function fetchAllMatches() {
  const out = [];
  for (const lg of LEAGUES) {
    const url = `https://site.api.espn.com/apis/v2/sports/soccer/${lg.key}/scoreboard?_=${Date.now()}`;
    const j = await fetchJSON(url);
    const events = j.events || [];
    for (const e of events) {
      const m = extractMatch(lg.name, e);
      if (m) out.push(m);
    }
  }
  return out;
}

function fmtGoalLine(prefix, side, n, player, time, suffix) {
  let line = `${prefix} ${side} goal ${n} by "${player}" at ${time}`;
  if (suffix) line += ` via ${suffix}`;
  return line;
}

function buildCopyText(prefix, match, event) {
  // NOTE: User requested: no postponed line, no "no goals yet", no "(4-2 on penalties)".
  // Penalties output should be "$ set penalties X-Y" when available.
  if (event.type === "GOAL") {
    return fmtGoalLine(prefix, event.side, event.goalNumber, event.player, event.time, event.suffix);
  }
  if (event.type === "PEN_SET") {
    return `${prefix} set penalties ${event.penHome}-${event.penAway}`;
  }
  if (event.type === "FT") return `${prefix} end match`;
  if (event.type === "AET") return `${prefix} end match AET`;
  return "";
}

function detectEvents(prefix, prev, cur) {
  const events = [];

  const prevBucket = statusBucket(prev?.statusType, prev?.statusDetail);
  const curBucket  = statusBucket(cur?.statusType, cur?.statusDetail);

  if (prevBucket === "SCHED" && curBucket === "LIVE") {
    events.push({ type:"KICK", match: cur });
  }

  if (prevBucket !== "HT" && curBucket === "HT") {
    events.push({ type:"HT", match: cur });
  }

  const prevTotal = (prev?.homeScore ?? 0) + (prev?.awayScore ?? 0);
  const curTotal  = cur.homeScore + cur.awayScore;

  if (curTotal > prevTotal && curBucket === "LIVE") {
    const homeDiff = cur.homeScore - (prev?.homeScore ?? 0);
    const awayDiff = cur.awayScore - (prev?.awayScore ?? 0);
    const time = cur.clock || "0";

    if (homeDiff > 0) {
      events.push({
        type:"GOAL",
        match: cur,
        side: "home",
        goalNumber: cur.homeScore,
        player: "Unknown",
        time,
        suffix: null
      });
    }
    if (awayDiff > 0) {
      events.push({
        type:"GOAL",
        match: cur,
        side: "away",
        goalNumber: cur.awayScore,
        player: "Unknown",
        time,
        suffix: null
      });
    }
  }

  if (prevBucket !== "FT" && curBucket === "FT") {
    events.push({ type:"FT", match: cur });
  }
  if (prevBucket !== "AET" && curBucket === "AET") {
    events.push({ type:"AET", match: cur });
  }

  // Penalties set line ($ set penalties X-Y): ESPN scoreboard doesn't consistently expose shootout breakdown.
  // We can wire exact extraction once you confirm the fields you see for shootouts.

  return events;
}

async function pushToAll(msg, filterFn = null) {
  ensureVapid();
  const list = await subStore.list();
  const keys = list.blobs?.map(b => b.key) || [];
  let sent = 0;

  for (const key of keys) {
    const raw = await subStore.get(key);
    if (!raw) continue;
    const { subscription, prefs } = JSON.parse(raw);

    if (filterFn && !filterFn(prefs || {})) continue;

    try {
      await webpush.sendNotification(subscription, JSON.stringify(msg));
      sent++;
    } catch {
      await subStore.delete(key);
    }
  }
  return sent;
}

export async function handler(event) {
  const mode = (event.queryStringParameters?.mode || "").toLowerCase();
  const matches = await fetchAllMatches();

  if (mode === "ui") {
    const ui = matches.map(m => ({
      ...m,
      statusText: m.statusDetail || m.statusType || "",
      copyAll: ""
    }));
    return { statusCode: 200, headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ matches: ui }) };
  }

  const prefix = "$";
  const prevRaw = await stateStore.get("prev");
  const prevList = prevRaw ? JSON.parse(prevRaw) : [];
  const prevMap = new Map(prevList.map(m => [m.id, m]));

  const toPush = [];
  for (const m of matches) {
    const prev = prevMap.get(m.id) || null;
    if (!prev) continue;
    const evs = detectEvents(prefix, prev, m);
    for (const ev of evs) toPush.push(ev);
  }

  await stateStore.set("prev", JSON.stringify(matches));

  for (const ev of toPush) {
    const match = ev.match;

    if (ev.type === "KICK") {
      await pushToAll({
        title: `Kickoff: ${match.homeTeam} vs ${match.awayTeam}`,
        body: `${match.league}`,
        copyText: "",
        tag: `kick-${match.id}`
      }, prefs => !!prefs.notifyKick);
    }

    if (ev.type === "HT") {
      await pushToAll({
        title: `Half Time`,
        body: `${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}\n${match.league}`,
        copyText: "",
        tag: `ht-${match.id}`
      }, prefs => !!prefs.notifyHT);
    }

    if (ev.type === "GOAL") {
      const copyText = buildCopyText(prefix, match, {
        type: "GOAL",
        side: ev.side,
        goalNumber: ev.goalNumber,
        player: ev.player,
        time: ev.time,
        suffix: ev.suffix
      });
      await pushToAll({
        title: `GOAL! ${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}`,
        body: `${match.league}\n${copyText}`,
        copyText,
        tag: `goal-${match.id}-${match.homeScore}-${match.awayScore}`
      }, prefs => (prefs.notifyGoal ?? true));
    }

    if (ev.type === "FT") {
      const copyText = buildCopyText(prefix, match, { type:"FT" });
      await pushToAll({
        title: `Full Time`,
        body: `${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}\n${match.league}`,
        copyText,
        tag: `ft-${match.id}`
      }, prefs => !!prefs.notifyFT);
    }

    if (ev.type === "AET") {
      const copyText = buildCopyText(prefix, match, { type:"AET" });
      await pushToAll({
        title: `Full Time (AET)`,
        body: `${match.homeTeam} ${match.homeScore} - ${match.awayScore} ${match.awayTeam}\n${match.league}`,
        copyText,
        tag: `aet-${match.id}`
      }, prefs => !!prefs.notifyFT);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok:true, pushed: toPush.length }) };
}
