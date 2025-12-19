import express from "express";
import { supabase } from "../_supabase.js";
import { calculateDistance } from "../brain/helpers.js";

const router = express.Router();

// ✅ calculateDistance zaimportowana z helpers.js (deduplikacja)

// Endpoint: /api/restaurants/nearby?lat=50.3859&lng=18.9461&radius=2
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lng, radius = 2 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: "Missing lat/lng parameters" });
    }

    const { data: restaurants, error } = await supabase
      .from("restaurants")
      .select("id, name, address, lat, lng");

    if (error) throw error;

    const nearby = restaurants
      .map((r) => ({
        ...r,
        distance_km: calculateDistance(parseFloat(lat), parseFloat(lng), r.lat, r.lng),
      }))
      .filter((r) => r.distance_km <= radius)
      .sort((a, b) => a.distance_km - b.distance_km);

    res.json({ nearby });
  } catch (err) {
    console.error("Nearby error:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
