import { supabase } from "../../_supabase.js";
import { getSession, updateSession } from "../context.js";
import {
  extractCuisineType,
  findRestaurantsByLocation,
  expandCuisineType,
  calculateDistance,
  groupRestaurantsByCategory,
  getNearbyCityCandidates,
} from "../locationService.js";
import { extractLocation } from "../helpers.js";
import { normalize } from "../orderService.js";
import { playTTS, stylizeWithGPT4o } from "../../tts.js";

const globalNearbyCache = (() => {
  global.nearbyCache = global.nearbyCache || new Map();
  return global.nearbyCache;
})();

function formatDistance(km) {
  if (km == null || !isFinite(km)) return "";
  if (km < 1) {
    const m = Math.max(1, Math.round(km * 1000));
    return `${m} ${m === 1 ? "metr" : m < 5 ? "metry" : "metrów"}`;
  }
  const k = Math.round(km * 10) / 10;
  const whole = Math.round(k);
  if (whole === 1) return `${k} kilometr`;
  if (whole >= 2 && whole <= 4) return `${k} kilometry`;
  return `${k} kilometrów`;
}

function sanitizePlaceName(name, cuisine, category) {
  try {
    const safeName = (name || "").toString();
    const all = [cuisine, category].filter(Boolean).join(" ").toLowerCase();
    if (all && safeName.toLowerCase().includes(all)) return safeName;
    const blacklist = ["hotel", "restauracja", "burger", "hamburger", "bar"];
    for (const bad of blacklist) {
      if (safeName.toLowerCase().includes(bad) && all.includes(bad)) return safeName;
    }
    if (cuisine && !safeName.toLowerCase().includes(String(cuisine).toLowerCase())) {
      return `${safeName} – ${cuisine}`;
    }
    return safeName;
  } catch {
    return name;
  }
}

export async function handleFindNearby({
  text,
  sessionId,
  prevLocation,
  req,
  res,
}) {
  let replyCore = "";
  let meta = {};

  const session = getSession(sessionId) || {};
  const includeTTS = !!(req?.body?.includeTTS) && process.env.NODE_ENV !== "test";

  let location = extractLocation(text);
  const cuisineType = extractCuisineType(text);
  let restaurants = null;
  let replyPrefix = "";
  let displayLocation = null;

  if (!location && prevLocation) {
    console.log(`📍 Using last known location: "${prevLocation}"`);
    location = prevLocation;
  }

  if (location) {
    console.log(`🧭 GeoContext active: searching in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ""}`);
    restaurants = await findRestaurantsByLocation(location, cuisineType, session);
    if (restaurants) {
      updateSession(sessionId, { last_location: location });
      console.log(`✅ GeoContext: ${restaurants.length} restaurants found in "${location}"${cuisineType ? ` (cuisine: ${cuisineType})` : ""}`);
    }
  } else {
    const lat = req?.body?.lat;
    const lng = req?.body?.lng;
    if (lat != null && lng != null) {
      try {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const latDelta = 0.25;
        const lngDelta = 0.4;
        const tileKey = `${Math.round(userLat * 20) / 20}_${Math.round(userLng * 20) / 20}`;
        const cached = globalNearbyCache.get(tileKey);
        let list = null;
        const now = Date.now();
        if (cached && now - cached.t < 120000) {
          list = cached.d;
        } else {
          const { data } = await supabase
            .from("restaurants")
            .select("id,name,city,cuisine_type,lat,lng")
            .gt("lat", userLat - latDelta)
            .lt("lat", userLat + latDelta)
            .gt("lng", userLng - lngDelta)
            .lt("lng", userLng + lngDelta)
            .limit(300);
          list = data || [];
          globalNearbyCache.set(tileKey, { d: list, t: now });
        }

        const all = (list || [])
          .map((r) => ({
            ...r,
            distance: r.lat && r.lng ? calculateDistance(userLat, userLng, r.lat, r.lng) : 999,
          }))
          .sort((a, b) => a.distance - b.distance);
        const top = all.slice(0, 3);
        const displayList = top
          .map((r, i) => `${i + 1}. ${sanitizePlaceName(r.name, r.cuisine_type, r.category)} (${formatDistance(r.distance)})`)
          .join("\n");
        updateSession(sessionId, {
          last_location: null,
          last_restaurants_list: top,
          expectedContext: "select_restaurant",
        });
        const reply = `W pobliżu mam:\n${displayList}\n\nKtórą wybierasz?`;

        if (includeTTS) {
          try {
            const SIMPLE_TTS = process.env.TTS_SIMPLE === "true" || process.env.TTS_MODE === "basic";
            const audioContent = await playTTS(reply, {
              voice: process.env.TTS_VOICE || (SIMPLE_TTS ? "pl-PL-Wavenet-D" : "pl-PL-Chirp3-HD-Erinome"),
              tone: getSession(sessionId)?.tone || "swobodny",
            });
            res.status(200).json({
              ok: true,
              intent: "find_nearby",
              reply,
              fallback: false,
              audioContent,
              audioEncoding: "MP3",
              context: getSession(sessionId),
            });
            return { handled: true };
          } catch (err) {
            console.warn("⚠️ TTS (nearby lat/lng) failed:", err?.message);
          }
        }
        res
          .status(200)
          .json({ ok: true, intent: "find_nearby", reply, fallback: false, audioContent: null, audioEncoding: null, context: getSession(sessionId) });
        return { handled: true };
      } catch (err) {
        console.warn("⚠️ Nearby by lat/lng failed, showing prompt:", err?.message);
      }
    }

    console.log("⚠️ No location found in text and no session.last_location available");

    // NEW: Check if this is an implicit order (user wanted to order something)
    const ORDER_VERBS_REGEX = /\b(zamawiam|zamow|zamów|poprosze|poprosz[ęe]|wezme|wezm[ęe]|biore|bior[ęe]|chce|chc[ęe]|chciał(bym|abym))\b/i;
    const isImplicitOrder = ORDER_VERBS_REGEX.test(text);

    // Extract dish from text (if available from entities passed in)
    const dishEntity = meta?.entities?.dish || meta?.entities?.items;

    // Save pending dish and set awaiting flag for better context continuity
    if (isImplicitOrder && dishEntity) {
      updateSession(sessionId, {
        pendingDish: dishEntity,
        awaiting: 'location'
      });
      const prompt = `Chętnie przyjmę zamówienie, ale najpierw podaj miasto. Gdzie szukamy?`;
      res.status(200).json({ ok: true, intent: "find_nearby", reply: prompt, fallback: true, context: getSession(sessionId) });
      return { handled: true };
    } else {
      updateSession(sessionId, { awaiting: 'location' });
      const prompt = "Brak lokalizacji. Podaj nazwę miasta (np. Bytom) lub powiedz 'w pobliżu'.";
      res.status(200).json({ ok: true, intent: "find_nearby", reply: prompt, fallback: true, context: getSession(sessionId) });
      return { handled: true };
    }
  }

  if (!restaurants && location) {
    const normalizedLocation = normalize(location);
    const suggestions = getNearbyCityCandidates(normalizedLocation);
    for (const candidate of suggestions) {
      const sessionForCandidate = getSession(sessionId) || {};
      const list = await findRestaurantsByLocation(candidate, cuisineType, sessionForCandidate);
      if (list && list.length) {
        restaurants = list;
        replyPrefix = `W ${location} nie mam restauracji, ale w pobliżu — w ${candidate} — znalazłam ${list.length} miejsc.\n\n`;
        displayLocation = candidate;
        break;
      }
    }
    if (!restaurants) {
      replyCore = `Nie znalazłam restauracji w ${location} ani w okolicy.`;
      return { reply: replyCore, meta };
    }
  }

  if ((!restaurants || !restaurants.length) && !location) {
    let query = supabase.from("restaurants").select("id,name,address,city,cuisine_type,lat,lng");
    if (cuisineType) {
      const cuisineList = expandCuisineType(cuisineType);
      if (cuisineList && cuisineList.length > 1) query = query.in("cuisine_type", cuisineList);
      else if (cuisineList && cuisineList.length === 1) query = query.eq("cuisine_type", cuisineList[0]);
    }
    const { data, error } = await query;
    if (error) {
      console.error("⚠️ Supabase error in find_nearby:", error?.message || "Brak danych");
      replyCore = "Nie mogę pobrać danych z bazy. Sprawdź połączenie z serwerem.";
      return { reply: replyCore, meta };
    }
    restaurants = data;

    const lat = req?.body?.lat;
    const lng = req?.body?.lng;
    if (lat != null && lng != null && restaurants?.length) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const withDist = restaurants
        .map((r) => {
          if (r.lat && r.lng) {
            const distance = calculateDistance(userLat, userLng, r.lat, r.lng);
            return { ...r, distance };
          }
          return { ...r, distance: 999 };
        })
        .sort((a, b) => a.distance - b.distance);

      const top = withDist.slice(0, 3);
      updateSession(sessionId, {
        last_location: null,
        last_restaurants_list: top,
        expectedContext: "select_restaurant",
      });

      const list = top
        .map((r, i) => `${i + 1}. ${sanitizePlaceName(r.name, r.cuisine_type, r.category)} (${formatDistance(r.distance)})`)
        .join("\n");

      // UX IMPROVEMENT: Implicit Order Recognition
      const ORDER_VERBS_REGEX = /\b(zamawiam|zamow|zamów|poprosze|poprosz[ęe]|wezme|wezm[ęe]|biore|bior[ęe]|chce|chc[ęe]|chciał(bym|abym))\b/i;
      const isImplicitOrder = ORDER_VERBS_REGEX.test(text);

      if (isImplicitOrder) {
        replyCore = `Chętnie przyjmę zamówienie, ale najpierw wybierzmy miejsce. W pobliżu mam:\n${list}\n\nZ której restauracji zamawiamy?`;
      } else {
        replyCore = `W pobliżu mam:\n${list}\n\nKtórą wybierasz?`;
      }
      return { reply: replyCore, meta };
    }
  }

  if (!restaurants?.length) {
    const normalizedLocation = normalize(location || "");
    const nearbyCities = getNearbyCityCandidates(normalizedLocation);
    if (cuisineType === "wege") {
      replyCore = "Nie mam niestety opcji wegetariańskich w tej okolicy. Mogę sprawdzić coś innego?";
    } else if (cuisineType && location) {
      replyCore =
        nearbyCities && nearbyCities.length > 0
          ? `Nie mam nic z kategorii "${cuisineType}" w ${location}, ale 5 minut dalej w ${nearbyCities[0]} mam kilka ciekawych miejsc — sprawdzimy?`
          : `Nie mam nic z kategorii "${cuisineType}" w ${location}. Chcesz zobaczyć inne opcje w tej okolicy?`;
    } else if (cuisineType) {
      replyCore = `Nie znalazłam restauracji serwujących ${cuisineType}. Mogę sprawdzić inną kuchnię?`;
    } else if (location) {
      replyCore =
        nearbyCities && nearbyCities.length > 0
          ? `Nie mam tu żadnych restauracji, ale 5 minut dalej w ${nearbyCities[0]} mam kilka fajnych miejsc — sprawdzimy?`
          : `Nie znalazłam restauracji w "${location}". Spróbuj innej nazwy miasta lub powiedz "w pobliżu".`;
    } else {
      replyCore = "Nie znalazłam jeszcze żadnej restauracji. Podaj nazwę lub lokalizację.";
    }
    return { reply: replyCore, meta };
  }

  const requestedCount = /pokaz\s+(wszystkie|5|wiecej|więcej)/i.test(text)
    ? restaurants.length
    : Math.min(3, restaurants.length);
  const displayRestaurants = restaurants.slice(0, requestedCount);
  const categories = groupRestaurantsByCategory(displayRestaurants);
  const categoryNames = Object.keys(categories);

  // UX IMPROVEMENT: Implicit Order Recognition (DB path)
  const ORDER_VERBS_REGEX = /\b(zamawiam|zamow|zamów|poprosze|poprosz[ęe]|wezme|wezm[ęe]|biore|bior[ęe]|chce|chc[ęe]|chciał(bym|abym))\b/i;
  const isImplicitOrder = ORDER_VERBS_REGEX.test(text);

  if (cuisineType && categoryNames.length) {
    const finalLoc = displayLocation || location || displayRestaurants[0]?.city || null;
    const locationInfo = finalLoc ? ` w ${finalLoc}` : " w pobliżu";
    const countText =
      displayRestaurants.length === 1 ? "miejsce" : displayRestaurants.length < 5 ? "miejsca" : "miejsc";

    if (isImplicitOrder) {
      replyCore = `${replyPrefix}Widzę, że masz ochotę na ${cuisineType}! Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
        displayRestaurants.map((r, i) => `${i + 1}. ${r.name} (${formatDistance(r.distance)})`).join("\n") +
        `\n\nZ której restauracji chcesz zamówić?`;
    } else {
      replyCore =
        `${replyPrefix}Znalazłam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
        displayRestaurants
          .map((r, i) => {
            let distanceStr = "";
            if (r.distance && r.distance < 999) {
              distanceStr = r.distance < 1 ? ` (${Math.round(r.distance * 1000)} metrów)` : ` (${r.distance.toFixed(1)} kilometra)`;
            }
            return `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ""}${distanceStr}`;
          })
          .join("\n") +
        (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : "") +
        "\n\nKtóre Cię interesuje?";
    }
  } else {
    // Generic List
    const finalLoc2 = displayLocation || location || displayRestaurants[0]?.city || null;
    const locationInfo = finalLoc2 ? ` w ${finalLoc2}` : " w pobliżu";
    const countText =
      displayRestaurants.length === 1 ? "miejsce" : displayRestaurants.length < 5 ? "miejsca" : "miejsc";

    if (isImplicitOrder) {
      replyCore = `${replyPrefix}Chętnie przyjmę zamówienie, ale musimy wybrać skąd. Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
        displayRestaurants.map((r, i) => `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ""}`).join("\n") +
        `\n\nPodaj nazwę lub numer restauracji, z której zamawiamy.`;
    } else {
      replyCore =
        `${replyPrefix}Mam ${displayRestaurants.length} ${countText}${locationInfo}:\n` +
        displayRestaurants
          .map((r, i) => {
            let distanceStr = "";
            if (r.distance && r.distance < 999) {
              distanceStr = r.distance < 1 ? ` (${Math.round(r.distance * 1000)} metrów)` : ` (${r.distance.toFixed(1)} kilometra)`;
            }
            return `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ""}${distanceStr}`;
          })
          .join("\n") +
        (restaurants.length > requestedCount ? `\n\n(+${restaurants.length - requestedCount} więcej — powiedz "pokaż wszystkie")` : "") +
        "\n\nKtóre Cię interesuje?";
    }
  }

  if (restaurants.length > requestedCount) {
    updateSession(sessionId, {
      expectedContext: "show_more_options",
      last_location: displayLocation || location || null,
      lastCuisineType: cuisineType,
      last_restaurants_list: restaurants,
    });
  } else if (restaurants.length > 1) {
    updateSession(sessionId, {
      expectedContext: "select_restaurant",
      last_location: displayLocation || location || null,
      lastCuisineType: cuisineType,
      last_restaurants_list: restaurants,
    });
  }

  return { reply: replyCore, meta };
}
