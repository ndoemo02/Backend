let memory = {
  lastRestaurant: null,
  lastIntent: null,
  lastUpdated: null,
};

export function saveContext(newIntent, restaurant = null) {
  memory.lastIntent = newIntent;
  if (restaurant) memory.lastRestaurant = restaurant;
  memory.lastUpdated = Date.now();
}

export function getContext() {
  // Czyści kontekst po 10 minutach bezczynności
  if (memory.lastUpdated && Date.now() - memory.lastUpdated > 10 * 60 * 1000) {
    memory = { lastRestaurant: null, lastIntent: null, lastUpdated: null };
  }
  return memory;
}

export function clearContext() {
  memory = { lastRestaurant: null, lastIntent: null, lastUpdated: null };
}