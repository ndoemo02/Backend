export function groupRestaurantsByCategory(restaurants) {
  const categories = {};

  restaurants.forEach(r => {
    const cuisine = r.cuisine_type || 'Inne';
    if (!categories[cuisine]) {
      categories[cuisine] = [];
    }
    categories[cuisine].push(r);
  });

  return categories;
}

export function getCuisineFriendlyName(cuisineType) {
  const mapping = {
    'Amerykańska': 'fast-foody i burgery',
    'Kebab': 'kebaby',
    'Włoska': 'pizzerie',
    'Polska': 'kuchnię polską',
    'Śląska / Europejska': 'kuchnię europejską',
    'Czeska / Polska': 'kuchnię regionalną',
    'Wietnamska': 'kuchnię azjatycką',
    'Chińska': 'kuchnię azjatycką',
    'Tajska': 'kuchnię azjatycką'
  };

  return mapping[cuisineType] || cuisineType.toLowerCase();
}
